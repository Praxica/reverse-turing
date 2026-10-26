import Link from 'next/link';

/** Two dots — one solid, one hollow: the human and the machine. */
export function Wordmark({ href = '/' }: { href?: string | null }) {
  const content = (
    <span className="flex shrink-0 items-center gap-2.5">
      <span className="flex items-center gap-1" aria-hidden>
        <span className="size-2.5 rounded-full bg-foreground" />
        <span className="size-2.5 rounded-full border-[1.5px] border-foreground" />
      </span>
      <span className="whitespace-nowrap text-sm font-semibold tracking-tight">
        Reverse Turing Test
      </span>
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      {content}
    </Link>
  );
}
