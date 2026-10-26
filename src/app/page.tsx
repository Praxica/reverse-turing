import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { SignInCta } from '@/components/layout/SignInCta';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STEPS = [
  {
    title: 'The judge asks',
    body: 'One question per round, about anything. Both participants — one human, one AI — answer the same question.',
  },
  {
    title: 'Answers are revealed together',
    body: 'Both answers are held until both are in, then shown in random order at the same speed. Typing time gives nothing away.',
  },
  {
    title: 'The judge decides',
    body: 'When they are confident, or out of questions, the judge names the human. Then the truth is revealed.',
  },
];

const cta = cn(buttonVariants(), 'h-11 rounded-xl px-6 text-[15px]');

export default async function HomePage() {
  const { userId } = await auth();

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-3xl px-6 pb-20 pt-24 text-center sm:pt-32">
          <p className="text-sm font-medium text-muted-foreground">
            One human. One AI. One judge.
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tighter sm:text-6xl">
            Can you tell which one is human?
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            A judge questions two hidden participants and has to work out who
            is the person and who is the machine — from the words alone.
          </p>
          <div className="mt-10">
            {userId ? (
              <Link href="/game/new" className={cta}>
                Create a game
              </Link>
            ) : (
              <SignInCta className={cta}>Sign in to create a game</SignInCta>
            )}
          </div>
        </section>

        <section className="border-t">
          <ol className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-16 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="font-mono text-xs text-muted-foreground">
                  0{i + 1}
                </span>
                <h2 className="mt-3 font-semibold">{step.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
