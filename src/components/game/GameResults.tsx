'use client';

import Link from 'next/link';
import { useStartOver } from '@/lib/hooks/use-start-over';
import { useGameStore } from '@/lib/stores/game-store';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ParticipantChip } from './ParticipantChip';

export function GameResults({
  gameId,
  token,
}: {
  gameId: string;
  token: string;
}) {
  const { verdict, status, rematchUrl } = useGameStore();
  const { startOver: playAgain, isStarting, error } = useStartOver(gameId, token);

  if (status !== 'COMPLETED' || !verdict) return null;

  const correct = verdict.verdict === 'CORRECT';
  const human = verdict.humanPlayer;
  const ai = human === 'A' ? 'B' : 'A';

  return (
    <div className="max-h-[60dvh] shrink-0 overflow-y-auto border-t bg-background/80 backdrop-blur">
      <div className="mx-auto w-full max-w-2xl space-y-5 px-6 py-6">
        <div>
          <p
            className={`text-xs font-medium uppercase tracking-[0.08em] ${
              correct ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            Verdict · {correct ? 'Correct' : 'Incorrect'}
          </p>
          <h2 className="mt-1.5 text-2xl font-semibold">
            {correct ? 'The judge got it right.' : 'The AI fooled the judge.'}
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
            <ParticipantChip label={human} size="lg" />
            <div>
              <p className="font-medium">Human</p>
              <p className="text-sm text-muted-foreground">
                Participant {human}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
            <ParticipantChip label={ai} size="lg" />
            <div className="min-w-0">
              <p className="font-medium">AI</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {verdict.llmModel.split(':').pop()}
              </p>
            </div>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">The judge&apos;s reasoning</p>
          <p className="mt-1 text-muted-foreground">{verdict.reason}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-5">
          {rematchUrl ? (
            <a
              href={rematchUrl}
              className={cn(buttonVariants(), 'h-10 px-5')}
            >
              Join the new game
            </a>
          ) : (
            <Button
              onClick={playAgain}
              disabled={isStarting}
              className="h-10 px-5"
            >
              {isStarting ? 'Starting…' : 'Play again'}
            </Button>
          )}
          <Link
            href="/game/new"
            className={cn(buttonVariants({ variant: 'ghost' }), 'h-10 px-4')}
          >
            New game with different settings
          </Link>
          <p className="basis-full text-sm text-muted-foreground">
            {error ? (
              <span className="text-red-600">{error}</span>
            ) : rematchUrl ? (
              'The other participant started a rematch.'
            ) : (
              'Play again keeps the same AI, judge and number of questions.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
