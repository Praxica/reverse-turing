import { prisma } from '@/lib/db';
import type { GameRole, Game, GameMessage } from '@/generated/prisma/client';
import type { LabelMapping } from './types';
import { connectionManager } from './connection-manager';
import {
  deliverMessage,
  getLabelForRole,
  getSenderLabel,
  sleep,
} from './message-delivery';
import {
  generateLLMAnswer,
  generateLLMStrategy,
  generateLLMQuestion,
  generateJudgeStrategy,
  generateLLMJudgment,
} from './llm-service';

/**
 * Game flow (judge-as-interrogator):
 *   Each round: judge asks a question -> both participants answer
 *   (human via POST, LLM generated server-side) -> once BOTH answers
 *   exist, they are revealed in random order through the streaming
 *   pipeline -> next round. After maxTurns rounds (or whenever the
 *   judge decides), the judge picks who is human.
 *
 * The activePlayer column doubles as the round-phase lock:
 *   JUDGE        = waiting for the judge's question
 *   HUMAN_PLAYER = answers phase (collecting answers)
 *   null         = revealing answers (locked) / not in conversation
 */

/**
 * Create a new game.
 */
export async function createGame(params: {
  hostUserId: string;
  topic?: string;
  model: string;
  systemPrompt?: string;
  maxTurns?: number;
  streamingDelay?: number;
  judgeMode?: 'HUMAN' | 'LLM';
  judgeModel?: string;
  showJudgeNotes?: boolean;
  humanModel?: string;
  humanPersona?: string;
  population?: string;
  harnessRunId?: string;
  /** A preset contestant strategy, e.g. one under evaluation */
  llmStrategy?: string;
  strategyLocked?: boolean;
}) {
  const game = await prisma.game.create({
    data: {
      hostUserId: params.hostUserId,
      topic: params.topic ?? '',
      model: params.model,
      systemPrompt: params.systemPrompt,
      maxTurns: params.maxTurns ?? 5,
      streamingDelay: params.streamingDelay ?? 30,
      judgeMode: params.judgeMode ?? 'HUMAN',
      judgeModel: params.judgeModel,
      showJudgeNotes: params.showJudgeNotes ?? false,
      humanModel: params.humanModel,
      humanPersona: params.humanPersona,
      population: params.population,
      harnessRunId: params.harnessRunId,
      llmStrategy: params.llmStrategy,
      strategyLocked: params.strategyLocked ?? false,
    },
  });

  const roles: GameRole[] = ['HUMAN_PLAYER', 'LLM_PLAYER', 'JUDGE'];
  await prisma.gameParticipant.createMany({
    data: roles.map((role) => ({
      gameId: game.id,
      role,
      displayName:
        role === 'LLM_PLAYER'
          ? 'AI'
          : role === 'JUDGE'
            ? 'Judge'
            : 'Player',
    })),
  });

  const participants = await prisma.gameParticipant.findMany({
    where: { gameId: game.id },
  });

  return { game, participants };
}

/**
 * Get full game data with participants and messages.
 */
export async function getGameWithDetails(gameId: string) {
  return prisma.game.findUnique({
    where: { id: gameId },
    include: {
      participants: true,
      messages: { orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }] },
    },
  });
}

/**
 * Transition game to READY and assign random A/B labels.
 * Safe to call concurrently — only the first caller wins.
 */
export async function startGame(gameId: string): Promise<void> {
  const labelMapping: LabelMapping =
    Math.random() > 0.5
      ? { A: 'HUMAN_PLAYER', B: 'LLM_PLAYER' }
      : { A: 'LLM_PLAYER', B: 'HUMAN_PLAYER' };

  // Atomic claim: only succeeds if still in LOBBY
  const claimed = await prisma.game.updateMany({
    where: { id: gameId, status: 'LOBBY' },
    data: {
      status: 'READY',
      labelMapping: labelMapping as unknown as Record<string, string>,
      currentTurn: 1,
      activePlayer: 'JUDGE', // first phase: judge asks a question
    },
  });
  if (claimed.count === 0) return;

  connectionManager.broadcast(gameId, {
    type: 'game-status',
    data: { status: 'READY' },
  });

  connectionManager.sendTo(gameId, 'HUMAN_PLAYER', {
    type: 'label-assigned',
    data: { label: getLabelForRole('HUMAN_PLAYER', labelMapping) },
  });

  // Countdown for human players; simulated games (streamingDelay 0) skip it
  const starting = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
  if (starting.streamingDelay > 0) await sleep(3000);

  await prisma.game.update({
    where: { id: gameId },
    data: { status: 'CONVERSATION' },
  });

  connectionManager.broadcast(gameId, {
    type: 'game-status',
    data: { status: 'CONVERSATION' },
  });

  await beginQuestionPhase(gameId, 1);
}

