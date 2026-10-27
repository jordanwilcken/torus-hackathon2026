# Sunchaser

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

- The team consumes TypeScript in `src/core/` and `test/`. Josh maintains
  the authoring specifications and runs generation separately; the app has no
  `.expec` dependency or generation step in CI.
- Implement application components and bind `test/driver/torus.ts` to their real
  public APIs. Keep checks in the generated DSL; a driver must not contain its own
  scheduler, carbon calculation or expected answers.
- Connect `test/userflows/compute-flow.ts` to the real UI. Its three Playwright flows
  are enabled and intentionally fail until implemented. They do not prescribe
  a product layout. `BOOT-01` only proves React/Vite launches.
- Keep application logic in ordinary TypeScript components and preserve their
  public contracts. Coordinate contract changes with Josh's source hook.

`npm test` runs Vitest. `npm run test:userflows` runs Playwright, including the launch
smoke test. `npm run test:tooling` checks the score reporter.

## Commit reports

GitHub Actions runs on every push and on manual dispatch. It reports the tested
commit SHA, build stages, test outcomes and internal automated rubric points,
then uploads the raw evidence and browser traces. One push with several commits
tests its resulting revision, not each intermediate commit.

The workflow is advisory: no PR flow, deployment, hooks or required checks are
configured. A failing suite retains a red conclusion after reports are published;
it does not prevent the next direct commit or push.

`rubric.json` fixes 100 internal points across routing/reporting (40),
bidding/execution (40) and the live map (20). Only successful requirement cases
earn points; generation, build and smoke tests earn none. Missing cases stay in
the denominator. This is not an official judging score or a percentage of product
completion. Creativity and clarity of insight need human review.

`src/core/` holds contracts and application code; `src/ui/` holds UI features.
Both use `jobs`, `energy`, `market`, `execution` and `reporting` folders.
Core acceptance tests mirror those features under `test/core/`; browser flows
mirror them under `test/userflows/`. Shared test mechanics live in `test/dsl/`
and `test/driver/`. Empty UI folders are placeholders, not implementations.

Router and site-agent signatures are asynchronous. Native input types belong to
their energy or reporting feature. The TypeScript target and library use `ESNext`.
Tests use `.test.ts`; files containing only types use `.type.ts`.

Design context: [design.md](design.md). Test harness references:
[Playwright web server](https://playwright.dev/docs/test-webserver) and
[Vitest test inclusion](https://vitest.dev/config/include.html).
