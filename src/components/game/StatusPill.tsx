import { cn } from '@/lib/utils';

const STATUS: Record<string, { label: string; dot: string; pulse?: boolean }> = {
  LOBBY: { label: 'Waiting for players', dot: 'bg-amber-500', pulse: true },
  READY: { label: 'Starting', dot: 'bg-emerald-500', pulse: true },
  CONVERSATION: { label: 'In progress', dot: 'bg-emerald-500' },
  JUDGING: { label: 'Judge is deciding', dot: 'bg-indigo-500', pulse: true },
  COMPLETED: { label: 'Finished', dot: 'bg-zinc-400' },
  CANCELLED: { label: 'Cancelled', dot: 'bg-red-500' },
};

export function StatusPill({ status }: { status: string }) {
  const config = STATUS[status] ?? { label: status, dot: 'bg-zinc-400' };
  return (
    <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border bg-card px-2.5 py-1 text-xs font-medium">
      <span
        className={cn(
          'size-1.5 rounded-full',
          config.dot,
          config.pulse && 'animate-pulse'
        )}
      />
      {config.label}
    </span>
  );
}
