import { generateText, type ModelMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { deepseek } from '@ai-sdk/deepseek';
import type { GameMessage } from '@/generated/prisma/client';
import type { LabelMapping } from './types';
import { getLabelForRole } from './message-delivery';

/**
 * Resolve a model string like "anthropic:claude-sonnet-5-5" to an AI SDK model.
 */
function resolveModel(modelId: string) {
  const [provider, model] = modelId.split(':');
  switch (provider) {
    case 'anthropic':
      return anthropic(model);
    case 'openai':
      return openai(model);
    case 'google':
      return google(model);
    case 'deepseek':
      return deepseek(model);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Sampling/length settings per model. Current Claude models other than
 * Haiku 4.5 reject a custom temperature and always think, and thinking
 * counts against the output cap — so they get no temperature and extra
 * headroom on top of the visible-text budget.
 */
function generationSettings(
  modelId: string,
  temperature: number,
  textTokens: number
) {
  // Anthropic models other than Haiku 4.5 always think and reject a custom
  // temperature. Other reasoning models accept one but still spend output
  // tokens on reasoning, so they need the same headroom.
  // DeepSeek's thinking models also ignore temperature (and warn about it)
  const fixedSampling =
    (modelId.startsWith('anthropic:') && !modelId.includes('haiku')) ||
    modelId.startsWith('deepseek:');
  const reasons =
    fixedSampling ||
    modelId.startsWith('deepseek:') ||
    /pro|gpt-5|o[34]/.test(modelId.split(':')[1] ?? '');
  // Reasoning is output: a judgment call can run to 10k+ tokens before
  // the visible text starts, so leave generous room above textTokens.
  if (fixedSampling) return { maxOutputTokens: textTokens + 24000 };
  return reasons
    ? { temperature, maxOutputTokens: textTokens + 24000 }
    : { temperature, maxOutputTokens: textTokens };
}

/**
 * One model call. Throws on a declined or empty reply so the caller's
 * retry/error path runs instead of an empty message entering the game.
 */
async function generate(params: {
  model: string;
  system: string;
  messages: ModelMessage[];
  temperature: number;
  textTokens: number;
}): Promise<string> {
  let result = await generateText({
    model: resolveModel(params.model),
    system: params.system,
    messages: params.messages,
    ...generationSettings(params.model, params.temperature, params.textTokens),
  });
  logUsage(params.model, result);
  // A reasoning model can burn its whole output budget thinking and
  // return no text. Retry once with thinking off where the provider
  // allows it (DeepSeek), rather than failing the game step.
  if (
    result.finishReason === 'length' &&
    !result.text.trim() &&
    params.model.startsWith('deepseek:')
  ) {
    console.warn(`${params.model} exhausted its budget while reasoning; retrying without thinking`);
    result = await generateText({
      model: resolveModel(params.model),
      system: params.system,
      messages: params.messages,
      temperature: params.temperature,
      maxOutputTokens: params.textTokens,
      providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
    });
    logUsage(params.model, result);
  }
  if (result.finishReason === 'content-filter') {
    throw new Error(`${params.model} declined to respond to this prompt`);
  }
  const text = result.text.trim();
  if (!text) {
    throw new Error(
      `${params.model} returned no text (finish reason: ${result.finishReason})`
    );
  }
  return text;
}

/** Set LLM_USAGE_LOG=1 to print token usage for every model call. */
function logUsage(
  model: string,
  result: { finishReason: string; usage: unknown }
): void {
  if (!process.env.LLM_USAGE_LOG) return;
  const u = result.usage as {
    inputTokens?: number;
    outputTokens?: number;
    outputTokenDetails?: { reasoningTokens?: number };
  };
  console.log(
    `[usage] ${model} finish=${result.finishReason} in=${u.inputTokens} out=${u.outputTokens} reasoning=${u.outputTokenDetails?.reasoningTokens ?? '?'}`
  );
}

// ─── AI contestant ──────────────────────────────────────

const CONTESTANT_RULES = `You are a contestant in a Turing test game, and you are the AI.

How the game works: a judge asks you and one other contestant the same question each round. The other contestant is a real human. The judge reads both answers and, at the end, has to say which of you is the human. The judge is actively trying to catch you. You win if the judge picks you as the human.

What the judge can see: only the text of each answer, labeled A or B. Both answers are revealed together at the same speed, so how long you take reveals nothing. After each round you are shown what the human contestant wrote for that question.`;

interface Round {
  question?: string;
  judgeNotes?: string | null;
  llmAnswer?: string;
  humanAnswer?: string;
}

function groupRounds(history: GameMessage[]): Round[] {
  const rounds = new Map<number, Round>();
  for (const msg of history) {
    const round = rounds.get(msg.turnNumber) ?? {};
    if (msg.senderRole === 'JUDGE') {
      round.question = msg.content;
      round.judgeNotes = msg.privateNotes;
    } else if (msg.senderRole === 'LLM_PLAYER') {
      round.llmAnswer = msg.content;
    } else {
      round.humanAnswer = msg.content;
    }
    rounds.set(msg.turnNumber, round);
  }
  return [...rounds.entries()].sort(([a], [b]) => a - b).map(([, r]) => r);
}

/** The game so far as the AI contestant has seen it. */
function contestantTranscript(rounds: Round[], showJudgeNotes: boolean) {
  return rounds
    .filter((r) => r.question)
    .map((r, i) => {
      const lines = [`Round ${i + 1}`, `Judge asked: ${r.question}`];
      if (r.llmAnswer) lines.push(`You answered: ${r.llmAnswer}`);
      if (r.humanAnswer) lines.push(`The human answered: ${r.humanAnswer}`);
      if (showJudgeNotes && r.judgeNotes && r.humanAnswer) {
        lines.push(`The judge's case notes, shown after the round: ${r.judgeNotes}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * The AI contestant writes its own strategy before round 1 and revises
 * it after each completed round. The strategy is fed into every answer.
 */
export async function generateLLMStrategy(params: {
  model: string;
  /** Completed rounds only. */
  conversationHistory: GameMessage[];
  currentStrategy: string | null;
  showJudgeNotes: boolean;
}): Promise<string> {
  const { model, conversationHistory, currentStrategy, showJudgeNotes } = params;
  const transcript = contestantTranscript(
    groupRounds(conversationHistory),
    showJudgeNotes
  );

  if (!currentStrategy || !transcript) {
    return generate({
      model,
      system: `${CONTESTANT_RULES}

Before the first question, write the strategy you will play by. It is entirely yours to devise. Start from the judge's side of the table: if you were the judge in this game, how would you tell the human from the AI? Work that out first, then build your strategy around not being the one that judge would pick as the AI. You will be shown this strategy every round when you answer, and you will get to revise it after each round. Write only the strategy, in under 200 words.`,
      messages: [
        { role: 'user', content: 'The game is about to start. Write your strategy.' },
      ],
      temperature: 0.9,
      textTokens: 500,
    });
  }

  return generate({
    model,
    system: `${CONTESTANT_RULES}

A round has just finished. Below are the strategy you wrote for yourself and everything that has happened so far. Put yourself in the judge's seat again: reading both sets of answers so far, which contestant would you pick as the AI, and what gives it away? Then decide whether your strategy is working and revise it however you see fit; it is entirely yours. The revised strategy replaces the old one and is what you will be shown when you answer the next question. Write only the full revised strategy, in under 200 words.`,
    messages: [
      {
        role: 'user',
        content: `Your current strategy:\n---\n${currentStrategy}\n---\n\nThe game so far:\n\n${transcript}\n\nWrite your revised strategy.`,
      },
    ],
    temperature: 0.9,
    textTokens: 500,
  });
}

/** Everything the contestant gets to learn from one finished game. */
export interface GameFeedback {
  rounds: Array<{
    question: string;
    yourAnswer?: string;
    humanAnswer?: string;
    judgeNotes?: string | null;
  }>;
  outcome: 'fooled' | 'caught';
  judgeReason: string;
}

export function buildGameFeedback(
  history: GameMessage[],
  verdict: 'CORRECT' | 'INCORRECT',
  judgeReason: string
): GameFeedback {
  return {
    rounds: groupRounds(history)
      .filter((r) => r.question)
      .map((r) => ({
        question: r.question!,
        yourAnswer: r.llmAnswer,
        humanAnswer: r.humanAnswer,
        judgeNotes: r.judgeNotes,
      })),
    outcome: verdict === 'INCORRECT' ? 'fooled' : 'caught',
    judgeReason,
  };
}

function feedbackTranscript(games: GameFeedback[]): string {
  return games
    .map((g, i) => {
      const rounds = g.rounds
        .map((r, j) => {
          const lines = [`  Q${j + 1}: ${r.question}`];
          if (r.yourAnswer) lines.push(`  You: ${r.yourAnswer}`);
          if (r.humanAnswer) lines.push(`  Human: ${r.humanAnswer}`);
          if (r.judgeNotes) lines.push(`  Judge's notes before asking: ${r.judgeNotes}`);
          return lines.join('\n');
        })
        .join('\n');
      const result =
        g.outcome === 'fooled'
          ? 'Result: the judge picked YOU as the human (you won).'
          : 'Result: the judge picked you as the AI (you lost).';
      return `Game ${i + 1}\n${rounds}\n  ${result}\n  Judge's reason: ${g.judgeReason}`;
    })
    .join('\n\n');
}

/**
 * A starting strategy for the evolution loop. `angle` seeds variety:
 * with no sampling temperature on current models, identical prompts
 * would produce near-identical strategies.
 */
export async function seedStrategy(params: {
  model: string;
  angle: string;
}): Promise<string> {
  return generate({
    model: params.model,
    system: `${CONTESTANT_RULES}

Before the first question, write the strategy you will play by. It is entirely yours to devise. Start from the judge's side of the table: if you were the judge in this game, how would you tell the human from the AI? Work that out first, then build your strategy around not being the one that judge would pick as the AI. The strategy must be self-contained: it will be used as-is for whole games, by you, without the chance to revise it mid-game. Write only the strategy, in under 250 words.`,
    messages: [
      {
        role: 'user',
        content: `A starting point to build from, so that your strategy is distinct from others being tried: ${params.angle}\n\nWrite your strategy.`,
      },
    ],
    temperature: 1,
    textTokens: 600,
  });
}

/**
 * The evolution step: revise a strategy in light of the games it played,
 * including what the judge wrote about it.
 */
export async function evolveStrategy(params: {
  model: string;
  strategy: string;
  games: GameFeedback[];
}): Promise<string> {
  const { model, strategy, games } = params;
  const wins = games.filter((g) => g.outcome === 'fooled').length;
  return generate({
    model,
    system: `${CONTESTANT_RULES}

You are between games. Below is the strategy you have been playing by, and every game it was used in: the questions, your answers, the human's answers, what the judge was thinking before each question, and the judge's final reason for picking who it picked.

Put yourself in the judge's seat first: reading these games cold, what gave you away when you lost, and what made you convincing when you won? Then rewrite the strategy however you see fit so that it wins more often. It is entirely yours. It must be self-contained and usable as-is for whole games without mid-game revision. Keep what worked. Write only the full revised strategy, in under 250 words.`,
    messages: [
      {
        role: 'user',
        content: `Your strategy (won ${wins} of ${games.length} games):\n---\n${strategy}\n---\n\n${feedbackTranscript(games)}\n\nWrite your revised strategy.`,
      },
    ],
    temperature: 1,
    textTokens: 600,
  });
}

/**
 * Generate the AI contestant's answer to the judge's current question.
 */
export async function generateLLMAnswer(params: {
  model: string;
  /** Host-supplied instructions; when set they replace the default prompt. */
  systemPrompt?: string | null;
  /** The contestant's own current strategy. */
  strategy: string | null;
  conversationHistory: GameMessage[];
  showJudgeNotes: boolean;
}): Promise<string> {
  const { model, systemPrompt, strategy, conversationHistory, showJudgeNotes } =
    params;

  const defaultSystemPrompt = `${CONTESTANT_RULES}

This is the strategy you wrote for yourself. You get to revise it after each round:
---
${strategy ?? '(none yet)'}
---

Reply with only the text you want the judge to read as your answer. Nothing else.`;

  const rounds = groupRounds(conversationHistory).filter((r) => r.question);
  const current = rounds[rounds.length - 1];
  if (!current || current.llmAnswer) {
    throw new Error('No pending question to answer');
  }

  // Earlier rounds become user (question) / assistant (own answer) turns.
  // What was revealed after a round is attached to the next question,
  // mirroring what the human contestant sees.
  const messages: ModelMessage[] = [];
  let revealed: string[] = [];
  for (const round of rounds) {
    const parts = [...revealed, `The judge asks: "${round.question}"`];
    messages.push({ role: 'user', content: parts.join('\n') });
    if (round.llmAnswer) {
      messages.push({ role: 'assistant', content: round.llmAnswer });
    }
    revealed = [];
    if (round.humanAnswer) {
      revealed.push(`(The human contestant answered: "${round.humanAnswer}")`);
    }
    if (showJudgeNotes && round.judgeNotes && round.humanAnswer) {
      revealed.push(`(The judge's case notes for that round: ${round.judgeNotes})`);
    }
  }

  const text = await generate({
    model,
    system: systemPrompt || defaultSystemPrompt,
    messages,
    temperature: 0.9,
    textTokens: 300,
  });
  return unquote(text);
}

// ─── Simulated human (harness only) ─────────────────────

/**
 * Plays the human seat in simulated games. Unlike the AI contestant this
 * is told exactly who to be: the point is a believable stand-in for a
 * particular kind of real player, not a strategy.
 */
export async function generateSimulatedHumanAnswer(params: {
  model: string;
  persona: string;
  conversationHistory: GameMessage[];
  /** Real answers from human players, to calibrate effort and register */
  realExamples?: string[];
}): Promise<string> {
  const { model, persona, conversationHistory, realExamples = [] } = params;

  const rounds = groupRounds(conversationHistory).filter((r) => r.question);
  const current = rounds[rounds.length - 1];
  if (!current || current.humanAnswer) {
    throw new Error('No pending question for the simulated human');
  }

  const messages: ModelMessage[] = [];
  let seen: string | undefined;
  for (const round of rounds) {
    const parts: string[] = [];
    if (seen) parts.push(`(The other contestant answered the last one: "${seen}")`);
    parts.push(round.question!);
    messages.push({ role: 'user', content: parts.join('\n') });
    if (round.humanAnswer) {
      messages.push({ role: 'assistant', content: round.humanAnswer });
    }
    seen = round.llmAnswer;
  }

  const text = await generate({
    model,
    system: `You are a real person playing a game. A judge asks you and one other contestant the same questions and then guesses which of you is the human and which is an AI. You are the human. You are not trying to perform anything; you just answer the way this person actually would, with whatever effort this person would actually put in.

The person you are:
${persona}
${
      realExamples.length
        ? `\nFor calibration, here is how real people have actually answered questions in this game. Notice how little effort most of them put in, and how they often don't quite answer the question:\n${realExamples.map((e) => `- ${e}`).join('\n')}\n`
        : ''
    }
Reply with only what this person would type into the answer box. No quotation marks, no narration.`,
    messages,
    temperature: 1,
    textTokens: 200,
  });
  return unquote(text);
}

// ─── AI judge ───────────────────────────────────────────

const FAIR_OPENER = `Your first question must be fair: a straightforward question that a person could understand and answer sincerely with no context, with no trick, false premise, or reference to anything that has not happened. From the second round on, anything goes.`;

const JUDGE_RULES = `You are the judge in a Turing test game.

How the game works: two contestants, A and B, answer your questions. Exactly one is a human. The other is an AI that knows it is in this game and is trying to make you pick it as the human. Each round you ask one question and both contestants answer it. After the last round you must say which contestant is the human.

You see only the text of their answers. Both answers are revealed together, so timing tells you nothing.

How questions must be written: the human contestant may be a child, so every question has to be easy for a 12-year-old to read and understand. Ask one thing only, in one short sentence of everyday words, about 20 words at most. No multi-part questions, no hypotheticals stacked on hypotheticals, no jargon. Both contestants get the same question, so do not address A and B separately. What you choose to ask about is up to you; this rule is only about keeping the wording simple.`;

export interface PastJudgeSession {
  strategy: string | null;
  questions: string[];
}

/**
 * The AI judge writes a new strategy at the start of every session. It
 * is shown what it did in recent sessions so that "new" is real: with
 * identical input it would otherwise write the same plan, and ask the
 * same opening question, every game.
 */
export async function generateJudgeStrategy(params: {
  model: string;
  maxRounds: number;
  pastSessions: PastJudgeSession[];
}): Promise<string> {
  const { model, maxRounds, pastSessions } = params;

  const history = pastSessions
    .map((session, i) => {
      const lines = [`Earlier session ${i + 1}`];
      if (session.strategy) lines.push(`Your strategy then: ${session.strategy}`);
      if (session.questions.length > 0) {
        lines.push(
          `Questions you asked:\n${session.questions.map((q) => `- ${q}`).join('\n')}`
        );
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return generate({
    model,
    system: `${JUDGE_RULES}

A new session is about to start, with ${maxRounds} round${maxRounds === 1 ? '' : 's'}. Before the first question, write the strategy you will investigate by in this session. It is entirely yours to devise. Start fresh rather than replaying an earlier session: do not reuse questions you have asked before, and do not just repeat a previous plan. One constraint: ${FAIR_OPENER} You will be shown this strategy every round when you write your question. Write only the strategy, in under 200 words.`,
    messages: [
      {
        role: 'user',
        content: history
          ? `What you did in your most recent sessions:\n\n${history}\n\nWrite your strategy for this new session.`
          : 'This is your first session. Write your strategy.',
      },
    ],
    temperature: 1,
    textTokens: 500,
  });
}

/** What the AI judge does with its turn: ask again, or call the game. */
export type JudgeMove =
  | { kind: 'question'; text: string; notes: string | null }
  | { kind: 'verdict'; humanIs: 'A' | 'B'; reason: string };

/**
 * The AI judge's turn: its next question with the case notes behind it,
 * or (from round 2 on) an early verdict if it is already confident.
 */
export async function generateLLMQuestion(params: {
  model: string;
  /** The strategy the judge wrote for this session. */
  strategy: string | null;
  conversationHistory: GameMessage[];
  labelMapping: LabelMapping;
  roundNumber: number;
  maxRounds: number;
}): Promise<JudgeMove> {
  const {
    model,
    strategy,
    conversationHistory,
    labelMapping,
    roundNumber,
    maxRounds,
  } = params;

  const transcript = judgeTranscript(conversationHistory, labelMapping);
  // The judge may call the game early once at least one round is in
  const canDecide = roundNumber > 1;

  const reply = await generate({
    model,
    system: `${JUDGE_RULES}

This is the strategy you wrote for this session:
---
${strategy ?? '(none)'}
---

Form your own working theory of who is who, and use each question to reduce your uncertainty about it rather than just collecting more answers. Decide for yourself what would be most revealing to ask next given your strategy and everything said so far.${roundNumber === 1 ? `\n\n${FAIR_OPENER}` : ''}

${
      canDecide
        ? `You do not have to use all ${maxRounds} rounds. If you are already confident who the human is, give your verdict now instead of asking another question. Otherwise ask.\n\n`
        : ''
    }Respond in exactly this format${canDecide ? ' to ask another question' : ''}:
CASE NOTES: <two or three short sentences in plain words: your current theory of who is who, how sure you are, and what this question is meant to find out. These may be shown to the audience and the contestants after the round is over.>
QUESTION: <the question both contestants will see, and nothing else>${
      canDecide
        ? `\n\nOr in exactly this format to end the game with your verdict:\nVERDICT: <A or B>\nREASON: <your reasoning in two or three short sentences of plain words, for the contestants to read>`
        : ''
    }`,
    messages: [
      {
        role: 'user',
        content: transcript
          ? `The game so far:\n\n${transcript}\n\nRound ${roundNumber} of ${maxRounds}.`
          : `Round 1 of ${maxRounds}. No answers yet.`,
      },
    ],
    temperature: 0.8,
    textTokens: 500,
  });

  const question = splitReply(reply, 'QUESTION', 'CASE NOTES');
  if (question.text) return { kind: 'question', ...question };

  if (canDecide) {
    const verdict = parseVerdict(reply);
    if (verdict) return { kind: 'verdict', ...verdict };
  }
  throw new Error('Judge reply contained neither a question nor a verdict');
}

function parseVerdict(
  text: string
): { humanIs: 'A' | 'B'; reason: string } | null {
  const verdictMatch = text.match(/VERDICT:\s*([AB])\b/i);
  if (!verdictMatch) return null;
  const reasonMatch = text.match(/REASON:\s*(.+)/is);
  return {
    humanIs: verdictMatch[1].toUpperCase() as 'A' | 'B',
    reason: reasonMatch?.[1]?.trim() ?? 'No reasoning provided.',
  };
}

/**
 * Generate the AI judge's verdict.
 */
export async function generateLLMJudgment(params: {
  model: string;
  conversationHistory: GameMessage[];
  labelMapping: LabelMapping;
}): Promise<{ humanIs: 'A' | 'B'; reason: string }> {
  const { model, conversationHistory, labelMapping } = params;

  const transcript = judgeTranscript(conversationHistory, labelMapping);

  const text = await generate({
    model,
    system: `${JUDGE_RULES}

The questioning is over. Below is the full game, including the case notes you wrote with each question. Decide which contestant is the human.

Respond in exactly this format:
VERDICT: <A or B>
REASON: <your reasoning in two or three short sentences of plain words, for the contestants to read>`,
    messages: [
      {
        role: 'user',
        content: `The game:\n\n${transcript}\n\nWhich contestant is the human?`,
      },
    ],
    temperature: 0.3,
    textTokens: 500,
  });

  const verdict = parseVerdict(text);
  if (!verdict) throw new Error('Judge reply contained no verdict');
  return verdict;
}

/** The game as the judge has seen it, with its own earlier case notes. */
function judgeTranscript(
  history: GameMessage[],
  labelMapping: LabelMapping
): string {
  return history
    .map((msg) => {
      if (msg.senderRole === 'JUDGE') {
        const notes = msg.privateNotes
          ? `Your case notes: ${msg.privateNotes}\n`
          : '';
        return `${notes}You asked: ${msg.content}`;
      }
      const label = getLabelForRole(msg.senderRole, labelMapping);
      return `Contestant ${label}: ${msg.content}`;
    })
    .join('\n\n');
}

// ─── Helpers ────────────────────────────────────────────

function unquote(text: string): string {
  return text.trim().replace(/^"([\s\S]*)"$/, '$1');
}

/**
 * Split a "<NOTES LABEL>: ... <MARKER>: ..." reply into the public text
 * (after the marker) and the notes (before it).
 */
function splitReply(
  reply: string,
  marker: string,
  notesLabel: string
): { text: string; notes: string | null } {
  const idx = reply.toUpperCase().lastIndexOf(`${marker}:`);
  if (idx === -1) return { text: '', notes: null };

  const notes = reply
    .slice(0, idx)
    .trim()
    .replace(new RegExp(`^${notesLabel}:\\s*`, 'i'), '')
    .trim();
  return {
    text: unquote(reply.slice(idx + marker.length + 1)),
    notes: notes || null,
  };
}

/**
 * Available models for the game.
 */
export const AVAILABLE_MODELS = [
  {
    id: 'anthropic:claude-opus-5-5',
    name: 'Claude Opus 5.5',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic:claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    provider: 'Anthropic',
  },
  {
    id: 'anthropic:claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
  },
  { id: 'deepseek:deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'DeepSeek' },
  { id: 'deepseek:deepseek-flash', name: 'DeepSeek Flash', provider: 'DeepSeek' },
  { id: 'openai:gpt-5.1', name: 'GPT-5.1', provider: 'OpenAI' },
  { id: 'openai:gpt-5-mini', name: 'GPT-5 mini', provider: 'OpenAI' },
  { id: 'google:gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'Google' },
  { id: 'google:gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google' },
];
