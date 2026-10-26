'use client';

import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface JoinLinkProps {
  label: string;
  description: string;
  url: string;
  isConnected: boolean;
}

export function JoinLink({ label, description, url, isConnected }: JoinLinkProps) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              'size-1.5 rounded-full',
              isConnected ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'
            )}
          />
          {isConnected ? 'Connected' : 'Not joined yet'}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
          {url}
        </code>
        <Button variant="outline" className="h-9 px-3.5" onClick={copyToClipboard}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants(), 'h-9 px-3.5')}
        >
          Open
        </a>
      </div>
    </div>
  );
}
