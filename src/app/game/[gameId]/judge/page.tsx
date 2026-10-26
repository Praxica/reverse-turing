import { validateParticipantToken } from '@/lib/auth';
import { notFound } from 'next/navigation';
import { JudgeView } from './JudgeView';

export default async function JudgePage({
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
  if (participant.role !== 'JUDGE') notFound();

  return (
    <JudgeView
      gameId={gameId}
      token={token}
      initialStatus={participant.game.status}
    />
  );
}
