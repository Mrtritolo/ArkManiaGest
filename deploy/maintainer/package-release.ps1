# =============================================================================
# ArkManiaGest -- Release packager
# =============================================================================
# Builds a self-contained release bundle that can be attached to a GitHub
# Release.  Produces two artefacts:
#
#   arkmaniagest-v<VER>-linux.tar.gz   -- deploy this on a Linux host
#                                        (use deploy/full-deploy.sh or
#                                         deploy/server-update.sh)
#
#   arkmaniagest-v<VER>-windows.zip    -- deploy from a Windows dev PC
#                                        (use deploy/deploy-remote.ps1)
#
# Usage:
#   .\deploy\package-release.ps1                        # auto-detect version
#   .\deploy\package-release.ps1 -Version 2.3.0         # explicit version
#   .\deploy\package-release.ps1 -Publish               # run gh release create
#   .\deploy\package-release.ps1 -Notes "See CHANGELOG" # custom release body
#
# Output lands in   release-build/<VERSION>/
# =============================================================================

param(
    [string]$Version = "",
    [string]$Notes = "",
    [switch]$Publish,
    [switch]$PreRelease,
    [switch]$KeepIntermediate
)

$ErrorActionPreference = "Stop"

# ── Resolve paths ────────────────────────────────────────────────────────────

$PROJECT   = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OUT_ROOT  = Join-Path $PROJECT "release-build"
$TAR       = if (Test-Path "C:\Windows\System32\tar.exe") { "C:\Windows\System32\tar.exe" } else { "tar" }

# ── Detect version ───────────────────────────────────────────────────────────

function Get-VersionFromBackend {
    $mainPy = Join-Path $PROJECT "backend\app\main.py"
    if (-not (Test-Path $mainPy)) { return $null }
    $m = Select-String -Path $mainPy -Pattern 'version="([^"]+)"' | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value }
    return $null
}

