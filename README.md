# Sunchaser

[![Build and score reporting](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml/badge.svg?branch=main)](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml?query=branch%3Amain)

<!-- scorecard:start -->
<!-- scorecard:run 38 attempt 1 -->
**[Open latest CI scorecard →](https://github.com/jordanwilcken/torus-hackathon2026/actions/runs/40746831230)** · **[Download scorecard + rubric](https://github.com/jordanwilcken/torus-hackathon2026/actions/runs/40746831230/artifacts/12842212837)** · [All runs](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml?query=branch%3Amain)

Latest reported commit: [`5013416`](https://github.com/jordanwilcken/torus-hackathon2026/commit/5013416bb73cfcefa1af10142fc835367a962cbb) · Run 38, attempt 1.
<!-- scorecard:end -->

The links update automatically after main-branch CI. The run summary shows the numeric score,
progress by area and every requirement's result. The download includes the
scorecard and exact rubric. The badge above shows build/reporting health,
not the rubric score.

TypeScript, React and Vite application for the Torus hackathon. The map, energy
timeline and job stream display supplied observations; reporting aggregates fleet
meters, work and transfers into comparable carbon and cost summaries. The real
planner, scheduler and executor remain separate implementation work.

Use Node **24.19.0** and npm **11.20.0**:

```sh
npm ci
npm run build
npx --no-install playwright install chromium
npm run test:score
npm run dev
```

`npm run test:score` runs Vitest and Playwright, writes `.reports/score.md` and
`.reports/score.json`, and returns failure while requirements remain red.
It keeps runner errors, unimplemented drivers, skipped and missing cases distinct.

## Work from red to green

- Implement application components and bind `test/driver/torus.ts` to their real
  public APIs. Keep checks in `test/dsl/`; a driver must not contain its own
  scheduler, carbon calculation or expected answers.
- Continue connecting `test/userflows/compute-flow.ts` to the real UI. Stale-site and recorded-report checks use implemented components. Scheduling/execution flows
  remain enabled and fail until their components are implemented. They do not prescribe
  a product layout. `BOOT-01` only proves React/Vite launches.
- Keep application logic in ordinary TypeScript components and preserve their
  public contracts.

With the dev server running, `/test/userflows/legacy/index.html?scenario=stale-site` exercises current/stale map readings. `/test/userflows/legacy/index.html?scenario=recorded-comparison` feeds labeled raw simulation records through the real aggregator, observers and UI. It does not execute jobs.

`npm test` runs Vitest. `npm run test:userflows` runs Playwright, including the launch
smoke test. `npm run test:tooling` checks the score reporter.

## Commit reports

GitHub Actions runs on every push and on manual dispatch. It reports the tested
commit SHA, build stages, test outcomes and internal automated rubric points,
then uploads the raw evidence and browser traces. One push with several commits
tests its resulting revision, not each intermediate commit.

CI updates only the scorecard block above through a README-only bot commit.
Older results cannot replace newer links. These bot commits do not trigger another
CI run; the linked commit remains the revision that was actually tested.

The summary links to a **`readiness-score-<commit>-attempt-<n>`** artifact containing the
readable `score.md`, machine-readable `score.json`, and the exact `rubric.json`
used for that run. The separate **`requirements-<commit>-attempt-<n>`** artifact keeps
the runner logs, reports and browser traces. Attempts have distinct names so a
rerun preserves earlier evidence. Both are retained for 14 days.

Requirement failures are advisory: they remain **RED** in the scorecard and earn
zero points, while the reporting workflow can succeed. Build, tooling, browser
setup and invalid/missing score evidence still fail CI. An unavailable score is
shown as **unavailable**, never as a measured zero. No PR flow, deployment, hooks
or required checks are configured.

`rubric.json` fixes 100 internal points under the literal bounty capabilities:

- **A job router that shows carbon saved** — 40 points.
- **Agents that bid for the cleanest slots** — 40 points.
- **A live map of where to train right now** — 20 points.

Only successful requirement cases earn points; build and smoke tests earn none.
Missing cases stay in the denominator. This is not an official judging score or a
percentage of product completion. Creativity and clarity of insight need human review.

The bounty capability stays visible in the scorecard. We demonstrate it through
posted-price selection: a job chooses a lower-carbon eligible slot from supplied
prices and forecasts, retains that evidence and accepts its posted price. This
routing example does not claim an auction, price generation or measured emissions;
execution and reporting have separate checks.

Rubric **2.0.0** retains that capability while retiring auction mechanics and per-job
bidding budgets. Its 40 points cover cleaner eligible choice (8), protected energy
(6), remaining GPUs (6), utility commitments (4), transfer deadlines (4), partial
execution (6) and the posted-price user flow (6). Reporting also checks the modeled
dollar headline separately from electricity expenditure. Compare progress within
one rubric version; version changes are not implementation gains. The exact
migration notes travel with the rubric artifact.
The additional depleted-storage comparison guard earns no points but must pass
before CI reports all tests green.

`src/core/` holds contracts and application code; `src/ui/` holds UI features.
Both use `jobs`, `energy`, `scheduling`, `execution` and `reporting` folders.
Core acceptance tests mirror those features under `test/core/`; browser flows
mirror them under `test/userflows/`. Shared test mechanics live in `test/dsl/`
and `test/driver/`. Empty UI folders are placeholders, not implementations.

Routing returns a selected allocation or an explanation; posted prices replace the auction mechanism. Native input types belong to
their energy or reporting feature. The TypeScript target and library use `ESNext`.
Tests use `.test.ts`; interface-only files use `.interface.ts`; type aliases use `.type.ts`.

Design context: [design.md](design.md). Test harness references:
[Playwright web server](https://playwright.dev/docs/test-webserver) and
[Vitest test inclusion](https://vitest.dev/config/include.html).

## Live regional inputs

With the pinned Node/npm versions, copy `.env.example` to `.env.local` and set `EIA_API_KEY` there. This server-only file is ignored by Git; never give the variable a `VITE_` prefix. Run `npm run dev`, or `npm run build` followed by `npm run preview`. Both commands serve the same live API routes:

- `/api/grid/eia`: EIA-930 PACE demand, generation, signed interchange, and separately labeled day-ahead demand forecasts. The server requests a bounded 72-hour history plus 24-hour forecast horizon and caches successful snapshots for 15 minutes.
- `/api/grid/caiso`: anonymous CAISO OASIS five-minute PACE wholesale dispatch prices, cached for five minutes. Negative prices remain valid. These prices do not establish a site's retail bill or available compute.

The page polls these independent server caches each minute. Failed refreshes preserve the original reading and retrieval timestamps, expose the failure, and back off (including Retry-After). No Fake values replace an unavailable live feed. Each successful collection is saved before publication. On restart, the server restores the last verified snapshot and attempts a live refresh; a failed refresh leaves the saved revision visibly stale. Public source values and UTC validity intervals stay distinct from retrieval time. EIA demand is delayed; generation/interchange generally arrive later. This API connection has no carbon series: the existing workbook adapter remains the separate source for delayed carbon history.

`ApiRegionalGrid` implements the existing synchronous `RegionalGrid.read` contract over a normalized EIA snapshot. The visible live-input panel consumes that provider. The existing illustrative map/job preview remains explicitly simulated; the real local CPU execution panel below it has a separate, explicit dispatch policy. A static `dist/` upload alone cannot serve the APIs: deployment must retain the server routes and server environment secret.

Browser CI uses an owned server seeded from sanitized real public captures, with their original timestamps and an explicit historical evaluation time. Provider parsers, revision archives, the actual application, local policy, child process and durable job store all run. No EIA credential or live upstream request is needed. Live connectivity and a current-data run are checked separately. LIVE-01 is reported outside the unchanged 100-point readiness rubric and now verifies the local CPU execution chain with a separately labeled storage model; the other unfinished GPU/map requirements remain visible.

### Consume the live feeds

Create one client in application assembly and pass it to each standalone view. `src/main.tsx` does this already. The exported React hook subscribes to that shared client; the first subscriber starts polling, and the last unsubscribe stops polling and cancels owned requests. Outside React, use `subscribe` / `getSnapshot`, or `await refresh()` for a one-shot read. Refresh failures resolve with stale/unavailable state; cancellation does not publish obsolete results.

```tsx
import { createPublicGridClient } from './src/data/createPublicGridClient';
import { useFeed } from './src/ui/data/useFeed';
import type { PublicGridClient } from './src/data/createPublicGridClient';

const feeds = createPublicGridClient(); // once per application/session

function Demand({ feeds }: { feeds: PublicGridClient }) {
  const input = useFeed(feeds.eia);
  // The snapshot is immutable. Show input.status and the original source intervals.
  return <p>{input.status} · {input.snapshot?.observations.length ?? 0} observations</p>;
}
// <Demand feeds={feeds} /> can be mounted alongside other independent consumers.
```

`feeds.eia` and `feeds.caiso` each expose `status`, `snapshot`, `revision`, request times and failure information. Revisions identify the complete normalized publication, including retrieval provenance. Identical cached content keeps its revision; a failed refresh keeps the last successful revision and evidence timestamps. Each source advances independently. The server persists each publication and sanitized source evidence in the local archive described below.

`feeds.regionalGrid` is a stable synchronous `RegionalGrid` view of the latest EIA snapshot. It can be supplied to `createEnergyMap(scope, { siteEnergy, regionalGrid: feeds.regionalGrid })` alongside the application's existing site-energy provider. Observe `feeds.eia` to redraw consumers when its state changes. This does not create site capacity, prices or carbon evidence, resample hourly periods into partial slots, or wire the application's existing map/scheduler automatically.

For a decision that spans asynchronous work, capture `feeds.eia.getSnapshot()` once, check its status and source age, and use `new ApiRegionalGrid(input.snapshot)` with that captured revision. A live provider may advance between separate reads; a pinned provider keeps the decision's input fixed. CAISO prices remain five-minute wholesale context until an explicit interval and signed-price policy adapts them to the site's accounting/pricing contract.

The executable example at `test/userflows/data/fixture.html` mounts two independent consumers: one reads the snapshot, the other uses the synchronous regional provider. Its browser test verifies shared revisions through refresh and failure. The application's live panel uses the same exported client/hook.

### Persist and replay snapshots

The server stores immutable revision files in `.cache/grid/eia/` and `.cache/grid/caiso/`, with a separate `latest.json` pointer for each feed. Set the server environment variable `GRID_SNAPSHOT_DIR` to an absolute path to use a persistent deployment volume. The default cache directory is ignored by Git. A deployment with an ephemeral filesystem loses its archive when that filesystem is replaced.

Each revision file contains the normalized snapshot, its SHA-256 revision, sanitized source evidence, and an evidence checksum. EIA evidence whitelists the response fields used by the parser and records credential-free query context; CAISO evidence retains the public CSV and query interval. API keys, full EIA request URLs, and unrecognized EIA metadata are excluded. Checksums detect corrupt files; they do not authenticate the publisher.

A new server loads the last saved revision once, preserving its original observation and retrieval times, then attempts a live collection. If collection fails, the retained snapshot is `stale`; if no valid snapshot exists, it is `unavailable`. A disk write failure also preserves the prior publication rather than advertising an unsaved revision. Each feed has its own revision and refresh cadence.

Capture the revision used by a decision, then replay that exact normalized publication:

```ts
const response = await fetch(`/api/grid/eia?revision=${recordedRevision}`);
if (!response.ok) throw new Error('Saved input is unavailable');
const { archived, revision, snapshot } = await response.json();
// archived === true: historical evidence, not a live FeedState.
const recordedGrid = new ApiRegionalGrid(snapshot);
```

The same endpoint is available for `/api/grid/caiso`. Replay never calls an upstream service or substitutes the latest data. It returns 404 for an absent revision, 400 for an invalid or repeated revision parameter, and 503 for unreadable or corrupt evidence. Responses contain normalized snapshots, not the server's source archive. `GRID_FEEDS_OFFLINE=1` disables both upstream collection and archive access for the owned CI server.

There is no automatic archive pruning yet. Keep the archive directory on the same persistent volume across restarts and retain revisions referenced by recorded decisions. The local CPU run receipt now retains those exact revisions. The visual fleet below captures its own weather and market source revisions for modeled scheduling; regional demand remains separately labeled context.

### Replace the storage backend

The backend-independent `SnapshotStore<T>` contract is in `src/server/SnapshotStore.type.ts`. It supplies `save(snapshot, evidence)`, `latest()`, and `read(revision)`. Each instance owns one feed; consumers receive only its revision, normalized snapshot, and source evidence. File paths, disk schema, checksums, database connections, and remote credentials belong to the implementation.

Choose stores once in server assembly (`vite.config.ts` and `src/server/applicationPlugin.ts`), then inject them:

```ts
const stores = {
  eia: createSnapshotArchive<EiaApiSnapshot>('/data/grid', 'eia'),
  caiso: createSnapshotArchive<CaisoSnapshot>('/another-volume/market', 'caiso'),
};
const api = createGridApi(apiKey, stores);
// Either value can instead be another implementation of SnapshotStore<T>.
```

The collector, cache, replay endpoint, and browser client do not select a storage location. The shipped implementation is the filesystem archive; database and remote-store adapters can implement the same contract without changing those consumers. Changing a binding selects that location's history; it does not copy records from the old location.

Replacement stores must preserve immutable snapshot/evidence pairs, the shared `snapshotRevision` identity, original timestamps, and missing-versus-corrupt behavior. `save` resolves only after durable publication and must leave the previous latest value intact on failure. Preserve the normalized JSON serialization used for the revision hash, including object-key order, rather than allowing a backend to silently rewrite it. Exact replay must return the requested revision. HTTP tests verify substitution through a test-only store; separate real-filesystem tests verify the concrete backend's persistence.

New collections update the current publication by saving a new immutable revision. History search and retention/deletion operations are not part of this initial contract; they can be added around concrete consumer needs without exposing arbitrary filesystem or database operations to the browser.

### Real local jobs and saved results

The **Run real work on this computer** panel captures the displayed EIA and CAISO revision IDs, evaluates an explicit policy, and runs an allowlisted Node child process only when admitted. It offers a demand-statistics workload using the captured EIA observations and an integer-sum workload. Change the demand or wholesale-price threshold to observe a genuine run-versus-wait decision using the same data. The policy also checks original observation and retrieval ages and the availability of its single owned worker.

The reference region is PACE. The actual worker is this computer; its physical grid region is unverified. This CPU admission policy does not reinterpret the existing GPU chooser's units, claim Utah GPU execution, infer site capacity from regional demand, or invent carbon intensity. The existing GPU/map simulation remains labeled separately.

`JobRunStore<T>` in `src/server/jobs/JobRunStore.type.ts` provides `create`, `read`, and version-checked `update`. The shipped SQLite adapter uses Node 24's built-in database module; no external database service or new package is required. `JOB_RUN_DIRECTORY` selects its directory (default `.cache/jobs`). Server assembly chooses this adapter, just as it chooses `SnapshotStore` implementations. A replacement must preserve durable create, atomic version checks, and independent returned values.

The application records the request, pinned input revisions and decision before launch, then records real process events, exit status and the output SHA-256. Reloading `?run=<request-id>` retrieves the stored receipt. Repeating an identical request ID returns the same run; a changed payload cannot replace it. A persisted in-flight run after restart becomes interrupted and is never silently executed again. Failed workers and failed durable writes cannot become successful results.

Run one application server per job directory. Worker ownership is local to that server; concurrent dev/preview servers must use distinct `JOB_RUN_DIRECTORY` values. The current endpoint is intended for the local application, not an unauthenticated public execution service. It accepts fixed structured workloads, never arbitrary code, shell commands or filesystem paths; workers receive no inherited EIA key or application secrets.

The storage comparison is a hypothetical energy-cycle estimate: both cases deliver the same assumed compute energy, and the battery case requires `energy / round-trip efficiency` while restoring its initial inventory. It uses the captured wholesale reference price for both cases, preserves negative differences, and labels the changed dispatch and sufficient-capacity assumptions. It is not the GPU routing comparison or a measured electricity bill. Actual energy, carbon and electricity cost stay unknown.

The LIVE-01 browser flow proves captured source values/revisions → public-input policy → actual process → downloaded output/hash → saved receipt. Separate cases prove threshold refusal, actual numeric-overflow failure, reload without a new POST, and analysis of 72 captured demand observations. A real two-process server test stops Vite, opens the same database in a fresh Vite process, and verifies the original receipt/output plus duplicate-request idempotency. Captures are under `test/fixtures/public-grid`; source values and timestamps are preserved and replay is labeled.

The repository workflow does not reference `EIA_API_KEY`. Keep personal keys in ignored server environment files. Teammates can register their own keys. A future credentialed live CI check should use an explicitly approved secret on trusted code; a normal GitHub variable is not secret storage. The ordinary suite needs no personal key.

### Visual live-input fleet

The normal entry now starts a 24-hour, six-city fleet model from current Open-Meteo radiation forecasts and a captured CAISO PACE wholesale reference price. Salt Lake City and Cedar City have separate coordinate-based forecasts and share PACE context. EIA demand remains regional context; it is never treated as spare site capacity. Network retrieval runs behind cached server APIs; missing, stale, incomplete or unsupported inputs leave the model unavailable instead of selecting a fake provider.

`GET /api/weather/sites` publishes a `FeedState<SiteWeatherSnapshot>` with a durable revision. Open-Meteo radiation is the average over the preceding UTC hour. The model explicitly derives solar from a declared 8 kW array and 0.8 performance ratio. GPU capacity, storage, grid import limits, fixed load, carbon factors, transfer terms and generated jobs are assumptions displayed in the UI. The CAISO value is held as a common reference throughout the run, not presented as each city's local tariff. Execution and energy are modeled; the separate CPU panel still runs an actual local process.

The existing chooser/executor now supports explicit fleet transfers with latency, energy and price assumptions. Every displayed transfer comes from its recorded move outcome; arrival requires a fresh allocation. A single model clock drives the map, job progress and inspection. Camera zoom does not restart the run. Blue data-center markers are publicly documented locations at coarse city references; their job submissions are simulated and do not imply operator access. The monkey changes explicit model inputs and preserves original source forecasts and prior receipts.

Pause settles any already-started canonical step and saves an immutable frozen moment. `POST /api/fleet/captures` stores the original source bundle, separately labeled latest context, scenario/events and detached progress; `GET /api/fleet/captures?revision=<sha256>` retrieves exactly that record. The `SnapshotStore<FrozenFleetSnapshot>` binding uses the same replaceable archive contract. Open `?capture=<sha256>` to retrieve it, reconstruct its runtime from captured inputs and verify every saved decision/receipt before resuming. New live feeds never replace saved evidence. Reset of a loaded moment returns to that moment, discarding subsequent stress injections. Starting with newer inputs is an explicit new run. In-place replanning from later wall-clock forecasts remains outside this accelerated replay contract.

The mandatory CI flow uses unchanged real provider captures, actual model calculations and real local CPU execution. It covers location/transfer inspection, US/Utah continuity, solar disruption, missing data, public data-center origins, and freeze → retrieve → stress → restore → reload with current feeds unavailable. Personal EIA credentials are unnecessary in CI.
