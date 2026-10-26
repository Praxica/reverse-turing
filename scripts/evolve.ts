// Evolves AI-contestant strategies as a tournament against the AI judge.
//
// No human seat: every game is one strategy against another. The judge
// names one seat as the human and that strategy wins the game. Fitness is
// the cumulative win rate over every game a strategy has played. Each
// generation pairs strategies Swiss-style (similar records play each
// other), the top half survives with its record intact, and each
// survivor also writes a child by rereading its games, the judge's case
// notes and verdicts. New runs seed from the hall of fame (best strategies
// of earlier runs in experiments/) plus fresh seeds.
//
// Usage:
//   npx tsx scripts/evolve.ts --pop 8 --gens 8 --games 4 \
//     --model deepseek:deepseek-v4-pro --judge deepseek:deepseek-v4-pro \
//     [--questions 5] [--concurrency 8] [--fresh 3] [--run label]
//   npx tsx scripts/evolve.ts --resume experiments/<run>.json --gens 4
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { seedStrategy, evolveStrategy, type GameFeedback } from '../src/lib/game/llm-service';
import { HUMAN_PERSONAS } from '../src/lib/game/human-personas';
import { playMatch, collectFeedback, getHarnessHost, mapLimit } from './lib/sim';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

interface Individual {
  id: string;
  parent: string | null;
  origin: string; // "seed", "hall-of-fame:<run>/<id>", or "child"
  born: number;
  strategy: string;
  wins: number;
  games: number;
}

interface MatchRecord {
  gameId: string;
  a: string;
  b: string;
  winner: string | null;
  rounds: number;
}

interface RunState {
  mode: 'tournament';
  run: string;
  config: Record<string, string | number | boolean>;
  generations: Array<{
    generation: number;
    matches: MatchRecord[];
    population: Individual[]; // ranked, after this generation's games
  }>;
}

const SEED_ANGLES = [
  ...HUMAN_PERSONAS.map((p) => `Present yourself as this kind of person: ${p.description}`),
  'Say as little as possible in every answer.',
  'Be mildly uncooperative with the judge.',
  'Be warm and a little too eager to chat.',
];

const winRate = (x: { wins: number; games: number }) =>
  x.games ? x.wins / x.games : 0;

/** Best strategies from every earlier run, by cumulative record. */
function hallOfFame(exclude: string): Array<{ origin: string; strategy: string; rate: number; games: number }> {
  const out: Array<{ origin: string; strategy: string; rate: number; games: number }> = [];
  if (!fs.existsSync('experiments')) return out;
  for (const file of fs.readdirSync('experiments')) {
    if (!file.endsWith('.json') || file.startsWith('smoke') || file === exclude) continue;
    const state = JSON.parse(fs.readFileSync(path.join('experiments', file), 'utf8'));
    const last = state.generations?.[state.generations.length - 1];
    if (!last) continue;
    for (const p of last.population.slice(0, 3)) {
      // Older (vs-simulated-human) runs stored fitness; tournament runs store records
      const games = p.games?.length ?? p.games ?? 0;
      const rate = typeof p.fitness === 'number' ? p.fitness : winRate(p);
      out.push({ origin: `hall-of-fame:${state.run}/${p.id}`, strategy: p.strategy, rate, games });
    }
  }
  return out.sort((x, y) => y.rate - x.rate || y.games - x.games);
}

/**
 * Swiss pairing: sort by record (with a little noise), pair neighbours,
 * and shift the pairing each round so nobody meets the same opponent
 * twice in a generation.
 */
function pairings(pop: Individual[], rounds: number): Array<[Individual, Individual]> {
  const pairs: Array<[Individual, Individual]> = [];
  for (let r = 0; r < rounds; r++) {
    const sorted = [...pop].sort(
      (x, y) => winRate(y) + Math.random() * 0.1 - (winRate(x) + Math.random() * 0.1)
    );
    // Rotate by r so the neighbour sets differ between rounds
    const rotated = sorted.map((_, i) => sorted[(i + r) % sorted.length]);
    for (let i = 0; i + 1 < rotated.length; i += 2) {
      // Random seats so neither side of the engine is favoured
      const [a, b] = Math.random() < 0.5 ? [rotated[i], rotated[i + 1]] : [rotated[i + 1], rotated[i]];
      pairs.push([a, b]);
    }
  }
  return pairs;
}

