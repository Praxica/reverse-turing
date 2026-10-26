import { validateParticipantToken } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { PlayerView } from './PlayerView';

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { gameId } = await params;
  const { token } = await searchParams;

  if (!token) notFound();

  const participant = await validateParticipantToken(token);
  if (!participant || participant.gameId !== gameId) notFound();
  if (participant.role !== 'HUMAN_PLAYER') notFound();

  return (
    <PlayerView
      gameId={gameId}
      token={token}
      initialStatus={participant.game.status}
    />
  );
}
