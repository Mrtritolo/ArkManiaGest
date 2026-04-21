# ============================================
# ArkManiaGest - Full remote deploy (v3)
# Usage: powershell -ExecutionPolicy Bypass -File .\deploy\deploy-remote.ps1 [-Server root@IP]
# ============================================

param(
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
$ARCHIVE = "$env:TEMP\arkmaniagest-deploy.tar.gz"

# Shared exclusion list
$DEPLOYIGNORE = "$PROJECT\deploy\.deployignore"

# Force Windows tar (bsdtar) — Git's GNU tar in PATH cannot handle Windows paths.
$TAR = if (Test-Path "C:\Windows\System32\tar.exe") { "C:\Windows\System32\tar.exe" } else { "tar" }


Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  ArkManiaGest - Full Remote Deploy" -ForegroundColor Cyan
Write-Host "  Server: $SERVER" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# ---- STEP 1: Test SSH ----
Write-Host "`n[1/5] Test SSH..." -ForegroundColor Yellow
$test = ssh -o ConnectTimeout=10 $SERVER "echo OK" 2>&1
if ($test -ne "OK") {
    Write-Host "  ERROR: SSH unreachable" -ForegroundColor Red
    exit 1
}
Write-Host "  SSH OK" -ForegroundColor Green

# ---- STEP 2: Create archive ----
Write-Host "`n[2/5] Creazione archivio..." -ForegroundColor Yellow
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

# ---- STEP 3: Upload ----
Write-Host "`n[3/5] Upload su server..." -ForegroundColor Yellow
scp $ARCHIVE "${SERVER}:/tmp/arkmaniagest-deploy.tar.gz"
Write-Host "  Upload OK" -ForegroundColor Green

# ---- STEP 4: Start remote deploy in background ----
Write-Host "`n[4/5] Avvio deploy sul server (background)..." -ForegroundColor Yellow

ssh $SERVER @'
rm -rf /tmp/arkmaniagest-deploy /tmp/arkmaniagest-deploy-status
mkdir -p /tmp/arkmaniagest-deploy
tar -xzf /tmp/arkmaniagest-deploy.tar.gz -C /tmp/arkmaniagest-deploy
rm -f /tmp/arkmaniagest-deploy.tar.gz
# Strip Windows CRLF from all shell scripts (tar was created on Windows)
find /tmp/arkmaniagest-deploy/deploy -name "*.sh" -exec sed -i "s/\r//g" {} \;
chmod +x /tmp/arkmaniagest-deploy/deploy/full-deploy.sh
nohup bash /tmp/arkmaniagest-deploy/deploy/full-deploy.sh > /tmp/arkmaniagest-deploy.log 2>&1 &
echo "PID: $!"
echo "Deploy avviato in background"
'@

Write-Host "  Deploy in esecuzione sul server" -ForegroundColor Green
Write-Host "  (il processo continua anche se chiudi questa finestra)" -ForegroundColor DarkGray

# ---- STEP 5: Monitor progress ----
Write-Host "`n[5/5] Monitoraggio progresso..." -ForegroundColor Yellow
Write-Host "  (Ctrl+C per smettere di monitorare, il deploy continua)" -ForegroundColor DarkGray
Write-Host ""

$lastLine  = 0
$completed = $false
$maxWait   = 600
$elapsed   = 0

while (-not $completed -and $elapsed -lt $maxWait) {
    Start-Sleep -Seconds 5
    $elapsed += 5

    $status = ssh -o ConnectTimeout=5 $SERVER "cat /tmp/arkmaniagest-deploy-status 2>/dev/null" 2>$null
    if ($status -match "DEPLOY_COMPLETE") {
        $completed = $true
    }

    $newLines = ssh -o ConnectTimeout=5 $SERVER "tail -n +$($lastLine+1) /tmp/arkmaniagest-deploy.log 2>/dev/null | head -50" 2>$null
    if ($newLines) {
        $lines = $newLines -split "`n"
        foreach ($line in $lines) {
            if ($line -match "^=== FASE") {
                Write-Host $line -ForegroundColor Cyan
            } elseif ($line -match "ERRORE|FALLITO|errore") {
                Write-Host $line -ForegroundColor Red
            } elseif ($line -match "OK|ATTIVO|OTTENUTO|completato") {
                Write-Host $line -ForegroundColor Green
            } else {
                Write-Host $line
            }
        }
        $lastLine += $lines.Count
    }
}

Remove-Item -Force $ARCHIVE -ErrorAction SilentlyContinue

if ($completed) {
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "  Deploy completato!" -ForegroundColor Green
    Write-Host "  https://${DOMAIN}" -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  Timeout monitoraggio (il deploy potrebbe essere ancora in corso)" -ForegroundColor Yellow
    Write-Host "  Controlla manualmente:" -ForegroundColor Yellow
    Write-Host "    ssh $SERVER 'tail -30 /tmp/arkmaniagest-deploy.log'" -ForegroundColor DarkGray
    Write-Host "    ssh $SERVER 'cat /tmp/arkmaniagest-deploy-status'" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Comandi utili:" -ForegroundColor DarkGray
Write-Host "    ssh $SERVER 'cat /tmp/arkmaniagest-deploy.log'" -ForegroundColor DarkGray
Write-Host "    ssh $SERVER 'bash /opt/arkmaniagest/deploy/status.sh'" -ForegroundColor DarkGray
Write-Host ""
