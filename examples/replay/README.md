# Captured paired replay

For the interactive demo, start the app with `npm run dev` and open `/?scenario=paired-replay`, or click **Stream jobs on the map** in the main navigation. This uses `job-stream.json` and steps the actual paired simulator; the animations do not play a precomputed result.

1. Open the monkey icon in the map corner and click **Step**. Job 01 arrives and waits for the cheaper solar hour.
2. Step again. Job 01 runs at A, and job 02 arrives and waits because the current capacity is taken.
3. Step again. Job 02 runs at A and job 03 arrives and runs at its home site B. Click any job to inspect its decisions, retained map offers and work receipts.
4. Step the final hour to include idle demand and ending storage, then download the paired evidence JSON. **Play**, **Pause**, speed and **Reset** control this same engine.
5. Reset, settle the first hour, then apply **Solar drop at Site A** before continuing. The event changes realized supply in both runs, leaves the forecast intact and is retained in the export.

This proves admission, home-site time selection, capacity competition, modeled execution and fleet accounting. It does not prove automatic cross-site migration. A/B capacity, energy and job demand are declared synthetic inputs; their city coordinates are display references. The separate **Public inputs and real CPU execution** mode demonstrates the actual bounded CPU worker. Public cluster traces can later supply historical job arrivals, but they do not provide live machines or measured energy for these modeled sites.

Both UI and CLI exports contain the full scenario and raw results. To replay a UI download with the CLI, save its `scenario` object as a scenario JSON file and pass that file to the command below. The CLI additionally records the input-byte hash and local Git provenance.

From the repository root, with the locked dependencies installed and Node 24.19 or newer in the supported Node 24 line:

```sh
node scripts/run-simulation.mjs
node scripts/run-simulation.mjs examples/replay/solar-shift.json .reports/solar-shift-evidence.json
```

The first command prints JSON. The second writes a new evidence file; existing files and tracked repository files are refused. Use another filename for a later export. A custom captured scenario can replace the first argument. Invalid arguments, invalid input and execution failures exit nonzero. An honest noncomparable result is valid evidence and exits successfully.

The two policies receive the same captured jobs, sites, initial storage, realized supply and hard limits. Home-site FIFO runs immediately when feasible; the coordinated home-site policy can wait for an eligible priced hour. Both arms use the same simulator, ledger, executor and reporting code. Forecasts remain projections and later observations are revealed at their modeled time. This first policy admits fresh queued jobs at home on UTC hour boundaries; readyAt must precede the horizon end, and both readyAt and the job window start must be hour-aligned. Mid-hour deadlines are allowed. Unsupported admission or migration is rejected explicitly.

For `solar-shift.json`, both arms complete the same 1 GPU-hour job. The coordinated run waits for solar. The whole-fleet totals include idle site B:

| Modeled fleet quantity | Home FIFO | Coordinated |
| --- | ---: | ---: |
| Carbon | 0.52 kg | 0.12 kg |
| Modeled cost | $0.117 | $0.027 |
| Electricity expenditure | $0.065 | $0.015 |

The default example has zero storage. Its matched ending inventories therefore isolate the timing example; they do not establish a storage benefit. Storage scenarios must retain matching ending inventory and the same dispatch policy before claiming a comparable reduction.

The storage variant adds a fourth hour with a 1 kW fixed load at A:

```sh
node scripts/run-simulation.mjs examples/replay/storage-shift.json .reports/storage-shift-evidence.json
```

Both arms start and finish at 0 kWh, charge 1 kWh and discharge 1 kWh under the same dispatch policy. The modeled reduction remains 0.4 kg and $0.09. The extra idle-site hour changes absolute fleet totals, so use this variant's own exported totals rather than the default table above.

The export retains the scenario, policies, raw tick meters, decisions, work, inventories and comparison. `provenance.scenarioSha256` hashes the exact input bytes, including whitespace. `provenance.engine` records the Git revision and whether the worktree was dirty. No current wall-clock timestamp or local file path is added, so unchanged input and engine state produce identical JSON. A dirty revision requires preserving those local code changes to reproduce it.

These are modeled energy and compute results from declared synthetic inputs. The command and interactive replay share the same engine. Neither performs real CPU/GPU work, migrates a running job, fetches live data or measures real energy savings.

Run the scoped CLI checks with:

```sh
node --test test/tooling/replay-cli.test.mjs
node node_modules/@playwright/test/cli.js test --config test/userflows/replay/playwright.config.ts
```