/**
 * Open the question phase of a round. If the judge is an LLM, generate
 * and submit its question automatically.
 */
async function beginQuestionPhase(
  gameId: string,
  turnNumber: number
): Promise<void> {
  connectionManager.broadcast(gameId, {
    type: 'phase',
    data: { phase: 'question', turnNumber },
  });

  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
  if (game.judgeMode === 'LLM' && game.judgeModel) {
    runDetached(gameId, 'LLM judge question', async () => {
      const messages = await prisma.gameMessage.findMany({
        where: { gameId },
        orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }],
      });
      const strategy = await getOrCreateJudgeStrategy(gameId);
      const move = await generateLLMQuestion({
        model: game.judgeModel!,
        strategy,
        conversationHistory: messages,
        labelMapping: game.labelMapping as unknown as LabelMapping,
        roundNumber: turnNumber,
        maxRounds: game.maxTurns,
      });
      if (move.kind === 'verdict') {
        // The judge is confident and ends the game early
        await submitVerdict(gameId, move.humanIs, move.reason);
        return;
      }
      await submitJudgeQuestion(gameId, move.text, move.notes);
    });
  }
}

/**
 * The AI judge starts every session with a strategy it writes itself,
 * informed by what it did in the host's recent sessions so it does not
 * repeat them.
 */
async function getOrCreateJudgeStrategy(gameId: string): Promise<string> {
  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
  if (game.judgeStrategy) return game.judgeStrategy;

  const recent = await prisma.game.findMany({
    where: {
      hostUserId: game.hostUserId,
      judgeMode: 'LLM',
      id: { not: gameId },
      messages: { some: { senderRole: 'JUDGE' } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      messages: {
        where: { senderRole: 'JUDGE' },
        orderBy: { turnNumber: 'asc' },
      },
    },
  });

  const strategy = await generateJudgeStrategy({
    model: game.judgeModel!,
    maxRounds: game.maxTurns,
    pastSessions: recent.map((g) => ({
      strategy: g.judgeStrategy,
      questions: g.messages.map((m) => m.content).filter(Boolean),
    })),
  });

  await prisma.game.update({
    where: { id: gameId },
    data: { judgeStrategy: strategy },
  });
  return strategy;
}

/**
 * Judge submits a question. Streams it to the human player, then opens
 * the answers phase and kicks off the LLM's answer in the background.
 */
export async function submitJudgeQuestion(
  gameId: string,
  content: string,
  privateNotes: string | null = null
): Promise<{ messageId: string }> {
  // Atomic phase claim: question -> answers
  const claimed = await prisma.game.updateMany({
    where: { id: gameId, status: 'CONVERSATION', activePlayer: 'JUDGE' },
    data: { activePlayer: 'HUMAN_PLAYER' },
  });
  if (claimed.count === 0) {
    throw new Error('Not waiting for a question right now');
  }

  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });

  const message = await prisma.gameMessage.create({
    data: {
      gameId,
      senderRole: 'JUDGE',
      content,
      privateNotes,
      turnNumber: game.currentTurn,
    },
  });

  runDetached(gameId, 'question delivery', async () => {
    // Stream the question to the human player (judge echoes locally)
    await deliverMessage({
      gameId,
      messageId: message.id,
      content,
      senderLabel: 'JUDGE',
      streamingDelay: game.streamingDelay,
      recipients: ['HUMAN_PLAYER'],
    });

    await prisma.gameMessage.update({
      where: { id: message.id },
      data: { deliveredAt: new Date() },
    });

    // Answers phase: both participants now "think"
    connectionManager.broadcast(gameId, {
      type: 'phase',
      data: { phase: 'answers', turnNumber: game.currentTurn },
    });
    connectionManager.sendTo(gameId, 'JUDGE', {
      type: 'thinking-start',
      data: { player: 'A' },
    });
    connectionManager.sendTo(gameId, 'JUDGE', {
      type: 'thinking-start',
      data: { player: 'B' },
    });

    // Generate the LLM's answer (buffered until the human also answers)
    await generateAndStoreLLMAnswer(gameId);
  });

  return { messageId: message.id };
}

