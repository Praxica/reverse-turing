import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Wordmark } from './Wordmark';

export function SiteHeader({ showNewGame = false }: { showNewGame?: boolean }) {
  return (
    <header className="border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Wordmark />
        {showNewGame && (
          <Link
            href="/game/new"
            className={cn(buttonVariants({ variant: 'outline' }), 'h-8 px-3')}
          >
            New game
          </Link>
        )}
      </div>
    </header>
  );
}
