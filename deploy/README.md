# Free-only demo hosting

This demo must incur no new hosting charges. Use only the existing computer or the verified Cloudflare Workers Free plan. Paid tiers, trials requiring a payment method, verification holds, purchased domains, metered overages and automatic upgrades are out of scope. If free capacity is unavailable, stop or use the local demo.

## Cloudflare

The [Cloudflare guide](cloudflare.md) covers the Worker, SQLite Durable Object and CI pipeline. Use the included `workers.dev` address. Public deployment is blocked until deployment access is authorized; automatic deployment remains disabled.

The application uses the existing EIA key privately on the server. Judges receive the protected demo URL, not the data credential. Free quota exhaustion must stay an availability failure; it must never trigger an upgrade or another hosting service.

## Existing computer

The local application remains usable without buying hosting. Configure the server-only EIA credential in the ignored `.env.local` file, then use the existing `npm run dev` workflow.

The built Node server also remains available through `npm start` after `npm run build`. Supply the variables documented in `.env.example` through the local process environment: `EIA_API_KEY`, `PUBLIC_ORIGIN=http://127.0.0.1:3000`, `DEMO_USERNAME` and a `DEMO_PASSWORD` of at least 16 characters. It binds to loopback by default and stores snapshots and receipts under `.cache/`.

Local execution and captured-input replay are useful demo fallbacks. Label replay with its original source timestamps, and keep the separate Torus energy comparison explicitly modeled. A local test is not evidence that the public URL is deployed.