/**
 * Human player submits an answer to the current question.
 */
export async function submitHumanAnswer(
  gameId: string,
  content: string
): Promise<{ messageId: string }> {
  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });

  if (game.status !== 'CONVERSATION' || game.activePlayer !== 'HUMAN_PLAYER') {
    throw new Error('Not accepting answers right now');
  }

  // The unique constraint (gameId, senderRole, turnNumber) rejects
  // double submissions atomically.
  let message: GameMessage;
  try {
    message = await prisma.gameMessage.create({
      data: {
        gameId,
        senderRole: 'HUMAN_PLAYER',
        content,
        turnNumber: game.currentTurn,
      },
    });
  } catch (err) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      throw new Error('You already answered this question');
    }
    throw err;
  }

  runDetached(gameId, 'answer collection', () =>
    maybeRevealAnswers(gameId, game.currentTurn)
  );

  return { messageId: message.id };
}

/**
 * Generate and store the LLM's answer for the current round, then try
 * to reveal. Not delivered directly — reveal happens only when both
 * answers exist, so the judge never learns who answered first.
 */
async function generateAndStoreLLMAnswer(gameId: string): Promise<void> {
  const game = await prisma.game.findUniqueOrThrow({
    where: { id: gameId },
    include: {
      messages: { orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }] },
    },
  });

  // The contestant plays by a strategy it writes itself: drafted before
  // round 1, revised after every completed round. A host-supplied prompt
  // replaces this entirely.
  let strategy = game.llmStrategy;
  const alreadyRevised = game.messages.some(
    (m) => m.senderRole === 'LLM_PLAYER' && m.turnNumber === game.currentTurn
  );
  if (!game.systemPrompt && !alreadyRevised && !game.strategyLocked) {
    strategy = await generateLLMStrategy({
      model: game.model,
      conversationHistory: game.messages.filter(
        (m) => m.turnNumber < game.currentTurn
      ),
      currentStrategy: game.llmStrategy,
      showJudgeNotes: game.showJudgeNotes,
    });
    await prisma.game.update({
      where: { id: gameId },
      data: { llmStrategy: strategy },
    });
  }

  const answer = await generateLLMAnswer({
    model: game.model,
    systemPrompt: game.systemPrompt,
    strategy,
    conversationHistory: game.messages,
    showJudgeNotes: game.showJudgeNotes,
  });

  try {
    await prisma.gameMessage.create({
      data: {
        gameId,
        senderRole: 'LLM_PLAYER',
        content: answer,
        privateNotes: strategy,
        turnNumber: game.currentTurn,
      },
    });
  } catch (err) {
    // P2002 = answer already exists for this round (retry race) — fine
    if (
      !(err instanceof Error && (err as { code?: string }).code === 'P2002')
    ) {
      throw err;
    }
  }

  await maybeRevealAnswers(gameId, game.currentTurn);
}

/**
 * If both answers for the round are in, atomically claim the reveal and
 * stream both answers in random order to the judge and human player.
 */
