// E2E test seed: creates a host user + game and prints participant tokens.
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL!;
const schema =
  new URL(connectionString).searchParams.get('schema') ?? undefined;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }, { schema }),
});

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'e2e-host@test.local' },
    update: {},
    create: { email: 'e2e-host@test.local', displayName: 'E2E Host' },
  });

  const game = await prisma.game.create({
    data: {
      hostUserId: user.id,
      model: 'anthropic:claude-haiku-4-5',
      maxTurns: 2, // two question rounds, then judging
      streamingDelay: 5, // fast streaming for the test
      judgeMode: 'HUMAN',
    },
  });

  const roles = ['HUMAN_PLAYER', 'LLM_PLAYER', 'JUDGE'] as const;
  await prisma.gameParticipant.createMany({
    data: roles.map((role) => ({ gameId: game.id, role })),
  });
  const participants = await prisma.gameParticipant.findMany({
    where: { gameId: game.id },
  });

  const out = {
    gameId: game.id,
    playerToken: participants.find((p) => p.role === 'HUMAN_PLAYER')!.token,
    judgeToken: participants.find((p) => p.role === 'JUDGE')!.token,
  };
  console.log(JSON.stringify(out));
}

main().finally(() => prisma.$disconnect());
