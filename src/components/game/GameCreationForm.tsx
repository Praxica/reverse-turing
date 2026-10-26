'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { AVAILABLE_MODELS } from '@/lib/game/llm-service';

export function GameCreationForm() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState(AVAILABLE_MODELS[0].id);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [maxTurns, setMaxTurns] = useState(5);
  const [judgeMode, setJudgeMode] = useState<'HUMAN' | 'LLM'>('HUMAN');
  const [judgeModel, setJudgeModel] = useState(AVAILABLE_MODELS[0].id);
  const [showJudgeNotes, setShowJudgeNotes] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          systemPrompt: systemPrompt || undefined,
          maxTurns,
          judgeMode,
          judgeModel: judgeMode === 'LLM' ? judgeModel : undefined,
          showJudgeNotes: judgeMode === 'LLM' && showJudgeNotes,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to create game');
      }

      const { game } = await res.json();
      router.push(`/game/${game.id}`);
    } catch (error) {
      console.error('Failed to create game:', error);
      setError('Could not create the game. Please try again.');
    } finally {
      setIsCreating(false);
    }
  }

  const modelSelect = (
    value: string,
    onChange: (v: string) => void,
    id: string
  ) => (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger id={id} className="h-10 w-full bg-card">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AVAILABLE_MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
            <span className="text-muted-foreground">{m.provider}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      <Field
        label="AI contestant"
        htmlFor="model"
        hint="The model that will try to pass as human."
      >
        {modelSelect(model, setModel, 'model')}
      </Field>

      <Field label="Judge" hint="Who asks the questions and makes the call.">
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['HUMAN', 'A person', 'You share a judge link.'],
              ['LLM', 'An AI', 'Runs automatically.'],
            ] as const
          ).map(([value, title, body]) => (
            <button
              key={value}
              type="button"
              onClick={() => setJudgeMode(value)}
              aria-pressed={judgeMode === value}
              className={cn(
                'rounded-xl border bg-card p-4 text-left outline-none transition-all hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/50',
                judgeMode === value &&
                  'border-foreground ring-1 ring-foreground shadow-sm'
              )}
            >
              <span className="block font-medium">{title}</span>
              <span className="block text-sm text-muted-foreground">
                {body}
              </span>
            </button>
          ))}
        </div>
        {judgeMode === 'LLM' && (
          <div className="mt-3 space-y-3">
            {modelSelect(judgeModel, setJudgeModel, 'judgeModel')}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4">
              <input
                type="checkbox"
                checked={showJudgeNotes}
                onChange={(e) => setShowJudgeNotes(e.target.checked)}
                className="mt-1 size-4 accent-foreground"
              />
              <span>
                <span className="block font-medium">
                  Show the judge&apos;s case notes
                </span>
                <span className="block text-sm text-muted-foreground">
                  After each round, reveal what the judge was thinking when it
                  asked. Both contestants see them.
                </span>
              </span>
            </label>
          </div>
        )}
      </Field>

      <Field
        label="Number of questions"
        htmlFor="maxTurns"
        hint="The judge can also give a verdict early."
      >
        <Input
          id="maxTurns"
          type="number"
          min={1}
          max={15}
          value={maxTurns}
          onChange={(e) => setMaxTurns(parseInt(e.target.value, 10))}
          className="h-10 w-24 bg-card"
        />
      </Field>

      <Field
        label="Custom AI instructions"
        htmlFor="systemPrompt"
        hint="Optional. Replaces the default instructions given to the AI contestant."
      >
        <Textarea
          id="systemPrompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={3}
          className="bg-card"
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        type="submit"
        className="h-11 w-full rounded-xl text-[15px]"
        disabled={isCreating}
      >
        {isCreating ? 'Creating…' : 'Create game'}
      </Button>
    </form>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="font-medium">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