async function maybeRevealAnswers(
  gameId: string,
  turnNumber: number
): Promise<void> {
  const answers = await prisma.gameMessage.findMany({
    where: {
      gameId,
      turnNumber,
      senderRole: { in: ['HUMAN_PLAYER', 'LLM_PLAYER'] },
    },
  });
  if (answers.length < 2) return; // Still waiting for the other answer

  // Atomic claim: answers phase -> revealing. Loser of the race exits.
  const claimed = await prisma.game.updateMany({
    where: {
      id: gameId,
      status: 'CONVERSATION',
      activePlayer: 'HUMAN_PLAYER',
      currentTurn: turnNumber,
    },
    data: { activePlayer: null },
  });
  if (claimed.count === 0) return;

  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
  const labelMapping = game.labelMapping as unknown as LabelMapping;

  // Random reveal order — composition/generation time is now invisible
  const ordered = [...answers].sort(() => Math.random() - 0.5);

  for (const answer of ordered) {
    const senderLabel = getSenderLabel(answer.senderRole, labelMapping);

    connectionManager.sendTo(gameId, 'JUDGE', {
      type: 'thinking-end',
      data: { player: senderLabel as 'A' | 'B' },
    });

    // The human gets the other participant's answer streamed; their own
    // answer was echoed locally at submit time.
    const recipients: GameRole[] =
      answer.senderRole === 'HUMAN_PLAYER'
        ? ['JUDGE']
        : ['JUDGE', 'HUMAN_PLAYER'];

    await deliverMessage({
      gameId,
      messageId: answer.id,
      content: answer.content,
      senderLabel,
      streamingDelay: game.streamingDelay,
      recipients,
    });

    await prisma.gameMessage.update({
      where: { id: answer.id },
      data: { deliveredAt: new Date() },
    });

    if (game.streamingDelay > 0) await sleep(800); // Small beat between the two reveals
  }

  // Optional show: the AI judge's case notes for the round just revealed
  if (game.showJudgeNotes) {
    const question = await prisma.gameMessage.findFirst({
      where: { gameId, turnNumber, senderRole: 'JUDGE' },
    });
    if (question?.privateNotes) {
      connectionManager.broadcast(gameId, {
        type: 'judge-notes',
        data: { messageId: question.id, notes: question.privateNotes },
      });
    }
  }

  await finishRound(gameId, game);
}

/**
 * After a round's answers are revealed: end the conversation after
 * maxTurns rounds, otherwise open the next question phase.
 */
async function finishRound(gameId: string, game: Game): Promise<void> {
  if (game.currentTurn >= game.maxTurns) {
    await transitionToJudging(gameId, game);
    return;
  }

  const nextTurn = game.currentTurn + 1;
  await prisma.game.update({
    where: { id: gameId },
    data: { activePlayer: 'JUDGE', currentTurn: nextTurn },
  });

  await beginQuestionPhase(gameId, nextTurn);
}

/**
 * Transition to judging phase.
 */
async function transitionToJudging(gameId: string, game: Game): Promise<void> {
  await prisma.game.update({
    where: { id: gameId },
    data: { status: 'JUDGING', activePlayer: null },
  });

  connectionManager.broadcast(gameId, {
    type: 'game-status',
    data: { status: 'JUDGING' },
  });

  connectionManager.broadcast(gameId, {
    type: 'judging-start',
    data: {},
  });

  if (game.judgeMode === 'LLM' && game.judgeModel) {
    const judgeModel = game.judgeModel;
    // Its own detached step so a failed verdict is retried on its own,
    // not as part of the answer-reveal step that led here.
    runDetached(gameId, 'AI judge verdict', async () => {
      const messages = await prisma.gameMessage.findMany({
        where: { gameId },
        orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }],
      });

      const judgment = await generateLLMJudgment({
        model: judgeModel,
        conversationHistory: messages,
        labelMapping: game.labelMapping as unknown as LabelMapping,
      });

      await submitVerdict(gameId, judgment.humanIs, judgment.reason);
    });
  }
}

/**
 * Submit judge's verdict and complete the game. The judge may decide
 * early (during CONVERSATION) once at least one round has completed.
 */
