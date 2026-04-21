# ============================================
# ArkManiaGest - Incremental remote update (v3)
# Usage:
#   .\deploy\update-remote.ps1
#   .\deploy\update-remote.ps1 -BackendOnly
#   .\deploy\update-remote.ps1 -FrontendOnly
#   .\deploy\update-remote.ps1 -WithDeps
#   .\deploy\update-remote.ps1 -NoDeps
# ============================================

param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$NoDeps,
    [switch]$WithDeps,
    [switch]$DryRun,
    [string]$Server,
    [string]$ProjectPath
)

# Read defaults from deploy.conf (bash-style key=value)
$CONF_PATH = Join-Path $PSScriptRoot "deploy.conf"
$confVars  = @{}
if (Test-Path $CONF_PATH) {
    Get-Content $CONF_PATH | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$' -and $_ -notmatch '^\s*#') {
            $confVars[$Matches[1]] = $Matches[2]
        }
    }
}

$SERVER  = if ($Server)      { $Server }      elseif ($confVars["DEPLOY_SERVER"]) { $confVars["DEPLOY_SERVER"] } else { "root@YOUR_SERVER_IP" }
$PROJECT = if ($ProjectPath) { $ProjectPath } else { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$DOMAIN  = if ($confVars["DOMAIN"]) { $confVars["DOMAIN"] } else { "localhost" }
$ARCHIVE = "$env:TEMP\arkmaniagest-update.tar.gz"

# Shared exclusion list
$DEPLOYIGNORE = "$PROJECT\deploy\.deployignore"

# Force Windows tar (bsdtar) — Git's GNU tar in PATH cannot handle Windows paths.
$TAR = if (Test-Path "C:\Windows\System32\tar.exe") { "C:\Windows\System32\tar.exe" } else { "tar" }



$startTime = Get-Date

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  ArkManiaGest - Production Update" -ForegroundColor Cyan
Write-Host "  Server: $SERVER" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
if ($BackendOnly)  { Write-Host "  Mode: BACKEND ONLY" -ForegroundColor Magenta }
if ($FrontendOnly) { Write-Host "  Mode: FRONTEND ONLY" -ForegroundColor Magenta }
if ($NoDeps)       { Write-Host "  Dependencies: SKIP" -ForegroundColor Magenta }
if ($WithDeps)     { Write-Host "  Dependencies: FORCED" -ForegroundColor Magenta }
Write-Host "================================================" -ForegroundColor Cyan

# ---- STEP 1: Test SSH ----
Write-Host "`n[1/6] Test SSH..." -ForegroundColor Yellow
$testSSH = ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new $SERVER "echo OK" 2>&1
if (($testSSH -join "`n").Trim() -notmatch "OK") {
    Write-Host "  ERRORE: SSH non raggiungibile" -ForegroundColor Red
    Write-Host "  Output: $testSSH" -ForegroundColor DarkGray
    exit 1
}
Write-Host "  SSH OK" -ForegroundColor Green

# ---- STEP 2: Verify .env on server ----
Write-Host "`n[2/6] Verifica .env sul server..." -ForegroundColor Yellow
if (-not $DryRun) {
    $envCheck = ssh $SERVER '[ -f /opt/arkmaniagest/backend/.env ] && echo ENV_OK || echo NO_ENV'
    if (($envCheck -join "`n").Trim() -match "NO_ENV") {
        Write-Host "  ATTENZIONE: .env non trovato sul server!" -ForegroundColor Red
        Write-Host "  Copia il .env prima del deploy:" -ForegroundColor Yellow
        Write-Host "  scp backend\.env ${SERVER}:/opt/arkmaniagest/backend/.env" -ForegroundColor White
        $continue = Read-Host "  Vuoi continuare comunque? (s/N)"
        if ($continue -ne 's') { exit 1 }
    } else {
        Write-Host "  .env presente" -ForegroundColor Green
    }
}

# ---- STEP 3: Create archive ----
Write-Host "`n[3/6] Creazione archivio..." -ForegroundColor Yellow
Push-Location $PROJECT

if (Test-Path $DEPLOYIGNORE) {
    & $TAR -czf $ARCHIVE --exclude-from="$DEPLOYIGNORE" .
} else {
    Write-Host "  WARNING: .deployignore not found, using inline exclusions" -ForegroundColor Yellow
    & $TAR -czf $ARCHIVE `
        --exclude=node_modules --exclude=venv --exclude=__pycache__ --exclude=.git `
        --exclude="data/arkmaniagest.vault" --exclude="*.vault" --exclude=".env" `
        --exclude="frontend/dist" --exclude="Specifiche" --exclude="_deprecated" `
        --exclude="config" --exclude="tests" --exclude="reference" `
        --exclude="*.ps1" --exclude="*.bat" --exclude="*.vbs" `
        --exclude="CHANGELOG.md" --exclude="README.md" `
        .
}

Pop-Location

if (-not (Test-Path $ARCHIVE)) {
    Write-Host "  ERRORE: tar fallito" -ForegroundColor Red
    exit 1
}
$sizeMB = [math]::Round((Get-Item $ARCHIVE).Length / 1MB, 1)
Write-Host "  Archivio: $sizeMB MB" -ForegroundColor Green

if ($DryRun) {
    Write-Host "`n  DRY-RUN completato." -ForegroundColor Yellow
    Remove-Item -Force $ARCHIVE -ErrorAction SilentlyContinue
    exit 0
}

# ---- STEP 4: Upload ----
Write-Host "`n[4/6] Upload..." -ForegroundColor Yellow
scp -q $ARCHIVE "${SERVER}:/tmp/arkmaniagest-update.tar.gz"
Write-Host "  Upload OK" -ForegroundColor Green

# ---- STEP 5: Execute remote update ----
Write-Host "`n[5/6] Esecuzione update remoto..." -ForegroundColor Yellow

$modeFlag = "FULL"
if ($BackendOnly)  { $modeFlag = "BACKEND" }
if ($FrontendOnly) { $modeFlag = "FRONTEND" }

$depsFlag = "AUTO"
if ($NoDeps)  { $depsFlag = "SKIP" }
if ($WithDeps){ $depsFlag = "FORCE" }

# Convert the bash script to Unix line endings (LF) and strip the UTF-8 BOM
# before upload.  On Windows:
#   - every .sh has CRLF line endings  -> bash "invalid option" errors
#   - Set-Content -Encoding utf8 prepends a BOM  -> "#!/usr/bin/env: not found"
# Solution: write with UTF8Encoding($false) (no BOM) via .NET directly.
$scriptUnix = "$env:TEMP\server-update-unix.sh"
$content    = (Get-Content "$PROJECT\deploy\server-update.sh" -Raw) -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($scriptUnix, $content, [System.Text.UTF8Encoding]::new($false))
scp -q $scriptUnix "${SERVER}:/tmp/server-update.sh"
Remove-Item -Force $scriptUnix -ErrorAction SilentlyContinue
ssh $SERVER "chmod +x /tmp/server-update.sh && bash /tmp/server-update.sh $modeFlag $depsFlag && rm -f /tmp/server-update.sh"

# ---- STEP 6: Verify ----
Write-Host "`n[6/6] Verifica finale..." -ForegroundColor Yellow

$health = ssh $SERVER "curl -sf http://127.0.0.1:8000/health 2>/dev/null"
if ($health) {
    Write-Host "  Health: OK" -ForegroundColor Green
    try {
        $h = $health | ConvertFrom-Json
        Write-Host "  Versione: $($h.version)  DB: $($h.db_ready)  PID: $($h.pid)" -ForegroundColor Green
    } catch {}
} else {
    Write-Host "  Health: FALLITO" -ForegroundColor Red
}

Remove-Item -Force $ARCHIVE -ErrorAction SilentlyContinue

$elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Update completato in ${elapsed}s" -ForegroundColor Green
Write-Host "  https://${DOMAIN}" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
