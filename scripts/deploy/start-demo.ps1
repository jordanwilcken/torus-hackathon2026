param(
  [Parameter(Mandatory = $true)][string]$NodeExecutable,
  [Parameter(Mandatory = $true)][string]$NpmCli,
  [Parameter(Mandatory = $true)][string]$Cloudflared,
  [Parameter(Mandatory = $true)][string]$EnvironmentFile,
  [string]$RuntimeDirectory = (Join-Path $PSScriptRoot '..\..\.cache\public-demo')
)
$ErrorActionPreference = 'Stop'
foreach ($file in @($NodeExecutable, $NpmCli, $Cloudflared, $EnvironmentFile)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required local file does not exist: $file" }
}
$RuntimeDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
New-Item -ItemType Directory -Path (Join-Path $RuntimeDirectory 'logs') -Force | Out-Null
$hostScript = Join-Path $PSScriptRoot 'demo-host.mjs'
$arguments = @($hostScript, '--runtime', $RuntimeDirectory, '--npm-cli', [IO.Path]::GetFullPath($NpmCli),
  '--cloudflared', [IO.Path]::GetFullPath($Cloudflared), '--env-file', [IO.Path]::GetFullPath($EnvironmentFile))
# Windows paths cannot contain a quote. Quote each argument because Start-Process joins its list.
$quotedArguments = $arguments | ForEach-Object { '"' + $_ + '"' }
$hostProcess = Start-Process -FilePath ([IO.Path]::GetFullPath($NodeExecutable)) -ArgumentList $quotedArguments `
  -WorkingDirectory $RuntimeDirectory -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $RuntimeDirectory 'logs\host.stdout.log') `
  -RedirectStandardError (Join-Path $RuntimeDirectory 'logs\host.stderr.log')
Write-Output "Demo host starting (PID $($hostProcess.Id))."
Write-Output "Public URL and process ownership: $(Join-Path $RuntimeDirectory 'host.json')"
Write-Output "Build status: $(Join-Path $RuntimeDirectory 'status.json')"
Write-Output 'The first build runs in the background. Keep this computer powered on and connected.'
