'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ParticipantChip } from './ParticipantChip';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/lib/stores/game-store';

interface GameJudgePanelProps {
  gameId: string;
  token: string;
}

export function GameJudgePanel({ gameId, token }: GameJudgePanelProps) {
  const { status, messages } = useGameStore();
  const [isOpen, setIsOpen] = useState(false);
  const [humanIs, setHumanIs] = useState<'A' | 'B' | null>(null);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Early verdicts allowed once both participants have answered at
  // least once (one complete round revealed)
  const hasFullRound =
    messages.some((m) => m.player === 'A') &&
    messages.some((m) => m.player === 'B');

  const isJudging = status === 'JUDGING';
  const canDecide = isJudging || (status === 'CONVERSATION' && hasFullRound);

  if (!canDecide) return null;

  // During conversation, collapse to a single quiet row under the composer
  if (!isJudging && !isOpen) {
    return (
      <div className="shrink-0 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 pb-4">
          <span className="text-sm text-muted-foreground">
            Seen enough to make the call?
          </span>
          <Button variant="outline" size="sm" onClick={() => setIsOpen(true)}>
            Give verdict
          </Button>
        </div>
      </div>
    );
  }

  async function handleSubmit() {
    if (!humanIs || !reason.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/${gameId}/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, humanIs, reason: reason.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="shrink-0 border-t bg-background/80 backdrop-blur">
      <div className="mx-auto w-full max-w-2xl space-y-5 px-6 py-6">
        <div>
          <h2 className="text-lg font-semibold">Who is the human?</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One participant is a person. The other is an AI.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {(['A', 'B'] as const).map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setHumanIs(label)}
              aria-pressed={humanIs === label}
              className={cn(
                'flex items-center gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-all hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/50',
                humanIs === label &&
                  'border-foreground ring-1 ring-foreground shadow-sm'
              )}
            >
              <ParticipantChip label={label} size="lg" />
              <span>
                <span className="block font-medium">Participant {label}</span>
                <span className="block text-sm text-muted-foreground">
                  is the human
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="verdict-reason"
            className="text-sm font-medium"
          >
            What gave it away?
          </label>
          <Textarea
            id="verdict-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="The clues you noticed…"
            rows={3}
            className="bg-card"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          {!isJudging && (
            <Button
              variant="ghost"
              className="h-10 px-4"
              onClick={() => setIsOpen(false)}
            >
              Keep asking
            </Button>
          )}
          <Button
            onClick={handleSubmit}
            disabled={!humanIs || !reason.trim() || isSubmitting}
            className="h-10 px-5"
          >
            {isSubmitting ? 'Submitting…' : 'Submit verdict'}
          </Button>
        </div>
      </div>
    </div>
  );
}
