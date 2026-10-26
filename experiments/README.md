# Experiments

Results of the simulation and evolution runs described in the main README, one JSON file per run. These are early, provisional results published for research purposes: small populations, a handful of generations, one judge model, and fitness measured against other model strategies rather than against people. They show what the loop produces and how strategies change under selection; they are not a claim about how well any of them fool a human.

Files named `smoke-*` are short runs used to check the tooling and can be ignored.

| File | What it is |
|---|---|
| `evo1-*.json` | First evolution run: 6 strategies, 4 generations, scored against a simulated human (DeepSeek V4 Pro contestant and judge, 96 games). |
| `tour1-*.json` | First tournament run: 8 strategies, 8 generations, strategy vs strategy with cumulative records (128 games). The winner's lineage runs from an eager child persona to a laconic one. |

Each file holds, per generation, every strategy's text, its record, its parent, and the matches played. `npx tsx scripts/evo-report.ts experiments/<file> --full` prints a summary with the winner's lineage.

Expect these to be superseded: the harness still uses model-simulated humans, and the plan is to replace that seat with answers from real players and to evolve the judge as well as the contestants.
