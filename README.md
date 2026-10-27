# Sunchaser

[![Build and score reporting](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml/badge.svg?branch=main)](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml?query=branch%3Amain)

**[See the latest score and progress →](https://github.com/jordanwilcken/torus-hackathon2026/actions/workflows/requirements.yml?query=branch%3Amain)**
Open the latest run: the **Score** job shows the numeric result; the run summary
shows progress by area and every requirement's result. Each run records its commit,
so earlier runs show how the implementation is progressing. The badge above shows
build/reporting health, not the rubric score.

TypeScript, React and Vite setup for the Torus hackathon. The current UI is a launch
shell. The planner, market, simulator and reporting behavior are still to implement.

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
- Connect `test/userflows/compute-flow.ts` to the real UI. Its three Playwright flows
  are enabled and intentionally fail until implemented. They do not prescribe
  a product layout. `BOOT-01` only proves React/Vite launches.
- Keep application logic in ordinary TypeScript components and preserve their
  public contracts.

`npm test` runs Vitest. `npm run test:userflows` runs Playwright, including the launch
smoke test. `npm run test:tooling` checks the score reporter.

## Commit reports

GitHub Actions runs on every push and on manual dispatch. It reports the tested
commit SHA, build stages, test outcomes and internal automated rubric points,
then uploads the raw evidence and browser traces. One push with several commits
tests its resulting revision, not each intermediate commit.

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

`rubric.json` fixes 100 internal points across routing/reporting (40),
bidding/execution (40) and the live map (20). Only successful requirement cases
earn points; build and smoke tests earn none. Missing cases stay in
the denominator. This is not an official judging score or a percentage of product
completion. Creativity and clarity of insight need human review.

`src/core/` holds contracts and application code; `src/ui/` holds UI features.
Both use `jobs`, `energy`, `market`, `execution` and `reporting` folders.
Core acceptance tests mirror those features under `test/core/`; browser flows
mirror them under `test/userflows/`. Shared test mechanics live in `test/dsl/`
and `test/driver/`. Empty UI folders are placeholders, not implementations.

Router and site-agent signatures are asynchronous. Native input types belong to
their energy or reporting feature. The TypeScript target and library use `ESNext`.
Tests use `.test.ts`; interface-only files use `.interface.ts`; type aliases use `.type.ts`.

Design context: [design.md](design.md). Test harness references:
[Playwright web server](https://playwright.dev/docs/test-webserver) and
[Vitest test inclusion](https://vitest.dev/config/include.html).
