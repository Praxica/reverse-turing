@AGENTS.md

# Reverse Turing Test — notes for AI assistants

The Turing test in reverse: a judge questions two contestants (one human, one AI) and the human has to convince the judge they are the person. See README.md for the full description.

## Where things are

- `src/lib/game/game-service.ts` — the game state machine. `activePlayer` doubles as the round-phase lock (`JUDGE` = awaiting question, `HUMAN_PLAYER` = collecting answers, `null` = revealing). Transitions use `updateMany` with a `where` on the expected state so concurrent requests cannot double-fire.
- `src/lib/game/llm-service.ts` — every prompt and every model call. `generate()` wraps the AI SDK with per-model output budgets, a retry without thinking when a reasoning model exhausts its budget, and usage logging (`LLM_USAGE_LOG=1`).
- `src/lib/game/message-delivery.ts` — uniform-speed streaming of finished messages over SSE. `streamingDelay` 0 means simulated game: no delays anywhere.
- `src/lib/game/connection-manager.ts` — in-memory SSE registry, kept on `globalThis` so dev reloads do not orphan open pages.
- `src/app/api/game/[gameId]/events/route.ts` — the SSE endpoint; `syncClientState` replays everything a reconnecting client is allowed to see.
- `scripts/lib/sim.ts` — drives games in-process for the harness and evolution loop.

## Rules that are easy to break

- The judge must never learn who is who from anything but the words: no timing, no ordering, no sender roles in API responses, no label mapping before the game is complete.
- The AI contestant and AI judge are told the rules and the goal, not tactics. Strategy text is theirs; prompts that add "tips" undo the experiment.
- The first question of a game must be plainly answerable by a child; after that, anything goes.
- Browser dialogs (`confirm`, `alert`) are suppressed in some embedded browsers; confirm in the page.
- Adding a `GameEvent` type requires adding it to the subscription map in `src/lib/hooks/use-game-sse.ts` (the compiler enforces this).

## Verifying changes

Type-check (`npx tsc --noEmit`), lint, then play a game: `npx tsx scripts/demo-game.ts llm 3 <contestant> <judge>` and open the printed link. For prompt changes, run `scripts/harness.ts` for a small batch and compare fooled rates.
