#!/usr/bin/env bash
# Run on the intended Ubuntu/Debian demo host only. No credentials in user-data.
set -euo pipefail
if [[ $# -lt 3 || $# -gt 4 ]]; then
  printf 'Usage: sudo bash install.sh RELEASE.tar.gz EXPECTED_SHA256 demo.example.com [PRIVATE_RUNTIME_ENV_FILE]\n' >&2
  exit 2
fi
[[ $EUID == 0 ]] || { printf 'Run as root.\n' >&2; exit 2; }
archive=$(readlink -f -- "$1")
expected_sha=$2
hostname=$3
runtime_file=${4:-/etc/sunchaser/runtime.env}
[[ -f "$archive" && "$expected_sha" =~ ^[a-f0-9]{64}$ ]] || { printf 'Invalid release path or checksum.\n' >&2; exit 2; }
[[ "$hostname" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$ ]] || { printf 'Supply the owned public DNS hostname, without a scheme or path.\n' >&2; exit 2; }
[[ -f "$runtime_file" ]] || { printf 'Prepare the private runtime environment file first.\n' >&2; exit 2; }
grep -Fxq "PUBLIC_ORIGIN=https://$hostname" "$runtime_file" || { printf 'PUBLIC_ORIGIN must match the intended HTTPS hostname exactly.\n' >&2; exit 2; }
if grep -q 'REPLACE_' "$runtime_file"; then printf 'Replace environment placeholders before installing.\n' >&2; exit 2; fi
printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum -c -
# Archives are produced by package-demo.mjs; reject paths escaping their release.
while IFS= read -r entry; do
  case "$entry" in /*|../*|*/../*|*/..|*\\*) printf 'Unsafe archive path.\n' >&2; exit 2;; esac
done < <(tar -tzf "$archive")

apt-get update
apt-get install -y ca-certificates curl xz-utils gnupg debian-keyring debian-archive-keyring apt-transport-https
app_root=/opt/sunchaser
install -d -m 0755 "$app_root/releases"
node_version=24.19.0
case "$(uname -m)" in
  x86_64) node_arch=x64; node_sha=14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647 ;;
  aarch64) node_arch=arm64; node_sha=01443c1e1a29e531ccad5a46fefa6df490d2189c49f7955904aecdbb0fe86fdc ;;
  *) printf 'Supported architectures: x86_64 and aarch64.\n' >&2; exit 2 ;;
esac
# SHA256 values are pinned from nodejs.org/download/release/v24.19.0/SHASUMS256.txt.
node_directory="$app_root/node-v${node_version}-linux-${node_arch}"
if [[ ! -x "$node_directory/bin/node" ]]; then
  staging=$(mktemp -d)
  trap 'rm -rf -- "$staging"' EXIT
  node_archive="node-v${node_version}-linux-${node_arch}.tar.xz"
  curl --fail --silent --show-error --location "https://nodejs.org/download/release/v${node_version}/${node_archive}" -o "$staging/$node_archive"
  printf '%s  %s\n' "$node_sha" "$staging/$node_archive" | sha256sum -c -
  tar -xJf "$staging/$node_archive" -C "$app_root" --no-same-owner
fi
ln -sfn "$node_directory" "$app_root/node"
export PATH="$app_root/node/bin:$PATH"
[[ "$(node --version)" == v24.19.0 ]] || { printf 'Unexpected Node version.\n' >&2; exit 2; }

id sunchaser >/dev/null 2>&1 || useradd --system --home-dir /var/lib/sunchaser --shell /usr/sbin/nologin sunchaser
install -d -o sunchaser -g sunchaser -m 0700 /var/lib/sunchaser /var/lib/sunchaser/grid /var/lib/sunchaser/jobs
install -d -o root -g root -m 0700 /etc/sunchaser
if [[ "$(readlink -f "$runtime_file")" != /etc/sunchaser/runtime.env ]]; then
  install -o root -g root -m 0600 "$runtime_file" /etc/sunchaser/runtime.env
else
  chown root:root /etc/sunchaser/runtime.env
  chmod 0600 /etc/sunchaser/runtime.env
fi
release="$app_root/releases/${expected_sha:0:24}"
[[ ! -e "$release" ]] || { printf 'This release directory already exists; use the documented rollback/restart flow.\n' >&2; exit 2; }
install -d -m 0755 "$release"
tar -xzf "$archive" -C "$release" --no-same-owner
[[ -f "$release/dist/index.html" && -f "$release/src/server/start.ts" && -f "$release/release.json" ]] || { printf 'Release is missing application files.\n' >&2; exit 2; }
node --input-type=module -e 'import { readFileSync } from "node:fs"; const manifest = JSON.parse(readFileSync(process.argv[1], "utf8")); if (manifest.dirty !== false) throw new Error("Do not deploy an uncommitted test release.");' "$release/release.json"
# Dependency install scripts are disabled; application runtime uses built-in SQLite.
npm ci --prefix "$release" --omit=dev --ignore-scripts --no-audit --no-fund
chown -R root:root "$release"
find "$release" -type d -exec chmod 0755 {} +
find "$release" -type f -exec chmod 0644 {} +
install -m 0644 "$release/deploy/sunchaser.service" /etc/systemd/system/sunchaser.service

if ! command -v caddy >/dev/null; then
  curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o /tmp/sunchaser-caddy-key.asc
  gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /tmp/sunchaser-caddy-key.asc
  curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
# This host is dedicated to the demo. Do not run this installer on a shared Caddy host.
printf '%s {\n  reverse_proxy 127.0.0.1:3000\n}\n' "$hostname" > /etc/caddy/Caddyfile.sunchaser
caddy validate --config /etc/caddy/Caddyfile.sunchaser --adapter caddyfile
if systemctl cat sunchaser.service >/dev/null 2>&1; then systemctl stop sunchaser.service; fi
if [[ -L "$app_root/current" ]]; then ln -sfn "$(readlink -f "$app_root/current")" "$app_root/previous"; fi
ln -sfn "$release" "$app_root/current"
install -m 0644 /etc/caddy/Caddyfile.sunchaser /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable sunchaser.service caddy.service
systemctl start sunchaser.service
systemctl reload-or-restart caddy.service
for attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:3000/healthz >/dev/null; then
    printf 'Local health check passed. Verify HTTPS, authentication, live inputs, job output and restart at https://%s/ before declaring the demo ready.\n' "$hostname"
    exit 0
  fi
  sleep 1
done
printf 'Application health failed. Inspect journalctl -u sunchaser; preserve data and use the documented rollback procedure.\n' >&2
exit 1
