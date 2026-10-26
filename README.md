# Reverse Turing Test

A live, multiplayer Turing test. A judge questions two contestants — one human, one AI — and has to decide which is which from the words alone. Built as a research platform for studying how language models imitate people and how people (and models) detect them.

## How a game works

1. A host creates a game and shares two join links: one for the human contestant, one for the judge. No sign-in is needed to play.
2. Each round the judge asks one question. Both contestants answer it. The human types; the AI contestant answers from a strategy it writes for itself.
3. Both answers are held until both are in, then revealed together in random order and streamed at the same speed. Typing time, generation time and response order carry no signal.
4. After the last round — or earlier, once the judge is confident — the judge names the human. The verdict and reasoning are shown to everyone.

The judge can be a person or a model. When the judge is a model it writes short case notes with each question (its working theory and what the question is meant to test), which can optionally be revealed after each round.

## What the AI contestant is told

Only the rules of the game and its goal. It is not given a persona or tactics. Before the first question it writes its own strategy, starting from the judge's side of the table ("if you were the judge, how would you tell the human from the AI?"), and it revises that strategy after every round in light of the human's answers and the judge's notes. The same applies to an AI judge: it writes a fresh strategy at the start of each session and is shown what it tried in earlier sessions so that it does not repeat itself.

## Research tooling

Everything a game produces is stored: questions, answers, each side's strategy at the moment it answered, the judge's case notes, and the verdict. On top of that there is a simulation harness and an evolution loop.

- `scripts/harness.ts` plays fully automated games through the real engine with delays switched off: an AI contestant, an AI judge, and a simulated human drawn from a persona bank. Reports how often the judge was fooled.
- `scripts/evolve.ts` evolves contestant strategies as a tournament: every game pits two strategies against each other, the judge's pick wins, fitness is the cumulative win rate, and each surviving strategy rewrites itself from its games and the judge's reasoning. New runs seed from the best strategies of earlier runs.
- `scripts/evo-report.ts` summarizes a run: standings per generation, the winner's lineage, and the strategy text.
- `scripts/demo-game.ts` creates a playable game from the command line, optionally locked to an evolved strategy.

Simulated games cost a few cents each on DeepSeek; a 128-game tournament ran for about $6.

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript
- PostgreSQL with Prisma 7
- Clerk authentication (hosts only; participants join by link)
- Vercel AI SDK with Anthropic, OpenAI, Google and DeepSeek providers
- Server-Sent Events for real-time play
- Tailwind CSS 4, shadcn/ui, Zustand

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL
- A [Clerk](https://clerk.com) application (for host sign-in)
- At least one AI provider API key

### Installation

```bash
git clone https://github.com/Praxica/reverse-turing.git
cd reverse-turing
npm install
```

### Environment

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. A `?schema=` parameter is honoured. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_APP_URL` | Public URL of the app, used to build join links |

AI providers (at least one):

| Variable | Provider |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google (Gemini) |
| `DEEPSEEK_API_KEY` | DeepSeek |

### Database

```bash
npx prisma migrate deploy
npx prisma generate
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in, and create a game. Or skip the UI:

```bash
# A solo game: you are the human, an AI judge asks the questions
npx tsx scripts/demo-game.ts llm 5 deepseek:deepseek-v4-pro deepseek:deepseek-v4-pro

# A two-person game with a human judge (prints both join links)
npx tsx scripts/demo-game.ts human 5
```

### Simulations

```bash
# Baseline: 20 automated games, AI contestant vs simulated human, AI judge
npx tsx scripts/harness.ts --games 20 --contestant deepseek:deepseek-v4-pro --judge deepseek:deepseek-v4-pro

# Evolve contestant strategies for 6 generations
npx tsx scripts/evolve.ts --pop 8 --gens 6 --games 4 --model deepseek:deepseek-v4-pro --judge deepseek:deepseek-v4-pro
npx tsx scripts/evo-report.ts experiments/<run>.json --full

# Play a live game against an evolved strategy
npx tsx scripts/demo-game.ts llm 5 deepseek:deepseek-v4-pro deepseek:deepseek-v4-pro --strategy experiments/<run>.json
```

Set `LLM_USAGE_LOG=1` to print token usage for every model call.

## Project structure

```
src/app/              # Pages (home, new game, host dashboard, play, judge) and API routes
src/components/game/  # Game UI
src/lib/game/         # Engine: game state machine, LLM prompts, delivery, SSE registry
src/lib/stores/       # Client state (Zustand)
src/lib/hooks/        # SSE connection, start-over
prisma/               # Schema and migrations
scripts/              # Harness, evolution loop, reports, game creation
experiments/          # Evolution run results (not published; see below)
```

## A note on what this produces

The evolution loop produces strategies for passing as human, and the judge data describes what gives language models away. Those are two views of the same material, and both are useful: the detection side is what AI-text detection needs, the impersonation side is what makes the game hard enough to be interesting. This repository publishes the tooling. Evolved strategy files are kept out of the public repository by default; what you do with yours is up to you.

## License

Reverse Turing Test is released under the [O'Saasy License](LICENSE.md): free to use, modify and distribute, including commercially, but not to offer as a competing hosted service.
