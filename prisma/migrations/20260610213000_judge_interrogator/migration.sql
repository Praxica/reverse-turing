-- AlterTable: topic becomes optional (empty default)
ALTER TABLE "Game" ALTER COLUMN "topic" SET DEFAULT '';

-- CreateIndex: one question/answer per role per round
CREATE UNIQUE INDEX "GameMessage_gameId_senderRole_turnNumber_key" ON "GameMessage"("gameId", "senderRole", "turnNumber");
