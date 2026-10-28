# Sunchaser

[![Build and score reporting](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml/badge.svg?branch=main)](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml?query=branch%3Amain)

<!-- scorecard:start -->
<!-- scorecard:run 22 attempt 1 -->
**[Open latest CI scorecard →](https://github.com/jordanwilcken/torus-hackathon2026/actions/runs/40674684435)** · **[Download scorecard + rubric](https://github.com/jordanwilcken/torus-hackathon2026/actions/runs/40674684435/artifacts/12810285765)** · [All runs](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml?query=branch%3Amain)

Latest reported commit: [`c983bc1`](https://github.com/jordanwilcken/torus-hackathon2026/commit/c983bc1f7aca1dedd5017a3749b68b99cf89cb83) · Run 22, attempt 1.
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

With the dev server running, `/?scenario=stale-site` exercises current/stale map readings. `/?scenario=recorded-comparison` feeds labeled raw simulation records through the real aggregator, observers and UI. It does not execute jobs.

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

The page polls these independent server caches each minute. Failed refreshes preserve the original reading and retrieval timestamps, expose the failure, and back off (including Retry-After). No Fake values replace an unavailable live feed. Cache data is in memory; restarting the server starts a new collection. Public source values and UTC validity intervals stay distinct from retrieval time. EIA demand is delayed; generation/interchange generally arrive later. This API connection has no carbon series: the existing workbook adapter remains the separate source for delayed carbon history.

`ApiRegionalGrid` implements the existing synchronous `RegionalGrid.read` contract over a normalized EIA snapshot. The visible live-input panel consumes that provider. The existing illustrative map/job preview remains explicitly simulated; wiring real worker execution is a separate tracked requirement. A static `dist/` upload alone cannot serve the APIs: deployment must retain the server routes and server environment secret.

Browser CI uses `GRID_FEEDS_OFFLINE=1` on its owned test server and controlled endpoint fixtures; parser/collector tests cover raw provider payloads, normalization, caching and failures without credentials. Live connectivity is verified separately. Business requirement LIVE-01 is reported outside the unchanged 100-point readiness rubric and remains unimplemented until a real application worker returns actual output with linked input/decision evidence and a separately labeled Torus model comparison.

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

`feeds.eia` and `feeds.caiso` each expose `status`, `snapshot`, `revision`, request times and failure information. Revisions identify the complete normalized publication, including retrieval provenance. Identical cached content keeps its revision; a failed refresh keeps the last successful revision and evidence timestamps. Each source advances independently. The server still keeps its cache in memory; durable sanitized source archives remain part of the collector task.

`feeds.regionalGrid` is a stable synchronous `RegionalGrid` view of the latest EIA snapshot. It can be supplied to `createEnergyMap(scope, { siteEnergy, regionalGrid: feeds.regionalGrid })` alongside the application's existing site-energy provider. Observe `feeds.eia` to redraw consumers when its state changes. This does not create site capacity, prices or carbon evidence, resample hourly periods into partial slots, or wire the application's existing map/scheduler automatically.

For a decision that spans asynchronous work, capture `feeds.eia.getSnapshot()` once, check its status and source age, and use `new ApiRegionalGrid(input.snapshot)` with that captured revision. A live provider may advance between separate reads; a pinned provider keeps the decision's input fixed. CAISO prices remain five-minute wholesale context until an explicit interval and signed-price policy adapts them to the site's accounting/pricing contract.

The executable example at `test/userflows/data/fixture.html` mounts two independent consumers: one reads the snapshot, the other uses the synchronous regional provider. Its browser test verifies shared revisions through refresh and failure. The application's live panel uses the same exported client/hook.
