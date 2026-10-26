'use client';

import { useEffect } from 'react';
import { useGameSSE } from '@/lib/hooks/use-game-sse';
import { useGameStore } from '@/lib/stores/game-store';
import { GameStatusBanner } from '@/components/game/GameStatusBanner';
import { GameConversation } from '@/components/game/GameConversation';
import { GameMessageInput } from '@/components/game/GameMessageInput';
import { GameJudgePanel } from '@/components/game/GameJudgePanel';
import { WaitingScreen } from '@/components/game/WaitingScreen';
import { GameResults } from '@/components/game/GameResults';
import type { GameStatus } from '@/generated/prisma/client';

interface JudgeViewProps {
  gameId: string;
  token: string;
  initialStatus: GameStatus;
}

export function JudgeView({ gameId, token, initialStatus }: JudgeViewProps) {
  const { initialize, status } = useGameStore();

  useEffect(() => {
    initialize({
      gameId,
      myRole: 'JUDGE',
      status: initialStatus,
    });
  }, [gameId, initialStatus, initialize]);

  useGameSSE(gameId, token);

  return (
    <div className="flex h-dvh flex-col">
      <GameStatusBanner gameId={gameId} token={token} />

      {status === 'LOBBY' && (
        <WaitingScreen title="Waiting for players">
          You&apos;re the judge. Once everyone is connected, you&apos;ll ask both participants the same questions — one is human, one is an AI.
        </WaitingScreen>
      )}

      {status === 'READY' && (
        <WaitingScreen title="Starting…">Think of a first question only a human could answer well.</WaitingScreen>
      )}

      {status === 'CANCELLED' && (
        <WaitingScreen title="Game cancelled">
          This game was ended. Use Start over in the header to begin a new one.
        </WaitingScreen>
      )}

      {(status === 'CONVERSATION' ||
        status === 'JUDGING' ||
        status === 'COMPLETED') && (
        <>
          <GameConversation />
          <GameMessageInput gameId={gameId} token={token} mode="question" />
          <GameJudgePanel gameId={gameId} token={token} />
          <GameResults gameId={gameId} token={token} />
        </>
      )}
    </div>
  );
}
