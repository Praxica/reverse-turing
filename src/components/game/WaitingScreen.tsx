export function WaitingScreen({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto mb-6 flex w-fit items-center gap-1.5" aria-hidden>
          <span className="size-2 animate-bounce rounded-full bg-foreground [animation-delay:0ms]" />
          <span className="size-2 animate-bounce rounded-full bg-foreground/60 [animation-delay:150ms]" />
          <span className="size-2 animate-bounce rounded-full bg-foreground/30 [animation-delay:300ms]" />
        </span>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
