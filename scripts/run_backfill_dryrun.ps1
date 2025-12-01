Param(
    [string]$OutFile = ".\backfill_dryrun_output.txt"
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

Write-Host "Running backfill (dry-run). Output -> $OutFile"
node .\scripts\mongo\backfill_normalize_collections.js > $OutFile 2>&1
Write-Host "Dry-run finished. Inspect $OutFile"
