# Sunchaser

[![Build and score reporting](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml/badge.svg?branch=main)](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml?query=branch%3Amain)

<!-- scorecard:start -->
<!-- scorecard:run 14 attempt 1 -->
**[Open latest CI scorecard →](https://github.com/jordanwilcken/torus-hackathon2026/actions/runs/40638012882)** · **[Download scorecard + rubric](https://github.com/jordanwilcken/torus-hackathon2026/actions/runs/40638012882/artifacts/12794496376)** · [All runs](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml?query=branch%3Amain)

Latest reported commit: [`c87b872`](https://github.com/jordanwilcken/torus-hackathon2026/commit/c87b872f71a2f104b2979e2a5c0f949fa9239ddb) · Run 14, attempt 1.
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
