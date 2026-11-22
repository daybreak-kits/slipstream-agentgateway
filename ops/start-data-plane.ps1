param(
  [string]$Config = "api/.data_store/ag-config/config.yaml",
  [string]$Binary = "agentgateway"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$configPath = if ([IO.Path]::IsPathRooted($Config)) { $Config } else { Join-Path $root $Config }
if (-not (Test-Path $configPath)) { throw "AG config not found: $configPath (apply a configuration from the admin console first)" }
Push-Location (Split-Path -Parent $configPath)
try {
  & $Binary -f (Split-Path -Leaf $configPath)
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
