// Simulation harness: plays fully automated games (AI contestant, AI judge,
// simulated human) through the real game engine with delays off, then
// reports how often the judge was fooled.
//
// Usage:
//   npx tsx scripts/harness.ts --games 10 --contestant deepseek:deepseek-v4-pro \
//     --judge deepseek:deepseek-v4-pro --human deepseek:deepseek-flash \
//     [--persona kid-bored] [--questions 5] [--concurrency 4] [--notes] [--run label]
//   npx tsx scripts/harness.ts --report <runId>
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { HUMAN_PERSONAS } from '../src/lib/game/human-personas';
import { playOne, outcome, getHarnessHost, type Outcome } from './lib/sim';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

function summarize(outcomes: Outcome[], label: string) {
  const done = outcomes.filter((o) => o.result !== 'failed');
  const fooled = done.filter((o) => o.result === 'fooled').length;
  const pct = done.length ? Math.round((100 * fooled) / done.length) : 0;
  console.log(`\n${label}`);
  console.log(
    `  games: ${outcomes.length}  completed: ${done.length}  failed: ${outcomes.length - done.length}`
  );
  console.log(`  judge fooled: ${fooled}/${done.length} (${pct}%)`);
  if (done.length) {
    const avgRounds = (done.reduce((n, o) => n + o.rounds, 0) / done.length).toFixed(1);
    const early = done.filter((o) => o.earlyVerdict).length;
    const avgSec = Math.round(done.reduce((n, o) => n + o.seconds, 0) / done.length);
    console.log(`  avg questions: ${avgRounds}  early verdicts: ${early}  avg time: ${avgSec}s`);
  }
  const byPop = new Map<string, Outcome[]>();
  for (const o of done) byPop.set(o.population, [...(byPop.get(o.population) ?? []), o]);
  for (const [pop, list] of byPop) {
    const f = list.filter((o) => o.result === 'fooled').length;
    console.log(`  vs ${pop.padEnd(7)} fooled ${f}/${list.length}`);
  }
}

async function report(runId: string) {
  const games = await prisma.game.findMany({
    where: { harnessRunId: runId },
    include: { messages: { select: { senderRole: true } } },
  });
  const outcomes = games.map((g) => {
    const id = g.population?.replace('simulated:', '') ?? 'unknown';
    const persona = HUMAN_PERSONAS.find((p) => p.id === id);
    return outcome(g, { id, population: persona?.population ?? 'unknown' }, Date.now());
  });
  summarize(outcomes, `Run ${runId}`);
}

async function main() {
  const reportId = arg('report');
  if (reportId) return report(reportId);

  const games = Number(arg('games', '10'));
  const contestant = arg('contestant', 'deepseek:deepseek-v4-pro')!;
  const judge = arg('judge', 'deepseek:deepseek-v4-pro')!;
  const human = arg('human', 'deepseek:deepseek-flash')!;
  const personaId = arg('persona');
  const questions = Number(arg('questions', '5'));
  const concurrency = Number(arg('concurrency', '4'));
  const notes = arg('notes') === 'true';
  const runId = `${arg('run', 'run')}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

  const host = await getHarnessHost();

  console.log(
    `Run ${runId}: ${games} games, contestant=${contestant} judge=${judge} human=${human}` +
      ` persona=${personaId ?? 'random'} questions=${questions} notes=${notes}`
  );

  const outcomes: Outcome[] = [];
  let next = 0;
  async function worker() {
    while (next < games) {
      const n = ++next;
      const o = await playOne({ hostUserId: host.id, runId, contestant, judge, human, personaId, questions, notes });
      outcomes.push(o);
      console.log(
        `  #${n} ${o.result.padEnd(6)} vs ${o.persona.padEnd(14)} ${o.rounds}q${o.earlyVerdict ? ' (early)' : ''} ${o.seconds}s  ${o.gameId.slice(0, 8)}`
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, games) }, worker));
  summarize(outcomes, `Run ${runId}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