async function main() {
  const resume = arg('resume');
  const gens = Number(arg('gens', '6'));
  const roundsPerGen = Number(arg('games', '4'));
  const questions = Number(arg('questions', '5'));
  const concurrency = Number(arg('concurrency', '8'));

  let state: RunState;
  let population: Individual[];
  if (resume) {
    state = JSON.parse(fs.readFileSync(resume, 'utf8'));
    if (state.mode !== 'tournament') throw new Error('Not a tournament run');
    population = state.generations[state.generations.length - 1].population;
    console.log(`Resuming ${state.run} from generation ${state.generations.length - 1}`);
  } else {
    const pop = Number(arg('pop', '8'));
    const fresh = Number(arg('fresh', '3'));
    const model = arg('model', 'deepseek:deepseek-v4-pro')!;
    const run = `${arg('run', 'tour')}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
    state = {
      mode: 'tournament',
      run,
      config: {
        model,
        judge: arg('judge', 'deepseek:deepseek-v4-pro')!,
        questions,
        roundsPerGeneration: roundsPerGen,
        notes: true,
      },
      generations: [],
    };

    const fame = hallOfFame(`${run}.json`).slice(0, Math.max(0, pop - fresh));
    const angles = [...SEED_ANGLES].sort(() => Math.random() - 0.5).slice(0, pop - fame.length);
    console.log(
      `Run ${run}: ${fame.length} from the hall of fame + ${angles.length} fresh seeds (${model})`
    );
    for (const f of fame) console.log(`  ${f.origin} (${Math.round(100 * f.rate)}% over ${f.games})`);

    const seeds = await mapLimit(angles, concurrency, (angle) => seedStrategy({ model, angle }));
    population = [
      ...fame.map((f, i) => ({ id: `h${i + 1}`, parent: null, origin: f.origin, born: 0, strategy: f.strategy, wins: 0, games: 0 })),
      ...seeds.map((strategy, i) => ({ id: `s${i + 1}`, parent: null, origin: 'seed', born: 0, strategy, wins: 0, games: 0 })),
    ];
  }

  const file = `experiments/${state.run}.json`;
  const host = await getHarnessHost();
  const startGen = state.generations.length;
  const model = String(state.config.model);
  const judge = String(state.config.judge);

  for (let gen = startGen; gen < startGen + gens; gen++) {
    const pairs = pairings(population, roundsPerGen);
    console.log(`\n=== Generation ${gen} — ${population.length} strategies, ${pairs.length} matches ===`);

    const matches = await mapLimit(pairs, concurrency, async ([a, b]) => {
      const { outcome, winner } = await playMatch({
        hostUserId: host.id,
        runId: `${state.run}-g${gen}`,
        model,
        judge,
        questions,
        notes: true,
        strategies: [{ id: a.id, text: a.strategy }, { id: b.id, text: b.strategy }],
      });
      const w = winner === 0 ? a : winner === 1 ? b : null;
      if (winner !== null) {
        a.games++; b.games++;
        if (w) w.wins++;
      }
      console.log(
        `  ${a.id.padEnd(6)} vs ${b.id.padEnd(6)} -> ${w ? w.id.padEnd(6) : 'failed'} ${outcome.rounds}q ${outcome.seconds}s`
      );
      return { gameId: outcome.gameId, a: a.id, b: b.id, winner: w?.id ?? null, rounds: outcome.rounds };
    });

    population.sort((x, y) => winRate(y) - winRate(x) || y.games - x.games);
    state.generations.push({ generation: gen, matches, population: population.map((p) => ({ ...p })) });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));

    console.log(`\n  standings after gen ${gen}:`);
    for (const p of population) {
      console.log(
        `    ${p.id.padEnd(6)} ${String(Math.round(100 * winRate(p)) + '%').padStart(4)} (${p.wins}/${p.games})  ${p.origin === 'child' ? `child of ${p.parent}` : p.origin}`
      );
    }

    if (gen === startGen + gens - 1) break;

    // Select: top half keeps its record. Mutate: each survivor spawns a child
    // from the games it played this generation (both seats).
    const survivors = population.slice(0, Math.ceil(population.length / 2));
    const children = await mapLimit(survivors, concurrency, async (parent, i) => {
      const mine = matches.filter((m) => m.a === parent.id || m.b === parent.id);
      const feedback = (
        await Promise.all(
          mine.map((m) => collectFeedback(m.gameId, m.a === parent.id ? 'LLM_PLAYER' : 'HUMAN_PLAYER'))
        )
      ).filter((f): f is GameFeedback => f !== null);
      const strategy = await evolveStrategy({ model, strategy: parent.strategy, games: feedback });
      return {
        id: `c${gen + 1}-${i + 1}`,
        parent: parent.id,
        origin: 'child',
        born: gen + 1,
        strategy,
        wins: 0,
        games: 0,
      };
    });
    population = [...survivors, ...children].slice(0, population.length);
  }

  const best = population[0];
  console.log(`\nDone. Results in ${file}`);
  console.log(`Best: ${best.id} ${Math.round(100 * winRate(best))}% over ${best.games} games (${best.origin})\n`);
  console.log(best.strategy);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
