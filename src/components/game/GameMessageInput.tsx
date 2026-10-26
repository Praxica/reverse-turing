'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { WaitingDots } from './WaitingDots';
import { useGameStore } from '@/lib/stores/game-store';
import type { SenderLabel } from '@/lib/game/types';

interface GameMessageInputProps {
  gameId: string;
  token: string;
  mode: 'question' | 'answer';
}

/**
 * Input box for the judge (questions) and the human player (answers).
 * Visibility is driven by the round phase from the server.
 */
export function GameMessageInput({ gameId, token, mode }: GameMessageInputProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { phase, status, myLabel, messages, addLocalMessage, endPhaseLocally } =
    useGameStore();

  const isMyPhase =
    status === 'CONVERSATION' &&
    ((mode === 'question' && phase?.phase === 'question') ||
      (mode === 'answer' && phase?.phase === 'answers'));

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || !isMyPhase || isSending) return;

    const content = message.trim();
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/${gameId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, content }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send');
      }

      const { messageId } = await res.json();
      // Echo locally — our own message isn't streamed back to us
      const label: SenderLabel = mode === 'question' ? 'JUDGE' : myLabel ?? 'A';
      addLocalMessage({
        id: messageId ?? `local-${Date.now()}`,
        player: label,
        content,
        isStreaming: false,
        turnNumber: phase?.turnNumber ?? 0,
      });
      setMessage('');
      endPhaseLocally();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setIsSending(false);
    }
  }, [
    message,
    isMyPhase,
    isSending,
    gameId,
    token,
    mode,
    myLabel,
    phase,
    addLocalMessage,
    endPhaseLocally,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // After the last reveal the judge may take a minute or two to decide;
  // show that something is happening instead of an empty footer.
  if (status === 'JUDGING' && mode === 'answer') {
    return (
      <div className="shrink-0 border-t bg-background/80 backdrop-blur">
        <p className="mx-auto flex w-full max-w-2xl items-center justify-center gap-3 px-6 py-7 text-sm text-muted-foreground">
          All questions answered — the judge is deciding
          <WaitingDots className="translate-y-0.5 opacity-70" />
        </p>
      </div>
    );
  }
  if (status !== 'CONVERSATION') return null;
  // Before the first question the conversation area already says we are waiting
  if (mode === 'answer' && messages.length === 0) return null;

  const placeholder =
    mode === 'question'
      ? 'Ask both participants anything…'
      : 'Type your answer…';
  const waitingText =
    mode === 'question'
      ? 'Waiting for both participants to answer'
      : phase
        ? 'Waiting for the next question'
        : 'Answer sent — waiting for the reveal';

  return (
    <div className="shrink-0 border-t bg-background/80 backdrop-blur">
      <div className="mx-auto w-full max-w-2xl px-6 py-4">
        {isMyPhase ? (
          <>
            <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 pl-4 shadow-sm transition-shadow focus-within:border-foreground/25 focus-within:shadow-md">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                rows={2}
                autoFocus
                disabled={isSending}
                className="min-h-[3rem] flex-1 resize-none bg-transparent py-1.5 outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
              />
              <Button
                onClick={handleSubmit}
                disabled={!message.trim() || isSending}
                className="h-9 rounded-xl px-4"
              >
                {isSending ? 'Sending…' : mode === 'question' ? 'Ask' : 'Send'}
              </Button>
            </div>
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              {error ? (
                <span className="text-red-600">{error}</span>
              ) : (
                <>Enter to send · Shift + Enter for a new line</>
              )}
            </p>
          </>
        ) : (
          <p className="flex items-center justify-center gap-3 py-3 text-sm text-muted-foreground">
            {waitingText}
            <WaitingDots className="translate-y-0.5 opacity-70" />
          </p>
        )}
      </div>
    </div>
  );
}
