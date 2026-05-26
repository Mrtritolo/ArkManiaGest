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
if (-not (Test-Path $CONF_PATH)) {
    $CONF_PATH = Join-Path $PSScriptRoot "deploy.conf.example"
    if (Test-Path $CONF_PATH) {
        Write-Host "  WARNING: using deploy.conf.example (template). Copy it to deploy/deploy.conf with real values." -ForegroundColor Yellow
    }
}
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

# Force Windows tar (bsdtar) -- Git's GNU tar in PATH cannot handle Windows paths.
$TAR = if (Test-Path "C:\Windows\System32\tar.exe") { "C:\Windows\System32\tar.exe" } else { "tar" }

# ---- SSH options (key-based auth aware) ----
# When deploy.conf sets SSH_KEY_PATH, pass `-i <key>` + IdentitiesOnly=yes
# on every ssh / scp call (otherwise OpenSSH may try ~/.ssh/id_* in addition
# and trigger MaxAuthTries before reaching the configured key).  BatchMode
# turns a key failure into a hard exit instead of a silent password prompt
# that would hang the script.  StrictHostKeyChecking=accept-new is applied
# on every call (not just the first probe) so an out-of-band reinstall of
# the host doesn't pop an interactive yes/no question mid-update.
$SSH_KEY  = if ($confVars["SSH_KEY_PATH"]) { $confVars["SSH_KEY_PATH"].Trim() } else { "" }
$SSH_PORT = if ($confVars["SSH_PORT"])     { $confVars["SSH_PORT"] }            else { "22" }
$sshCommonArgs = @(
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=30",
    "-p", "$SSH_PORT"
)
$scpCommonArgs = @(
    "-o", "StrictHostKeyChecking=accept-new",
    "-P", "$SSH_PORT"
)
if ($SSH_KEY) {
    if (-not (Test-Path $SSH_KEY)) {
        Write-Host "  ERRORE: SSH_KEY_PATH='$SSH_KEY' (from deploy.conf) non esiste." -ForegroundColor Red
        exit 1
    }
    Write-Host "  Using SSH key: $SSH_KEY" -ForegroundColor DarkGray
    $sshCommonArgs += @("-o","BatchMode=yes","-o","IdentitiesOnly=yes","-i",$SSH_KEY)
    $scpCommonArgs += @("-o","BatchMode=yes","-o","IdentitiesOnly=yes","-i",$SSH_KEY)
}



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
# Use $LASTEXITCODE rather than scraping stdout: MOTD / SSH banner output
# from a fresh login can include the literal word "OK" and falsely pass the
# previous string-match test, and a remote `echo OK` printed AFTER ssh has
# already failed (e.g. AuthenticationFailed) would never reach us anyway.
Write-Host "`n[1/6] Test SSH..." -ForegroundColor Yellow
& ssh.exe @sshCommonArgs $SERVER "echo ArkManiaGest-RemoteUpdate-OK" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERRORE: SSH non raggiungibile (rc=$LASTEXITCODE)" -ForegroundColor Red
    Write-Host "  Verifica chiave / agente / sudoers, poi rilancia." -ForegroundColor DarkGray
    exit 1
}
Write-Host "  SSH OK" -ForegroundColor Green

# ---- STEP 2: Verify .env on server ----
Write-Host "`n[2/6] Verifica .env sul server..." -ForegroundColor Yellow
if (-not $DryRun) {
    & ssh.exe @sshCommonArgs $SERVER "test -f /opt/arkmaniagest/backend/.env" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
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
& scp.exe @scpCommonArgs -q $ARCHIVE "${SERVER}:/tmp/arkmaniagest-update.tar.gz"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERRORE: scp fallito (rc=$LASTEXITCODE)" -ForegroundColor Red
    exit 1
}
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
& scp.exe @scpCommonArgs -q $scriptUnix "${SERVER}:/tmp/server-update.sh"
Remove-Item -Force $scriptUnix -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERRORE: scp server-update.sh fallito (rc=$LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

# $modeFlag / $depsFlag are constrained by this script to the literal set
# {FULL,BACKEND,FRONTEND} / {AUTO,FORCE,SKIP}, so the interpolation here is
# bounded.  We still wrap them in shell single-quotes server-side as a
# belt-and-suspenders guard in case this script is ever extended to accept
# operator-supplied values.
$remoteCmd = "chmod +x /tmp/server-update.sh && bash /tmp/server-update.sh '$modeFlag' '$depsFlag' && rm -f /tmp/server-update.sh"
& ssh.exe @sshCommonArgs $SERVER $remoteCmd
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERRORE: update remoto fallito (rc=$LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

# ---- STEP 6: Verify ----
Write-Host "`n[6/6] Verifica finale..." -ForegroundColor Yellow

$health = & ssh.exe @sshCommonArgs $SERVER "curl -sf http://127.0.0.1:8000/health 2>/dev/null"
if ($LASTEXITCODE -eq 0 -and $health) {
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
