// Shared pieces for the simulation scripts (harness, evolution).
import { prisma } from '../../src/lib/db';
import { createGame, startGame, submitHumanAnswer } from '../../src/lib/game/game-service';
import {
  generateSimulatedHumanAnswer,
  generateLLMAnswer,
  buildGameFeedback,
  type GameFeedback,
} from '../../src/lib/game/llm-service';
import { pickPersona } from '../../src/lib/game/human-personas';
import type { Game, GameMessage, GameRole } from '../../src/generated/prisma/client';

const GAME_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_MS = 1500;

type GameWithMessages = Game & { messages: GameMessage[] };

export async function getHarnessHost() {
  return prisma.user.upsert({
    where: { email: 'harness@test.local' },
    update: {},
    create: { email: 'harness@test.local', displayName: 'Harness' },
  });
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The engine's prompts are written from the LLM seat's point of view. To
 * reuse them for a strategy sitting in the "human" seat, swap the roles
 * so that seat's own answers read as its answers.
 */
export function swapSeats(messages: GameMessage[]): GameMessage[] {
  return messages.map((m) =>
    m.senderRole === 'HUMAN_PLAYER'
      ? { ...m, senderRole: 'LLM_PLAYER' as GameRole }
      : m.senderRole === 'LLM_PLAYER'
        ? { ...m, senderRole: 'HUMAN_PLAYER' as GameRole }
        : m
  );
}

/**
 * What a finished game can teach the strategy that played in `seat`.
 * Judge notes are always included offline, whatever the game's setting.
 */
export async function collectFeedback(
  gameId: string,
  seat: 'LLM_PLAYER' | 'HUMAN_PLAYER' = 'LLM_PLAYER'
): Promise<GameFeedback | null> {
  const g = await prisma.game.findUniqueOrThrow({
    where: { id: gameId },
    include: { messages: { orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }] } },
  });
  if (g.status !== 'COMPLETED' || !g.verdict) return null;
  const history = seat === 'HUMAN_PLAYER' ? swapSeats(g.messages) : g.messages;
  // The judge was fooled (INCORRECT) when it picked the LLM seat as human.
  // From the human seat's point of view that is a loss, and vice versa.
  const verdict =
    seat === 'HUMAN_PLAYER'
      ? g.verdict === 'INCORRECT' ? 'CORRECT' : 'INCORRECT'
      : g.verdict;
  return buildGameFeedback(history, verdict, g.verdictReason ?? '');
}

