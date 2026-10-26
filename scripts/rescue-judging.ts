// Re-runs the AI verdict for games stuck in JUDGING (e.g. after a failed
// verdict call). Usage: npx tsx scripts/rescue-judging.ts [harnessRunPrefix]
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { generateLLMJudgment } from '../src/lib/game/llm-service';
import { submitVerdict } from '../src/lib/game/game-service';
import type { LabelMapping } from '../src/lib/game/types';

async function main() {
  const prefix = process.argv[2];
  const stuck = await prisma.game.findMany({
    where: {
      status: 'JUDGING',
      judgeMode: 'LLM',
      ...(prefix ? { harnessRunId: { startsWith: prefix } } : {}),
    },
    include: { messages: { orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }] } },
  });
  console.log(`${stuck.length} game(s) stuck in JUDGING`);
  await Promise.all(
    stuck.map(async (game) => {
      try {
        const judgment = await generateLLMJudgment({
          model: game.judgeModel!,
          conversationHistory: game.messages,
          labelMapping: game.labelMapping as unknown as LabelMapping,
        });
        await submitVerdict(game.id, judgment.humanIs, judgment.reason);
        const after = await prisma.game.findUniqueOrThrow({ where: { id: game.id } });
        console.log(`${game.id.slice(0, 8)} -> ${after.verdict}`);
      } catch (err) {
        console.error(`${game.id.slice(0, 8)} failed:`, (err as Error).message);
      }
    })
  );
}
main().finally(() => prisma.$disconnect());
