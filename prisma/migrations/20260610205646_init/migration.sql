-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('LOBBY', 'READY', 'CONVERSATION', 'JUDGING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GameRole" AS ENUM ('HUMAN_PLAYER', 'LLM_PLAYER', 'JUDGE');

-- CreateEnum
CREATE TYPE "JudgeMode" AS ENUM ('HUMAN', 'LLM');

-- CreateEnum
CREATE TYPE "GameVerdict" AS ENUM ('CORRECT', 'INCORRECT');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT NOT NULL DEFAULT 'Anonymous',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hostUserId" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "model" TEXT NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'LOBBY',
    "maxTurns" INTEGER NOT NULL DEFAULT 10,
    "streamingDelay" INTEGER NOT NULL DEFAULT 30,
    "judgeMode" "JudgeMode" NOT NULL DEFAULT 'HUMAN',
    "judgeModel" TEXT,
    "labelMapping" JSONB,
    "currentTurn" INTEGER NOT NULL DEFAULT 0,
    "activePlayer" "GameRole",
    "verdict" "GameVerdict",
    "verdictReason" TEXT,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameParticipant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gameId" UUID NOT NULL,
    "role" "GameRole" NOT NULL,
    "token" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "displayName" TEXT NOT NULL DEFAULT 'Anonymous',
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMPTZ(6),

    CONSTRAINT "GameParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gameId" UUID NOT NULL,
    "senderRole" "GameRole" NOT NULL,
    "content" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ(6),

    CONSTRAINT "GameMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE INDEX "Game_hostUserId_idx" ON "Game"("hostUserId");

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "Game"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GameParticipant_token_key" ON "GameParticipant"("token");

-- CreateIndex
CREATE INDEX "GameParticipant_gameId_idx" ON "GameParticipant"("gameId");

-- CreateIndex
CREATE INDEX "GameParticipant_token_idx" ON "GameParticipant"("token");

-- CreateIndex
CREATE INDEX "GameMessage_gameId_idx" ON "GameMessage"("gameId");

-- CreateIndex
CREATE INDEX "GameMessage_gameId_turnNumber_idx" ON "GameMessage"("gameId", "turnNumber");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameParticipant" ADD CONSTRAINT "GameParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameMessage" ADD CONSTRAINT "GameMessage_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
