Param(
    [string]$Name,
    [string]$Id
)

# Load MONGODB_URI from .env (if present) and set environment variable
$envFile = Join-Path (Get-Location) ".env"
if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*MONGODB_URI\s*=' } | Select-Object -First 1
    if ($line) {
        $val = $line -replace '^\s*MONGODB_URI\s*=',''
        $val = $val.Trim(" `"' ")
        $env:MONGODB_URI = $val
        Write-Host "Using MONGODB_URI from .env"
    } else {
        Write-Warning ".env found but MONGODB_URI not set"
    }
} else {
    Write-Warning ".env not found in repository root. You can set `$env:MONGODB_URI` manually before running this script."
}

if (-not $Name -and -not $Id) {
    Write-Host "Usage: .\scripts\run_find_agent_clients.ps1 -Name 'Alejandra Melara'`n       .\scripts\run_find_agent_clients.ps1 -Id '<ownerId>'"
    exit 2
}

$args = @()
if ($Name) { $args += "--name"; $args += $Name }
if ($Id) { $args += "--id"; $args += $Id }

Write-Host "Running diagnostic for agent..."
node .\scripts\mongo\find_agent_clients.js $args
