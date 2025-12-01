Param(
    [switch]$NoBackup,
    [string]$OutFile = ".\backfill_apply_output.txt"
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

if (-not $NoBackup) {
    $timestamp = Get-Date -Format yyyyMMdd-HHmmss
    $outdir = Join-Path (Get-Location) ("db-backups\dump-$timestamp")
    New-Item -ItemType Directory -Force -Path $outdir | Out-Null
    Write-Host "Creating mongodump backup to: $outdir"
    try {
        & mongodump --uri="$env:MONGODB_URI" --out "$outdir"
        Write-Host "Backup finished"
    } catch {
        Write-Warning "mongodump failed or not found: $_"
        Write-Warning "Proceeding only if you understand the risk."
    }
} else {
    Write-Host "Skipping backup (NoBackup specified)"
}

$confirm = Read-Host "Type 'YES' to confirm running the backfill with --apply"
if ($confirm -ne 'YES') {
    Write-Host "Aborted by user"
    exit 0
}

Write-Host "Running backfill with --apply. Output -> $OutFile"
node .\scripts\mongo\backfill_normalize_collections.js --apply > $OutFile 2>&1
Write-Host "Apply finished. Inspect $OutFile"
