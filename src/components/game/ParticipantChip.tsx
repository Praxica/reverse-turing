import { cn } from '@/lib/utils';

const TONES = {
  A: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  B: 'bg-teal-50 text-teal-700 ring-teal-200',
} as const;

export function ParticipantChip({
  label,
  size = 'md',
  className,
}: {
  label: 'A' | 'B';
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-inset',
        size === 'md' ? 'size-7 text-xs' : 'size-10 text-sm',
        TONES[label],
        className
      )}
    >
      {label}
    </span>
  );
}
