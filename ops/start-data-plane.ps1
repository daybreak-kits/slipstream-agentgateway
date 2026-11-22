param(
  [string]$Config = "api/.data_store/ag-config/config.yaml",
  [string]$Binary = "agentgateway",
  [string]$CaBundle = "api/.venv/Lib/site-packages/certifi/cacert.pem",
  [switch]$CheckOnly
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$caPath = if ([IO.Path]::IsPathRooted($CaBundle)) { $CaBundle } else { Join-Path $root $CaBundle }
if (-not (Test-Path $caPath)) { throw "certifi CA bundle not found: $caPath; pass -CaBundle or set SSL_CERT_FILE manually" }

if ($CheckOnly) { Write-Output $caPath; exit 0 }

$configPath = if ([IO.Path]::IsPathRooted($Config)) { $Config } else { Join-Path $root $Config }
if (-not (Test-Path $configPath)) { throw "AG config not found: $configPath (apply a configuration from the admin console first)" }
$env:SSL_CERT_FILE = $caPath
Push-Location (Split-Path -Parent $configPath)
try {
  & $Binary -f (Split-Path -Leaf $configPath)
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
