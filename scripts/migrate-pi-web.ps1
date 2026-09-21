# Migrate pi-web: rebuild -> swap the running binary -> restart -> verify.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\migrate-pi-web.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\migrate-pi-web.ps1 -NoBuild   # reuse existing pi-web.exe
#
# Safe to re-run: it backs up the installed binary first and rolls back if the
# new one fails to come up.

[CmdletBinding()]
param(
    # Skip the frontend+go build and reuse the pi-web.exe already in the repo root.
    [switch]$NoBuild,
    # Port the server listens on (used only for the post-start health check).
    [string]$Port = '31415'
)

$ErrorActionPreference = 'Stop'
$repoRoot   = Split-Path -Parent $PSScriptRoot
$srcExe     = Join-Path $repoRoot 'pi-web.exe'
$installDir = Join-Path $env:USERPROFILE '.pi\agent\bin'
$destExe    = Join-Path $installDir 'pi-web.exe'
$backupExe  = "$destExe.bak"
$startScript = Join-Path $env:USERPROFILE '.config\pi-web\pi-web-start.ps1'
$startVbs    = Join-Path $env:USERPROFILE '.config\pi-web\pi-web-start.vbs'

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# Go is not always on PATH in a fresh shell; add the standard location.
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    $goBin = 'C:\Program Files\Go\bin'
    if (Test-Path $goBin) { $env:Path = "$goBin;$env:Path" }
}

# ── 1. Build (optional) ────────────────────────────────────────────────
if (-not $NoBuild) {
    Write-Step 'Building frontend + pi-web.exe'
    Push-Location (Join-Path $repoRoot 'web')
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
    } finally { Pop-Location }

    # npm's build script ends with `cp` which doesn't exist on Windows.
    $exportSrc = Join-Path $repoRoot 'web\dist-export\export.js'
    $exportDst = Join-Path $repoRoot 'internal\ui\embedded\export\export.js'
    Copy-Item $exportSrc $exportDst -Force

    Push-Location $repoRoot
    try {
        $version = (git describe --tags --always --dirty 2>$null)
        if (-not $version) { $version = 'dev' }
        go build -ldflags="-s -w -X main.version=$version" -o pi-web.exe ./cmd/pi-web
        if ($LASTEXITCODE -ne 0) { throw 'go build failed' }
    } finally { Pop-Location }
}

if (-not (Test-Path $srcExe)) { throw "pi-web.exe not found at $srcExe. Run without -NoBuild." }

# ── 2. Stop the running instance ───────────────────────────────────────
Write-Step 'Stopping running pi-web'
$running = Get-Process pi-web -ErrorAction SilentlyContinue
if ($running) {
    $running | Stop-Process -Force
    Start-Sleep -Seconds 1
    Write-Host "Stopped pid(s): $($running.Id -join ', ')"
} else {
    Write-Host 'No running pi-web process.'
}

# ── 3. Back up current install, then copy the new binary ───────────────
Write-Step 'Installing new binary'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
if (Test-Path $destExe) {
    Copy-Item $destExe $backupExe -Force
    Write-Host "Backed up existing binary -> $backupExe"
}
Copy-Item $srcExe $destExe -Force
Write-Host "Copied $srcExe -> $destExe"

# ── 4. Start detached so the server survives this script's console ─────
# `Start-Process -WindowStyle Hidden` still creates pi-web as a *child* of this
# script's console; when that console/job object closes, the server can be
# killed with it. The app itself solves this the same way its in-app restart
# does (internal/app/update_windows.go): launch the hidden VBScript launcher
# via `wscript.exe`, which spawns a fully detached process that outlives us.
function Start-PiWebDetached {
    if (Test-Path $startVbs) {
        # pi-web-start.vbs -> runs pi-web-start.ps1 hidden -> loads env + starts
        # the exe. wscript returns immediately and the child is independent.
        Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$startVbs`""
    } elseif (Test-Path $startScript) {
        # No vbs launcher: detach via cmd so the ps1 (and its env) still run
        # without tying pi-web to this console's lifetime.
        Start-Process -FilePath 'cmd.exe' `
            -ArgumentList '/c','start','"pi-web"','/min','powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$startScript`"" `
            -WindowStyle Hidden
    } else {
        Write-Warning 'No start script/launcher found; launching binary directly.'
        Start-Process -FilePath 'cmd.exe' `
            -ArgumentList '/c','start','"pi-web"','/b',"`"$destExe`"" `
            -WindowStyle Hidden
    }
}

Write-Step 'Starting pi-web (detached)'
Start-PiWebDetached
Start-Sleep -Seconds 3

# ── 5. Verify ──────────────────────────────────────────────────────────
Write-Step 'Verifying'
$proc = Get-Process pi-web -ErrorAction SilentlyContinue
$healthy = $false
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/manifest.webmanifest" `
        -UseBasicParsing -TimeoutSec 5
    $healthy = ($resp.StatusCode -eq 200)
} catch { $healthy = $false }

if ($proc -and $healthy) {
    Write-Host "pi-web running (pid $($proc.Id -join ', ')) and responding on :$Port" -ForegroundColor Green
    & $destExe -version 2>$null | ForEach-Object { Write-Host "version: $_" }
    exit 0
}

# Roll back on failure.
Write-Warning 'New binary did not come up cleanly.'
if (Test-Path $backupExe) {
    Write-Host 'Rolling back to previous binary...'
    Get-Process pi-web -ErrorAction SilentlyContinue | Stop-Process -Force
    Copy-Item $backupExe $destExe -Force
    Start-PiWebDetached
    Start-Sleep -Seconds 2
    if (Get-Process pi-web -ErrorAction SilentlyContinue) {
        Write-Host 'Rolled back; previous version is running.' -ForegroundColor Yellow
    }
}
exit 1
