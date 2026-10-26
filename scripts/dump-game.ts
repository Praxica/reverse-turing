import 'dotenv/config';
import { PrismaClient } from '/Users/ray/Dev/reverse-turing/src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const cs = process.env.DATABASE_URL!;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: cs }, { schema: new URL(cs).searchParams.get('schema') ?? undefined }) });
(async () => {
  const g = await prisma.game.findFirst({ where: { id: process.argv[2] }, include: { messages: { orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }] } } });
  console.log('JUDGE STRATEGY:', g?.judgeStrategy, '\n');
  console.log(g?.id, g?.status, g?.verdict, g?.verdictReason, JSON.stringify(g?.labelMapping));
  for (const m of g?.messages ?? []) console.log(`[${m.turnNumber}] ${m.senderRole}: ${JSON.stringify(m.content)}\n   NOTES: ${m.privateNotes}\n`);
})().finally(() => prisma.$disconnect());
