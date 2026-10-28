# Demo hosting

**Current deployment:** use the [Cloudflare Worker and SQLite Durable Object guide](cloudflare.md) for the hosted demo and CI pipeline. This runs independently of the developer computer on Workers Free. Paid hosting is not authorized and no AWS instance has been provisioned. The Node/Linux instructions below preserve a portable hosting option; they do not authorize paid resources.

This deployment serves the built UI and the real Node backend from one HTTPS origin. The CPU worker runs on the application server. EIA and CAISO remain public grid/market inputs, and Torus storage/energy comparisons remain explicitly modeled. Judges do not receive the EIA API key.

The host is a dedicated Ubuntu/Debian VM with an owned DNS name, public ports 80/443 and SSH restricted to the operator's address. Do not open Node port 3000. Provisioning, instance cost, DNS changes and public access are separate actions: these files do not create AWS resources. The installer replaces this dedicated host's Caddy configuration; do not run it on a shared server.

## Build the exact release locally

Use the repo's Node24 runtime and npm11.20.0. After the relevant tests pass, commit the reviewed changes and run:

```sh
node scripts/package-demo.mjs --npm-cli /path/to/npm/bin/npm-cli.js
```

The script runs the production build, refuses uncommitted changes by default, and creates `.cache/deploy/sunchaser-<commit>-<content>.tar.gz` with a neighboring `.sha256` file. `release.json` records the exact commit and hashes of included files. Only `dist`, `src`, package manifests and the named deployment files are included. No source `.env`, local database, snapshots, test captures, `node_modules`, AWS/SSH credentials or existing job history are shipped. The Node server serves only `dist`, not the source files carried in the private release directory.

`--allow-dirty` exists only to exercise packaging locally while developing. The installer rejects such an archive. Keep the tested archive; rebuilding it creates a different artifact even when the commit is the same.

## Prepare the host and secrets

1. In the intended AWS account, approve the instance size/cost and create a single Linux VM. Attach a static IP and point the chosen domain's A record to it. If an AAAA record exists, ensure it reaches this host too. Allow ports 80/443; restrict SSH. No autoscaling or second app process may share the job database.
2. Transfer the archive, its checksum and `deploy/install.sh` using the approved SSH connection. Obtain and verify the SSH host fingerprint through AWS before trusting the first connection. The release contains no private key.
3. Copy `deploy/runtime.env.example` to a private temporary file on the server, replace the placeholders, and restrict its permissions to `0600`. Set `PUBLIC_ORIGIN` to the exact HTTPS hostname and use a random demo password of at least 16 characters. Configure the existing EIA key here, never in Git, an image, a launch script, shell history or browser JavaScript. Transfer secrets over the verified SSH connection or enter them through the server's private configuration workflow. Do not print the completed file into chat or logs.
4. Run the installer, substituting the archive hash printed by the packaging script:

```sh
sudo bash install.sh /home/ubuntu/sunchaser-release.tar.gz EXPECTED_SHA256 demo.example.com /home/ubuntu/private-runtime.env
```

The installer pins Node24.19.0 and verifies its official SHA256, installs production dependencies without package install scripts, creates an unprivileged `sunchaser` user, and configures systemd and Caddy. Caddy obtains a public HTTPS certificate once DNS and ports are correct. No EIA secret goes into AWS launch data. After verifying `/etc/sunchaser/runtime.env` is present with owner `root` and mode `0600`, remove the temporary secret copy through the operator's normal file cleanup procedure.

Locations:

| Purpose | Host path |
| --- | --- |
| Immutable application releases | `/opt/sunchaser/releases/<archive-hash-prefix>` |
| Current / previous release links | `/opt/sunchaser/current`, `/opt/sunchaser/previous` |
| Runtime secrets | `/etc/sunchaser/runtime.env` (root, 0600) |
| Public grid snapshot archives | `/var/lib/sunchaser/grid` |
| Durable job receipts/output | `/var/lib/sunchaser/jobs/runs.sqlite` |
| Node runtime | `/opt/sunchaser/node` |
| App service | `sunchaser.service` |
| HTTPS proxy | `/etc/caddy/Caddyfile` |

The environment file contains credentials and public-origin configuration only. Host binding, port and storage paths are supplied by the service. Data is outside the release so ordinary application updates and restarts preserve it. The VM disk survives process/VM restarts, but destroying the instance is not a backup strategy. Preserve the disk/instance using an approved backup before deleting or replacing a host. To copy SQLite safely, stop the service or use a SQLite backup operation; copying only the database while WAL writes are active can lose receipts.

## Verify the deployed user flow

Do these checks against the **public HTTPS URL**, not only localhost:

- Open from desktop and mobile. Unauthenticated UI/API requests require the demo login; the EIA key never appears in browser source or responses. `/healthz` exposes only service health.
- Open the app, verify current EIA/CAISO publication revisions, source intervals, retrieval times and freshness. Missing/stale data stays visibly missing/stale; a failed upstream request must not turn a replay into a live observation.
- Submit the allowlisted sum `1, 2, 3, 4` with a policy permitting the displayed real public inputs. Observe the actual decision, real process/progress and output sum `10`. Check the successful output hash and record the saved run URL.
- Demonstrate that a refusing policy does not start a worker and an actual worker failure remains a failure. Show actual CPU execution separately from estimated energy and the Torus comparison.
- Restart with `sudo systemctl restart sunchaser`. Reopen the saved run URL: original process identity, completion timestamp, output and hash must remain unchanged, with no new submission/execution. Refresh and deep links work.
- Record the public URL, exact release commit/archive hash and verification evidence in the existing Notion deployment task. Local health or successful provisioning alone is not deployment acceptance.

Keep the labeled packaged-snapshot/replay/video demonstration available for an upstream outage. A fallback demonstration must say it is replay, and must retain the captured source timestamps.

## Update, inspect and recover

Package a new reviewed commit and install the new archive using the same command, omitting the final argument to retain the existing private environment file. The installer stops the old application before activating the new one. Do not start a second Vite, preview, Node or systemd instance against these storage directories.

```sh
sudo systemctl status sunchaser --no-pager
sudo journalctl -u sunchaser -n 100 --no-pager
curl --fail http://127.0.0.1:3000/healthz
```

Logs are for diagnostics; do not paste secrets. A successful local health response does not prove upstream availability or public HTTPS/authentication.

For a code-only rollback after checking the previous version can read the current storage schema:

```sh
sudo systemctl stop sunchaser
# Inspect this path; it must be an existing release under /opt/sunchaser/releases.
readlink -f /opt/sunchaser/previous
sudo ln -sfn /opt/sunchaser/previous /opt/sunchaser/current
sudo systemctl start sunchaser
```

Rerun the public checks and reopen the original saved receipt. Rollback changes application code, not the data directory. Do not run the installer against an existing release hash: restart or use this rollback flow instead. There is no automatic destructive database downgrade or automatic retry of interrupted jobs.

## Verified boundaries and references

Windows packaging and shell syntax checks can be performed locally. Linux package installation, systemd hardening, Caddy certificates, DNS, public-origin request handling and the public restart flow need verification on the actual host. Until that evidence is recorded, this is deployment preparation, not a hosted completion claim.

- [AWS Lightsail Node deployment](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-quick-start-guide-nodejs.html)
- [Official Node24.19.0 checksums](https://nodejs.org/download/release/v24.19.0/SHASUMS256.txt)
- [Official Caddy package installation](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
- [Caddy automatic HTTPS prerequisites](https://caddyserver.com/docs/automatic-https)
