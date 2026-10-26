'use client';

import { useEffect, useState } from 'react';
import { JoinLink } from '@/components/game/JoinLink';
import { Button } from '@/components/ui/button';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { StatusPill } from '@/components/game/StatusPill';
import type { Game, GameParticipant, GameMessage } from '@/generated/prisma/client';

type GameWithDetails = Game & {
  participants: GameParticipant[];
  messages: GameMessage[];
};

interface HostDashboardProps {
  game: GameWithDetails;
  playerUrl: string;
  judgeUrl: string;
}

export function HostDashboard({
  game: initialGame,
  playerUrl,
  judgeUrl,
}: HostDashboardProps) {
  const [game, setGame] = useState(initialGame);
  const [isCancelling, setIsCancelling] = useState(false);

  // Poll for connection status and game progress
  useEffect(() => {
    const isFinished =
      game.status === 'COMPLETED' || game.status === 'CANCELLED';
    if (isFinished) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/game/${game.id}`);
        if (res.ok) setGame(await res.json());
      } catch {
        // Transient polling failure — keep last state
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [game.id, game.status]);

  async function handleCancel() {
    setIsCancelling(true);
    try {
      await fetch(`/api/game/${game.id}/cancel`, { method: 'POST' });
    } finally {
      setIsCancelling(false);
    }
  }

  const playerConnected =
    game.participants.find((p) => p.role === 'HUMAN_PLAYER')?.isConnected ??
    false;
  const judgeConnected =
    game.participants.find((p) => p.role === 'JUDGE')?.isConnected ?? false;
  const isActive =
    game.status !== 'COMPLETED' && game.status !== 'CANCELLED';

  const questionsAsked = game.messages.filter(
    (m) => m.senderRole === 'JUDGE'
  ).length;
  const details: Array<[string, React.ReactNode]> = [
    ['AI contestant', <Mono key="m">{game.model.split(':').pop()}</Mono>],
    [
      'Judge',
      game.judgeMode === 'HUMAN' ? (
        'Human'
      ) : (
        <Mono key="j">{game.judgeModel?.split(':').pop()}</Mono>
      ),
    ],
    ['Questions', `${questionsAsked} of ${game.maxTurns} asked`],
  ];

  return (
    <>
      <SiteHeader showNewGame />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-10 px-6 py-14">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Your game</h1>
            <p className="mt-2 text-muted-foreground">
              {game.status === 'LOBBY'
                ? 'Send each person their link. The game starts on its own once everyone has joined.'
                : 'This page updates as the game progresses.'}
            </p>
          </div>
          <StatusPill status={game.status} />
        </div>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground">Invite</h2>
          <div className="mt-3 divide-y rounded-xl border bg-card shadow-xs">
            <JoinLink
              label="Human contestant"
              description="Answers the judge's questions alongside the AI."
              url={playerUrl}
              isConnected={playerConnected}
            />
            {game.judgeMode === 'HUMAN' ? (
              <JoinLink
                label="Judge"
                description="Asks the questions and names the human."
                url={judgeUrl}
                isConnected={judgeConnected}
              />
            ) : (
              <div className="flex items-center justify-between p-5">
                <div>
                  <p className="font-medium">Judge</p>
                  <p className="text-sm text-muted-foreground">
                    An AI judge asks the questions — no link needed.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground">Details</h2>
          <dl className="mt-3 divide-y rounded-xl border bg-card shadow-xs">
            {details.map(([term, value]) => (
              <div
                key={term}
                className="flex items-center justify-between gap-4 px-5 py-3.5"
              >
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {game.status === 'COMPLETED' && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground">Result</h2>
            <div className="mt-3 rounded-xl border bg-card p-5 shadow-xs">
              <p className="text-lg font-semibold">
                {game.verdict === 'CORRECT'
                  ? 'The judge got it right.'
                  : 'The AI fooled the judge.'}
              </p>
              <p className="mt-1.5 text-muted-foreground">
                {game.verdictReason}
              </p>
            </div>
          </section>
        )}

        {isActive && (
          <Button
            variant="ghost"
            className="h-9 px-3 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={handleCancel}
            disabled={isCancelling}
          >
            {isCancelling ? 'Cancelling…' : 'Cancel game'}
          </Button>
        )}
      </main>
    </>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-sm font-normal">{children}</span>;
}
