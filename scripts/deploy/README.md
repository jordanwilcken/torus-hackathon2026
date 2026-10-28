# Public competition demo

The demo runs on the home PC behind a free Cloudflare Quick Tunnel. The host has one stable URL for its running session. It does not require a Cloudflare login, uploaded API key, paid plan or GitHub self-hosted runner.

## Updating from a laptop or teammate's computer

Push the reviewed application changes to **`main`** in `jordanwilcken/torus-hackathon2026`. The home PC checks main every 60 seconds, builds an isolated release, checks its built page and APIs, then switches the public application. It keeps the preceding release running if building or preflight fails and restores it if the new production process cannot start.

Open **`https://<the-running-demo-host>/__demo/status`** to see the exact active commit, candidate commit, update state and whether an update failed. Private logs, local paths and credentials are never returned there. A failed commit is retained in the local logs and is not rebuilt on every poll; push a corrected main commit to try again.

The tunnel and URL stay running during application updates. A short handoff can temporarily reject new write actions; wait for `watching` and retry. Refresh the browser to load the new interface. Existing snapshots and CPU receipts live outside release directories and survive updates. Do not change the local developer checkout to deploy: the updater uses its own mirror and release files.

## Start once on the home PC

Use Node 24 and the project's pinned npm CLI. Pass the official portable `cloudflared.exe`, the existing local environment file containing `EIA_API_KEY`, and a dedicated runtime directory:

```powershell
./scripts/deploy/start-demo.ps1 -NodeExecutable 'C:\path\to\node.exe' -NpmCli 'C:\path\to\npm-cli.js' -Cloudflared 'C:\path\to\cloudflared.exe' -EnvironmentFile 'C:\path\to\.env.local' -RuntimeDirectory 'C:\path\to\demo-runtime'
```

The actual URL is saved in `host.json` under the runtime directory. Startup and build logs are local under `logs/`. The environment key is given only to the server runtime, not Git, npm builds, the public gateway or Cloudflare. Do not commit `.env.local` or the runtime directory. A runtime inside the repo must be under ignored `.cache/`.

Ports: public gateway `5198`, serving preview `5200`, temporary preflight `5201`. All bind to loopback. Existing developer previews on `5194` and `5196` are independent. Starting another session does not stop an unknown process occupying a port.

To end the demo:

```powershell
./scripts/deploy/stop-demo.ps1 -RuntimeDirectory 'C:\path\to\demo-runtime'
```

## Demo boundaries

Keep this PC awake, plugged in and online. The current Quick Tunnel URL ends if its process or the PC stops, and restarting creates a new URL. Cloudflare Quick Tunnels have no uptime guarantee; this is a temporary competition deployment, not permanent hosting. See [Cloudflare's documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Only built assets, live inputs, capture save/retrieve and allowlisted CPU work are exposed. Writes require the exact public origin and have payload, rate, concurrency and session budgets. Session limits are 20 writes per minute, 500 job submissions, 250 capture saves and 256 MiB of capture input. Existing evidence remains readable if a write budget is exhausted. Updates do not reset those gateway budgets.

Weather/grid/price data are public observations or forecasts. Fleet sites, jobs and energy execution are modeled. CPU work executes on the home demo host; it does not run on a judge's laptop or at map locations.