export async function submitVerdict(
  gameId: string,
  humanIs: 'A' | 'B',
  reason: string
): Promise<void> {
  const game = await prisma.game.findUniqueOrThrow({
    where: { id: gameId },
  });

  if (game.status === 'CONVERSATION') {
    const revealed = await prisma.gameMessage.count({
      where: { gameId, deliveredAt: { not: null }, senderRole: 'LLM_PLAYER' },
    });
    if (revealed === 0) {
      throw new Error('At least one full round is required before judging');
    }
  }

  const labelMapping = game.labelMapping as unknown as LabelMapping;
  const actualHumanLabel = getLabelForRole('HUMAN_PLAYER', labelMapping);
  const verdict = humanIs === actualHumanLabel ? 'CORRECT' : 'INCORRECT';

  // Atomic: accept one verdict, from CONVERSATION (early call) or JUDGING
  const claimed = await prisma.game.updateMany({
    where: { id: gameId, status: { in: ['CONVERSATION', 'JUDGING'] } },
    data: {
      status: 'COMPLETED',
      verdict,
      verdictReason: reason,
      completedAt: new Date(),
      activePlayer: null,
    },
  });
  if (claimed.count === 0) {
    throw new Error('Game is not accepting a verdict');
  }

  connectionManager.broadcast(gameId, {
    type: 'verdict',
    data: {
      verdict,
      reason,
      humanPlayer: actualHumanLabel,
      llmModel: game.model,
    },
  });

  connectionManager.broadcast(gameId, {
    type: 'game-status',
    data: { status: 'COMPLETED' },
  });
}

/** Path a participant uses to join a game. */
export function participantPath(
  gameId: string,
  role: GameRole,
  token: string
): string {
  const page = role === 'JUDGE' ? 'judge' : 'play';
  return `/game/${gameId}/${page}?token=${token}`;
}

/**
 * Start a follow-up game with the same settings. Any participant may do
 * this (the caller abandons the current game first if it is still
 * running); each game gets at most one rematch, so a
 * second request (or the other participant's) joins the same new game.
 * Returns each role's join path for the new game.
 */
export async function createRematch(
  gameId: string
): Promise<Partial<Record<GameRole, string>>> {
  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });

  let rematchId = game.rematchGameId;
  if (!rematchId) {
    const { game: next } = await createGame({
      hostUserId: game.hostUserId,
      topic: game.topic,
      model: game.model,
      systemPrompt: game.systemPrompt ?? undefined,
      maxTurns: game.maxTurns,
      streamingDelay: game.streamingDelay,
      judgeMode: game.judgeMode,
      judgeModel: game.judgeModel ?? undefined,
      showJudgeNotes: game.showJudgeNotes,
    });
    // Atomic claim so two simultaneous requests end up in one game
    const claimed = await prisma.game.updateMany({
      where: { id: gameId, rematchGameId: null },
      data: { rematchGameId: next.id },
    });
    if (claimed.count === 1) {
      rematchId = next.id;
    } else {
      await prisma.game.delete({ where: { id: next.id } });
      rematchId = (
        await prisma.game.findUniqueOrThrow({ where: { id: gameId } })
      ).rematchGameId!;
    }
  }

  const participants = await prisma.gameParticipant.findMany({
    where: { gameId: rematchId },
  });
  const paths: Partial<Record<GameRole, string>> = {};
  for (const p of participants) {
    if (p.role !== 'LLM_PLAYER') {
      paths[p.role] = participantPath(rematchId, p.role, p.token);
    }
  }
  return paths;
}

/**
 * Cancel a game.
 */
export async function cancelGame(gameId: string): Promise<void> {
  await prisma.game.update({
    where: { id: gameId },
    data: { status: 'CANCELLED' },
  });

  connectionManager.broadcast(gameId, {
    type: 'game-status',
    data: { status: 'CANCELLED' },
  });

  connectionManager.cleanup(gameId);
}

/**
 * Run a background step with one retry; surface failure to clients
 * instead of silently stranding the game.
 */
function runDetached(
  gameId: string,
  label: string,
  fn: () => Promise<void>
): void {
  fn()
    .catch(async (err) => {
      console.error(`${label} failed for game ${gameId}, retrying:`, err);
      await sleep(3000);
      return fn();
    })
    .catch((err) => {
      console.error(`${label} failed twice for game ${gameId}:`, err);
      connectionManager.broadcast(gameId, {
        type: 'error',
        data: { message: `Something went wrong (${label}). Please retry.` },
      });
    });
}
