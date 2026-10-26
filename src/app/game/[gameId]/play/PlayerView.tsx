'use client';

import { useEffect } from 'react';
import { useGameSSE } from '@/lib/hooks/use-game-sse';
import { useGameStore } from '@/lib/stores/game-store';
import { GameStatusBanner } from '@/components/game/GameStatusBanner';
import { GameConversation } from '@/components/game/GameConversation';
import { GameMessageInput } from '@/components/game/GameMessageInput';
import { WaitingScreen } from '@/components/game/WaitingScreen';
import { GameResults } from '@/components/game/GameResults';
import type { GameStatus } from '@/generated/prisma/client';

interface PlayerViewProps {
  gameId: string;
  token: string;
  initialStatus: GameStatus;
}

export function PlayerView({ gameId, token, initialStatus }: PlayerViewProps) {
  const { initialize, status } = useGameStore();

  useEffect(() => {
    initialize({
      gameId,
      myRole: 'HUMAN_PLAYER',
      status: initialStatus,
    });
  }, [gameId, initialStatus, initialize]);

  useGameSSE(gameId, token);

  return (
    <div className="flex h-dvh flex-col">
      <GameStatusBanner gameId={gameId} token={token} />

      {status === 'LOBBY' && (
        <WaitingScreen title="Waiting for the others">
          A judge will ask you and an AI the same questions, then guess which of you is human. Just answer like yourself.
        </WaitingScreen>
      )}

      {status === 'READY' && (
        <WaitingScreen title="Starting…">Get ready for the first question.</WaitingScreen>
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
          <GameMessageInput gameId={gameId} token={token} mode="answer" />
          <GameResults gameId={gameId} token={token} />
        </>
      )}
    </div>
  );
}
