ALTER TABLE "Game" ADD COLUMN "humanModel" TEXT;
ALTER TABLE "Game" ADD COLUMN "humanPersona" TEXT;
ALTER TABLE "Game" ADD COLUMN "population" TEXT;
ALTER TABLE "Game" ADD COLUMN "harnessRunId" TEXT;
CREATE INDEX "Game_harnessRunId_idx" ON "Game"("harnessRunId");
