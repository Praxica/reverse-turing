# Contributing to Reverse Turing Test

## Getting started

1. Fork the repository and clone your fork.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in a database URL, Clerk keys, and at least one AI provider key.
4. Set up the database:
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```
5. Start the development server:
   ```bash
   npm run dev
   ```

## Project structure

- `src/app/` — Next.js App Router pages and API routes
- `src/lib/game/` — the game engine: state machine, prompts, answer delivery, SSE registry
- `src/components/game/` — game UI
- `prisma/` — schema and migrations
- `scripts/` — simulation harness, evolution loop, reports

## Checks

There is no automated test suite yet. Before opening a pull request, make sure these pass:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

For changes to the engine or prompts, play a game end to end (`scripts/demo-game.ts` is the quickest way) and, where it applies, run a short harness batch so the effect on fooled rate is visible rather than assumed.

## Pull requests

- Keep PRs focused on a single change.
- Say what changed and why; for prompt changes, include before/after transcripts or harness numbers.
- Migrations: add a folder under `prisma/migrations/` with a plain SQL file; keep the schema and the migration in the same PR.

## Code style

- TypeScript everywhere.
- Game logic belongs in `src/lib/game/`, not in routes or components.
- Model calls go through `generate()` in `src/lib/game/llm-service.ts` so budget, refusal and usage handling stay in one place.
- Anything a participant must not see (who is who, the other side's answer before the reveal, private notes) is enforced on the server, never by the client.