function Get-VersionFromPackageJson {
    $pkg = Join-Path $PROJECT "frontend\package.json"
    if (-not (Test-Path $pkg)) { return $null }
    $json = Get-Content $pkg -Raw | ConvertFrom-Json
    return $json.version
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    $vBackend = Get-VersionFromBackend
    $vFront   = Get-VersionFromPackageJson
    if (-not $vBackend -or -not $vFront) {
        Write-Host "ERROR: cannot detect version (missing backend/app/main.py or frontend/package.json)" -ForegroundColor Red
        exit 1
    }
    if ($vBackend -ne $vFront) {
        Write-Host "WARNING: backend version ($vBackend) and frontend version ($vFront) disagree." -ForegroundColor Yellow
        Write-Host "         Using backend version. Pass -Version explicitly to override." -ForegroundColor Yellow
    }
    $Version = $vBackend
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  ArkManiaGest release packager" -ForegroundColor Cyan
Write-Host "  Version: v$Version" -ForegroundColor Cyan
Write-Host "  Project: $PROJECT" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# ── Collect build metadata ───────────────────────────────────────────────────

$gitHash = (git -C $PROJECT rev-parse HEAD 2>$null).Trim()
if (-not $gitHash) { $gitHash = "unknown" }
$gitBranch = (git -C $PROJECT rev-parse --abbrev-ref HEAD 2>$null).Trim()
$gitDirty  = (git -C $PROJECT status --porcelain 2>$null | Measure-Object -Line).Lines -gt 0
$buildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

Write-Host "`n[1/6] Checking workspace..." -ForegroundColor Yellow
Write-Host "  commit : $gitHash ($gitBranch$(if ($gitDirty) { ' -- DIRTY' }))" -ForegroundColor Gray
Write-Host "  build  : $buildTime" -ForegroundColor Gray
if ($gitDirty) {
    Write-Host "  WARNING: working tree has uncommitted changes." -ForegroundColor Yellow
}

# ── Stage build tree ─────────────────────────────────────────────────────────

$STAGE = Join-Path $OUT_ROOT "v$Version\arkmaniagest-v$Version"
if (Test-Path $STAGE) {
    Write-Host "`n[2/6] Cleaning previous stage..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $STAGE
}
New-Item -ItemType Directory -Force -Path $STAGE | Out-Null

Write-Host "`n[2/6] Staging files..." -ForegroundColor Yellow

# rsync via tar pipeline so we can reuse .deployignore exclusions
$DEPLOYIGNORE = Join-Path $PROJECT "deploy\.deployignore"
Push-Location $PROJECT
try {
    if (Test-Path $DEPLOYIGNORE) {
        # The PowerShell artefact keeps the .ps1/.bat scripts (they run on the
        # dev PC), so we use a DEDICATED exclusion list that subtracts those
        # "Windows-only" lines from .deployignore.
        $excludesLinux   = Get-Content $DEPLOYIGNORE |
            Where-Object { $_ -and $_ -notmatch '^\s*#' }
        $excludesWindows = $excludesLinux |
            Where-Object { $_ -notmatch '\.(ps1|bat|vbs)' }

        # Stage Windows artefact (superset -- includes .ps1 helpers)
        $tmpWin = Join-Path $env:TEMP "aam-release-win-ex.txt"
        $excludesWindows | Out-File -Encoding ascii -FilePath $tmpWin
        & $TAR -cf - --exclude-from="$tmpWin" . | & $TAR -xf - -C "$STAGE"
        Remove-Item -Force $tmpWin
    } else {
        Write-Host "  WARNING: .deployignore missing, falling back to basic excludes" -ForegroundColor Yellow
        & $TAR -cf - `
            --exclude='node_modules' --exclude='venv' --exclude='__pycache__' `
            --exclude='.git' --exclude='data/' --exclude='*.vault' --exclude='.env' `
            --exclude='reference' --exclude='release-build' . | & $TAR -xf - -C "$STAGE"
    }
} finally {
    Pop-Location
}

# ── Build frontend ───────────────────────────────────────────────────────────

Write-Host "`n[3/6] Building frontend..." -ForegroundColor Yellow
Push-Location (Join-Path $STAGE "frontend")
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "  npm ci..." -ForegroundColor Gray
        npm ci --silent 2>&1 | Select-Object -Last 3
    }
    Write-Host "  vite build..." -ForegroundColor Gray
    $env:NODE_OPTIONS = "--max-old-space-size=1536"
    npm run build 2>&1 | Select-Object -Last 3
    if (-not (Test-Path "dist\index.html")) {
        Write-Host "  ERROR: frontend build did not produce dist/index.html" -ForegroundColor Red
        exit 1
    }
    $distSize = (Get-ChildItem dist -Recurse -File | Measure-Object Length -Sum).Sum
    Write-Host "  dist size: $([math]::Round($distSize / 1MB, 2)) MB" -ForegroundColor Gray
    # Keep node_modules out of the release bundle
    Remove-Item -Recurse -Force "node_modules"
} finally {
    Pop-Location
}

# ── Write VERSION manifest ───────────────────────────────────────────────────

Write-Host "`n[4/6] Writing VERSION manifest..." -ForegroundColor Yellow
$versionManifest = @{
    version    = $Version
    commit     = $gitHash
    branch     = $gitBranch
    dirty      = [bool]$gitDirty
    built_at   = $buildTime
    pre_release = [bool]$PreRelease
} | ConvertTo-Json
$versionManifest | Out-File -Encoding utf8 -FilePath (Join-Path $STAGE "VERSION.json")

# ── Create artefacts ─────────────────────────────────────────────────────────

Write-Host "`n[5/6] Creating artefacts..." -ForegroundColor Yellow

$ARTIFACT_DIR = Join-Path $OUT_ROOT "v$Version"
$LINUX_NAME   = "arkmaniagest-v$Version-linux.tar.gz"
$WIN_NAME     = "arkmaniagest-v$Version-windows.zip"

Push-Location (Join-Path $ARTIFACT_DIR "..") | Out-Null
Push-Location $ARTIFACT_DIR
try {
    # Linux bundle -- strip the .ps1/.bat/.vbs files (not needed on Linux servers)
    $LINUX_STAGE = Join-Path (Split-Path $STAGE -Parent) "arkmaniagest-v$Version-linux"
    Copy-Item -Recurse -Force $STAGE $LINUX_STAGE
    Get-ChildItem -Path $LINUX_STAGE -Recurse -Include *.ps1,*.bat,*.vbs |
        Remove-Item -Force
    Push-Location (Split-Path $LINUX_STAGE -Parent)
    & $TAR -czf $LINUX_NAME (Split-Path $LINUX_STAGE -Leaf)
    Pop-Location
    Move-Item -Force (Join-Path (Split-Path $LINUX_STAGE -Parent) $LINUX_NAME) $LINUX_NAME
    Remove-Item -Recurse -Force $LINUX_STAGE
    Write-Host "  Linux : $LINUX_NAME ($([math]::Round((Get-Item $LINUX_NAME).Length / 1MB, 2)) MB)" -ForegroundColor Green

    # Windows bundle -- full tree with .ps1 scripts
    if (Test-Path $WIN_NAME) { Remove-Item -Force $WIN_NAME }
    Compress-Archive -Path (Join-Path (Split-Path $STAGE -Parent) "arkmaniagest-v$Version") `
                     -DestinationPath $WIN_NAME -CompressionLevel Optimal
    Write-Host "  Windows: $WIN_NAME ($([math]::Round((Get-Item $WIN_NAME).Length / 1MB, 2)) MB)" -ForegroundColor Green

    # SHA256 checksums
    $SHA256 = Join-Path $ARTIFACT_DIR "SHA256SUMS.txt"
    "" | Out-File -Encoding ascii -FilePath $SHA256
    foreach ($file in @($LINUX_NAME, $WIN_NAME)) {
        $h = Get-FileHash -Path $file -Algorithm SHA256
        "$($h.Hash.ToLower())  $file" | Add-Content $SHA256
    }
    Write-Host "  SHA256SUMS.txt" -ForegroundColor Green
    Get-Content $SHA256 | Write-Host -ForegroundColor Gray
} finally {
    Pop-Location
    Pop-Location
}

# Optionally remove the staged copy now that we have the two artefacts.
if (-not $KeepIntermediate) {
    Remove-Item -Recurse -Force $STAGE
}

# ── Release notes (markdown snippet) ─────────────────────────────────────────

Write-Host "`n[6/6] Generating release notes snippet..." -ForegroundColor Yellow
$notesFile = Join-Path $ARTIFACT_DIR "RELEASE_NOTES.md"
$defaultNotes = @"
## ArkManiaGest v$Version

> Commit: ``$gitHash``
> Built:  $buildTime (UTC)

### Downloads

| Platform | File | Deploy command |
|----------|------|----------------|
| Linux server | ``$LINUX_NAME`` | ``tar -xzf $LINUX_NAME && cd arkmaniagest-v$Version && sudo bash deploy/full-deploy.sh`` |
| Windows dev PC | ``$WIN_NAME`` | Unzip then run ``deploy\deploy-remote.ps1`` |

Checksums are published in ``SHA256SUMS.txt``.

### What's changed

$(if ($Notes) { $Notes } else { "See [CHANGELOG.md](CHANGELOG.md) for the full list of changes." })

### Upgrade

1. Take a backup: ``sudo bash deploy/backup.sh`` on the server, or copy ``backend/.env``.
2. Replace the ``backend/`` and ``frontend/`` trees with the ones inside the tarball.
3. Run ``deploy/migrate-env.sh`` to backfill any new ``.env`` keys (idempotent).
4. Restart: ``sudo systemctl restart arkmaniagest``.

### License

ArkManiaGest is released under the [ArkManiaGest Source-Available License v1.0](LICENSE).
Commercial use is prohibited; deployment requires written authorisation from
Lomatek / ArkMania.it (info@arkmania.it).
"@
$defaultNotes | Out-File -Encoding utf8 -FilePath $notesFile
Write-Host "  RELEASE_NOTES.md" -ForegroundColor Green

# ── Publish (optional) ───────────────────────────────────────────────────────

if ($Publish) {
    Write-Host "`n[bonus] Publishing to GitHub..." -ForegroundColor Yellow
    $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $ghCmd) {
        Write-Host "  ERROR: gh CLI not found in PATH -- install https://cli.github.com/ or publish manually." -ForegroundColor Red
    } else {
        $tag = "v$Version"
        $flags = @("--title", "ArkManiaGest $tag", "--notes-file", $notesFile)
        if ($PreRelease) { $flags += "--prerelease" }
        Push-Location $ARTIFACT_DIR
        try {
            gh release create $tag $LINUX_NAME $WIN_NAME "SHA256SUMS.txt" @flags
            Write-Host "  Release $tag published." -ForegroundColor Green
        } catch {
            Write-Host "  ERROR: gh release create failed: $_" -ForegroundColor Red
        } finally {
            Pop-Location
        }
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Done." -ForegroundColor Green
Write-Host "  Artefacts: $ARTIFACT_DIR" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