/** A sample of answers real (non-simulated) humans gave, for calibration. */
export async function loadRealHumanAnswers(limit = 12): Promise<string[]> {
  const rows = await prisma.gameMessage.findMany({
    where: {
      senderRole: 'HUMAN_PLAYER',
      game: { humanModel: null, status: 'COMPLETED' },
    },
    select: { content: true },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  const texts = [...new Set(rows.map((r) => r.content.trim()).filter(Boolean))];
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }
  return texts.slice(0, limit);
}

export interface Outcome {
  gameId: string;
  persona: string;
  population: string;
  /** From the LLM seat's point of view */
  result: 'fooled' | 'caught' | 'failed';
  rounds: number;
  earlyVerdict: boolean;
  seconds: number;
}

/**
 * Drive one game through the real engine. The LLM seat is played by the
 * engine; `answerHumanSeat` supplies the other seat's answer each round.
 */
async function runGame(opts: {
  game: Game;
  answerHumanSeat: (g: GameWithMessages) => Promise<string>;
  persona: { id: string; population: string };
}): Promise<Outcome> {
  const { game } = opts;
  const started = Date.now();

  // The engine's steps run detached; we drive the other seat by polling.
  startGame(game.id).catch((err) =>
    console.error(`[${game.id.slice(0, 8)}] start failed:`, err)
  );

  let lastProgress = Date.now();
  let lastSignature = '';
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const g = await prisma.game.findUniqueOrThrow({
      where: { id: game.id },
      include: {
        messages: { orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }] },
      },
    });

    const signature = `${g.status}:${g.activePlayer}:${g.currentTurn}:${g.messages.length}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastProgress = Date.now();
    }

    if (g.status === 'COMPLETED') return outcome(g, opts.persona, started);
    if (g.status === 'CANCELLED' || Date.now() - lastProgress > GAME_TIMEOUT_MS) {
      console.error(`[${game.id.slice(0, 8)}] gave up (${g.status}, turn ${g.currentTurn})`);
      return { ...outcome(g, opts.persona, started), result: 'failed' };
    }

    const questionAsked = g.messages.some(
      (m) => m.senderRole === 'JUDGE' && m.turnNumber === g.currentTurn
    );
    const humanAnswered = g.messages.some(
      (m) => m.senderRole === 'HUMAN_PLAYER' && m.turnNumber === g.currentTurn
    );
    if (
      g.status === 'CONVERSATION' &&
      g.activePlayer === 'HUMAN_PLAYER' &&
      questionAsked &&
      !humanAnswered
    ) {
      try {
        await submitHumanAnswer(game.id, await opts.answerHumanSeat(g));
      } catch (err) {
        // Already answered (race) or a transient model error; the next poll retries
        console.warn(`[${game.id.slice(0, 8)}] other seat:`, (err as Error).message);
      }
    }
  }
}

/** A game against a simulated human played from a persona. */
export async function playOne(opts: {
  hostUserId: string;
  runId: string;
  contestant: string;
  judge: string;
  human: string;
  personaId?: string;
  questions: number;
  notes: boolean;
  /** Evaluate a fixed strategy instead of letting the contestant write one */
  strategy?: string;
}): Promise<Outcome> {
  const persona = pickPersona(opts.personaId);
  const { game } = await createGame({
    hostUserId: opts.hostUserId,
    model: opts.contestant,
    judgeMode: 'LLM',
    judgeModel: opts.judge,
    maxTurns: opts.questions,
    streamingDelay: 0,
    showJudgeNotes: opts.notes,
    humanModel: opts.human,
    humanPersona: persona.description,
    population: `simulated:${persona.id}`,
    harnessRunId: opts.runId,
    llmStrategy: opts.strategy,
    strategyLocked: opts.strategy !== undefined,
  });
  return runGame({
    game,
    persona,
    answerHumanSeat: async (g) =>
      generateSimulatedHumanAnswer({
        model: opts.human,
        persona: persona.description,
        conversationHistory: g.messages,
        realExamples: await loadRealHumanAnswers(),
      }),
  });
}

/**
 * A tournament match: two strategies, no human. The judge names one seat
 * as the human; that strategy wins. Returns the winner's index (0 = the
 * strategy in the LLM seat, 1 = the one in the other seat) or null.
 */
export async function playMatch(opts: {
  hostUserId: string;
  runId: string;
  model: string;
  judge: string;
  questions: number;
  notes: boolean;
  strategies: [{ id: string; text: string }, { id: string; text: string }];
}): Promise<{ outcome: Outcome; winner: 0 | 1 | null }> {
  const [a, b] = opts.strategies;
  const { game } = await createGame({
    hostUserId: opts.hostUserId,
    model: opts.model,
    judgeMode: 'LLM',
    judgeModel: opts.judge,
    maxTurns: opts.questions,
    streamingDelay: 0,
    showJudgeNotes: opts.notes,
    humanModel: opts.model,
    humanPersona: b.text,
    population: `tournament:${b.id}`,
    harnessRunId: opts.runId,
    llmStrategy: a.text,
    strategyLocked: true,
  });
  const outcome = await runGame({
    game,
    persona: { id: b.id, population: 'tournament' },
    answerHumanSeat: (g) =>
      generateLLMAnswer({
        model: opts.model,
        strategy: b.text,
        conversationHistory: swapSeats(g.messages),
        showJudgeNotes: opts.notes,
      }),
  });
  const winner =
    outcome.result === 'fooled' ? 0 : outcome.result === 'caught' ? 1 : null;
  return { outcome, winner };
}

export function outcome(
  g: Game & { messages: { senderRole: string }[] },
  persona: { id: string; population: string },
  started: number
): Outcome {
  const rounds = g.messages.filter((m) => m.senderRole === 'JUDGE').length;
  return {
    gameId: g.id,
    persona: persona.id,
    population: persona.population,
    result:
      g.verdict === 'INCORRECT' ? 'fooled' : g.verdict === 'CORRECT' ? 'caught' : 'failed',
    rounds,
    earlyVerdict: g.status === 'COMPLETED' && rounds < g.maxTurns,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}
