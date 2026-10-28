# Cloudflare-hosted demo

The Worker serves the built UI and authenticates every asset/API request. One SQLite-backed Durable Object named `demo` owns the shared EIA/CAISO caches, immutable snapshots, job receipts and actual bounded computation. This runs on Cloudflare; the developer's computer does not need to stay on.

This adapter uses the existing admission policy and storage contracts. It executes only the allowlisted `integer-sum` and `grid-summary` workloads. Receipts identify `cloudflare-durable-object` / `Cloudflare`, with no invented PID or process exit code. Measured energy/carbon stay unavailable; the Torus comparison remains an explicitly modeled scenario.

## Account and deployment

This is a **free-only deployment**. Confirm the **Workers Free** plan in the intended account before publishing. No paid tier, payment-method setup, verification hold, purchased domain, metered overage or automatic upgrade is allowed. Do not enable Containers, R2, D1 or another hosting service for this demo. The configuration uses only Workers assets and a SQLite-backed Durable Object. Free-plan quota exhaustion must remain a visible availability failure; use the local demo if free hosting cannot be used.

Build and test the reviewed commit before publishing. Wrangler's configuration is `wrangler.jsonc`; `assets.run_worker_first: true` is required so assets cannot bypass the demo login.

Configure these private Worker secrets through the authenticated Cloudflare workflow, never in source, `vars`, URLs, CI logs, or browser JavaScript:

- `EIA_API_KEY`: existing EIA credential.
- `DEMO_USERNAME`: shared judge login name.
- `DEMO_PASSWORD`: random demo password of at least 16 characters.

`wrangler secret put NAME` prompts for one value. Supply secrets through the approved private input mechanism. The app refuses to serve a purported live demo when these settings are missing. HTTPS requests use their actual request origin for POST validation; forwarded host/protocol headers grant no authority.

A local bundle check is `wrangler deploy --dry-run`. Publishing is a separate authorized action using `wrangler deploy`, after account/plan and test evidence are resolved. Use the deployed Worker's included `workers.dev` address; no domain purchase or DNS setup is part of this task.

## CI deployment setup

Automatic deployment is disabled until the repository variable `CLOUDFLARE_DEPLOY_ENABLED` is exactly `true`. Enable it only after publishing is authorized and the following GitHub environment configuration is ready:

- Create the `cloudflare-demo` environment. Store `CLOUDFLARE_API_TOKEN` as an environment secret, scoped to the intended Cloudflare account and the Worker deployment permissions needed by this project.
- Set `CLOUDFLARE_ACCOUNT_ID` as an environment variable for that same account. Keep it on Workers Free; this setup does not authorize an upgrade or new spending.
- Keep `EIA_API_KEY`, `DEMO_USERNAME` and `DEMO_PASSWORD` as private Worker runtime secrets. The CI job neither needs nor uploads the EIA key.

The deployment job runs only for `main` after the evidence job succeeds. The hosting contracts, desktop/mobile Node flows, Cloudflare execution/restart flows, packaging and production-artifact smoke are mandatory failure gates. Setting the enable variable does not bypass them.

CI builds once, packages the production Worker with Wrangler's dry run, and records the exact commit plus SHA-256 hashes. Deployment downloads that same run's immutable artifact by ID, verifies its commit and manifest against trusted job outputs, and invokes `wrangler deploy --no-bundle`. It never rebuilds a newer `main` checkout. Missing, changed, extra/private or uncommitted artifact files are rejected.

The existing product-readiness score remains advisory: incomplete or failing product requirements remain visible with their actual results and zero points. Passing the deployment gates demonstrates the checked hosting behavior, not completion of every product requirement. The fixture-based browser flows and the smoke of the exact production artifact are recorded as separate evidence.

## Evidence and persistence

The outer Worker forwards API traffic to the same `DEMO.idFromName('demo')` object. The object uses the existing `SnapshotStore` and `JobRunStore` adapters. Feed collection is awaited before responding; actual work is attached to the object's `waitUntil` lifetime after a durable submission receipt is created. A completed receipt survives isolate recreation/deployment. An unconfirmed in-flight run is reported interrupted when recovered and is not executed again automatically.

Production has no fixture-loading endpoint. The test assembly can seed original sanitized public captures directly into the actual SQLite storage and supply recorded feeds through the same runtime constructor. That establishes replay behavior; it is not a fresh live EIA request. Actual workerd/browser checks and a separate public live-input smoke are needed before claiming Cloudflare deployment complete.

At the deployed HTTPS URL verify login, visible input revisions/timestamps, real job output, saved run links after refresh, and unchanged receipt/output after recreation. Keep the original public timestamps and explicit modeled-energy labels. Capture the deployed commit and URL in the existing Notion task. Do not remove the Durable Object namespace or add destructive migrations to clean up a deployment; that is the persisted evidence.

Factory for application composition and test assembly:

```ts
createDemoRuntime(storage, {
  apiKey,
  waitUntil: promise => ctx.waitUntil(promise),
  // Tests may supply feeds and recordedAsOf; production uses live collectors.
}); // { stores, jobs, fetch }
```

References: [Workers static asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/), [Durable Objects SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
