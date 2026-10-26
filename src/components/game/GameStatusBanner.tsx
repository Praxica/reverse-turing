'use client';

import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useStartOver } from '@/lib/hooks/use-start-over';
import { useGameStore } from '@/lib/stores/game-store';
import { Wordmark } from '@/components/layout/Wordmark';
import { StatusPill } from './StatusPill';
import { cn } from '@/lib/utils';

export function GameStatusBanner({
  gameId,
  token,
}: {
  gameId: string;
  token: string;
}) {
  const { status, myRole, myLabel, phase, isConnected, errorMessage, rematchUrl } =
    useGameStore();
  const { startOver, isStarting, error } = useStartOver(gameId, token);

  const inProgress =
    status === 'READY' || status === 'CONVERSATION' || status === 'JUDGING';

  // Confirm in the page itself: built-in confirm() dialogs are suppressed
  // by some embedded browsers, which made the button silently do nothing.
  const [confirming, setConfirming] = useState(false);

  function handleStartOver() {
    if (inProgress && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startOver();
  }

  if (!status) return null;

  const roleLabel =
    myRole === 'JUDGE'
      ? 'Judge'
      : myRole === 'HUMAN_PLAYER'
        ? `Participant${myLabel ? ` ${myLabel}` : ''}`
        : null;

  return (
    <header className="shrink-0 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Wordmark href={null} />
          {!confirming && (
            <>
              <span className="hidden h-4 w-px bg-border sm:block" />
              <StatusPill status={status} />
            </>
          )}
          {!confirming && status === 'CONVERSATION' && phase && (
            <span className="hidden whitespace-nowrap text-sm text-muted-foreground md:inline">
              Question {phase.turnNumber}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          {rematchUrl ? (
            <a
              href={rematchUrl}
              className={cn(buttonVariants(), 'h-8 px-3')}
            >
              Join new game
            </a>
          ) : confirming ? (
            <span className="flex items-center gap-2">
              <span className="whitespace-nowrap text-muted-foreground">
                Abandon this game?
              </span>
              <Button className="h-8 px-3" onClick={handleStartOver}>
                Yes, start over
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-3"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              variant="outline"
              className="h-8 px-3"
              onClick={handleStartOver}
              disabled={isStarting}
            >
              {isStarting ? 'Starting…' : 'Start over'}
            </Button>
          )}
          {roleLabel && !confirming && (
            <span className="hidden whitespace-nowrap text-muted-foreground sm:inline">
              You are{' '}
              <span className="font-medium text-foreground">{roleLabel}</span>
            </span>
          )}
          <span
            className={cn(
              'size-2 rounded-full',
              isConnected ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'
            )}
            title={isConnected ? 'Connected' : 'Reconnecting…'}
          />
        </div>
      </div>
      {(error || errorMessage) && (
        <div className="border-t bg-red-50 px-6 py-2 text-center text-sm text-red-700">
          {error || errorMessage}
        </div>
      )}
    </header>
  );
}
