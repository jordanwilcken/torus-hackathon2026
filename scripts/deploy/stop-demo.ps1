param([Parameter(Mandatory = $true)][string]$RuntimeDirectory)
$ErrorActionPreference = 'Stop'
$RuntimeDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDirectory 'host.lock') -PathType Leaf)) {
  throw 'No managed demo session was found. No process was stopped.'
}
Set-Content -LiteralPath (Join-Path $RuntimeDirectory 'stop.request') -Value 'Stop the owned public demo session.'
Write-Output 'Requested a graceful stop. The current Cloudflare URL will stop working.'
