'use client';

import { SignInButton } from '@clerk/nextjs';

export function SignInCta({
  className,
  children,
}: {
  className?: string;
  children: string;
}) {
  return (
    <SignInButton mode="modal">
      <button className={className}>{children}</button>
    </SignInButton>
  );
}
