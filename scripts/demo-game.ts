// Creates a playable demo game and prints join URLs.
// Usage: npx tsx scripts/demo-game.ts [human|llm] [questions] [contestantModel] [judgeModel]
//   --strategy experiments/<run>.json[:<strategyId>]  lock the AI contestant to an evolved strategy (default: the run's winner)
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';

const connectionString = process.env.DATABASE_URL!;
const schema =
  new URL(connectionString).searchParams.get('schema') ?? undefined;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }, { schema }),
});

async function main() {
  const argv = process.argv.filter((a, i, all) => a !== '--strategy' && all[i - 1] !== '--strategy');
  const judgeMode = argv[2] === 'llm' ? 'LLM' : 'HUMAN';

  const user = await prisma.user.upsert({
    where: { email: 'demo-host@test.local' },
    update: {},
    create: { email: 'demo-host@test.local', displayName: 'Demo Host' },
  });

  // Optional evolved strategy, locked for the whole game
  let llmStrategy: string | undefined;
  let strategyLabel = '';
  const si = process.argv.indexOf('--strategy');
  if (si !== -1) {
    const [file, wantedId] = process.argv[si + 1].split(':');
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pop = state.generations[state.generations.length - 1].population;
    const pick = wantedId ? pop.find((p: { id: string }) => p.id === wantedId) : pop[0];
    if (!pick) throw new Error(`Strategy ${wantedId} not found in ${file}`);
    llmStrategy = pick.strategy;
    strategyLabel = `${state.run}/${pick.id}`;
  }

  const game = await prisma.game.create({
    data: {
      hostUserId: user.id,
      llmStrategy,
      strategyLocked: llmStrategy !== undefined,
      population: 'live',
      model: argv[4] ?? 'anthropic:claude-opus-5-5',
      maxTurns: Number(argv[3] ?? 5),
      streamingDelay: 30,
      judgeMode,
      showJudgeNotes: judgeMode === 'LLM',
      judgeModel:
        judgeMode === 'LLM'
          ? (argv[5] ?? 'anthropic:claude-sonnet-5-5')
          : null,
    },
  });

  const roles = ['HUMAN_PLAYER', 'LLM_PLAYER', 'JUDGE'] as const;
  await prisma.gameParticipant.createMany({
    data: roles.map((role) => ({ gameId: game.id, role })),
  });
  const participants = await prisma.gameParticipant.findMany({
    where: { gameId: game.id },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const playerToken = participants.find((p) => p.role === 'HUMAN_PLAYER')!.token;
  const judgeToken = participants.find((p) => p.role === 'JUDGE')!.token;

  console.log(`Judge mode: ${judgeMode}${strategyLabel ? `  strategy: ${strategyLabel}` : ''}`);
  console.log(`Player: ${base}/game/${game.id}/play?token=${playerToken}`);
  if (judgeMode === 'HUMAN') {
    console.log(`Judge:  ${base}/game/${game.id}/judge?token=${judgeToken}`);
  }
}

main().finally(() => prisma.$disconnect());
