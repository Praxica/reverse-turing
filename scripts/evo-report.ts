// Summarizes an evolution run: fitness per generation, lineage of the
// winner, and the winning strategy text.
// Usage: npx tsx scripts/evo-report.ts experiments/<run>.json [--full]
import fs from 'node:fs';

interface Evaluated {
  id: string;
  parent: string | null;
  origin?: string;
  born: number;
  strategy: string;
  // vs-simulated-human runs
  fitness?: number;
  // tournament runs: cumulative record
  wins?: number;
  games: Array<{ result: string; persona: string; population: string }> | number;
}
interface RunState {
  mode?: 'tournament';
  run: string;
  config: Record<string, unknown>;
  generations: Array<{
    generation: number;
    population: Evaluated[];
    matches?: Array<{ a: string; b: string; winner: string | null }>;
  }>;
}

const score = (p: Evaluated) =>
  typeof p.fitness === 'number'
    ? p.fitness
    : typeof p.games === 'number' && p.games
      ? (p.wins ?? 0) / p.games
      : 0;
const played = (p: Evaluated) => (typeof p.games === 'number' ? p.games : p.games.length);

const file = process.argv[2];
const full = process.argv.includes('--full');
const state: RunState = JSON.parse(fs.readFileSync(file, 'utf8'));

console.log(`${state.run}  ${JSON.stringify(state.config)}\n`);
if (state.mode === 'tournament') {
  console.log('gen  matches  leader                 standings (cumulative win rate)');
  for (const g of state.generations) {
    const pop = g.population;
    const per = pop.map((p) => `${p.id}:${Math.round(100 * score(p))}%/${played(p)}`).join(' ');
    const lead = `${pop[0].id} ${Math.round(100 * score(pop[0]))}% (${pop[0].wins}/${played(pop[0])})`;
    console.log(`${String(g.generation).padEnd(4)} ${String(g.matches?.length ?? 0).padEnd(8)} ${lead.padEnd(22)} ${per}`);
  }
} else {
  console.log('gen  best   mean   games  fooled   per strategy');
  for (const g of state.generations) {
    const pop = g.population;
    const all = pop.flatMap((p) => (typeof p.games === 'number' ? [] : p.games)).filter((x) => x.result !== 'failed');
    const fooled = all.filter((x) => x.result === 'fooled').length;
    const mean = pop.reduce((n, p) => n + score(p), 0) / pop.length;
    const per = pop
      .map((p) => `${p.id}:${typeof p.games === 'number' ? '' : p.games.filter((x) => x.result === 'fooled').length}/${played(p)}`)
      .join(' ');
    console.log(
      `${String(g.generation).padEnd(4)} ${score(pop[0]).toFixed(2).padEnd(6)} ${mean.toFixed(2).padEnd(6)} ${String(all.length).padEnd(6)} ${String(Math.round((100 * fooled) / Math.max(all.length, 1)) + '%').padEnd(8)} ${per}`
    );
  }
}

// Lineage of the final winner
const last = state.generations[state.generations.length - 1];
const byId = new Map<string, Evaluated>();
for (const g of state.generations) for (const p of g.population) byId.set(p.id, p);
const chain: Evaluated[] = [];
let cur: Evaluated | undefined = last.population[0];
while (cur) {
  chain.unshift(cur);
  cur = cur.parent ? byId.get(cur.parent) : undefined;
}
console.log(`\nwinner lineage: ${chain.map((c) => `${c.id} (gen ${c.born}, ${Math.round(100 * score(c))}% over ${played(c)}${c.origin ? `, ${c.origin}` : ''})`).join(' -> ')}`);

// Human types the winner faced (vs-simulated-human runs only)
if (typeof last.population[0].games !== 'number') {
  const faced = new Map<string, [number, number]>();
  for (const x of last.population[0].games) {
    const [f, n] = faced.get(x.population) ?? [0, 0];
    faced.set(x.population, [f + (x.result === 'fooled' ? 1 : 0), n + 1]);
  }
  console.log('winner vs: ' + [...faced].map(([p, [f, n]]) => `${p} ${f}/${n}`).join('  '));
}

console.log(`\n--- winning strategy (${last.population[0].id}) ---\n${last.population[0].strategy}`);
if (full) {
  for (const c of chain.slice(0, -1)) {
    console.log(`\n--- ancestor ${c.id} (gen ${c.born}, ${Math.round(100 * score(c))}%) ---\n${c.strategy}`);
  }
}
