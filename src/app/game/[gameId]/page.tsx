import { getAuthenticatedUser } from '@/lib/auth';
import { getGameWithDetails } from '@/lib/game/game-service';
import { redirect, notFound } from 'next/navigation';
import { HostDashboard } from './HostDashboard';

export default async function GameHostPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const user = await getAuthenticatedUser();
  if (!user) redirect('/sign-in');

  const game = await getGameWithDetails(gameId);
  if (!game) notFound();
  if (game.hostUserId !== user.id) notFound();

  const playerParticipant = game.participants.find(
    (p) => p.role === 'HUMAN_PLAYER'
  );
  const judgeParticipant = game.participants.find(
    (p) => p.role === 'JUDGE'
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  return (
    <HostDashboard
      game={game}
      playerUrl={`${baseUrl}/game/${gameId}/play?token=${playerParticipant?.token}`}
      judgeUrl={`${baseUrl}/game/${gameId}/judge?token=${judgeParticipant?.token}`}
    />
  );
}
