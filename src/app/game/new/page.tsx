import { SiteHeader } from '@/components/layout/SiteHeader';
import { GameCreationForm } from '@/components/game/GameCreationForm';

export default function NewGamePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-14">
        <h1 className="text-3xl font-semibold">New game</h1>
        <p className="mt-2 text-muted-foreground">
          Pick the AI contestant and who judges. You&apos;ll get links to share
          next.
        </p>
        <div className="mt-10">
          <GameCreationForm />
        </div>
      </main>
    </>
  );
}
