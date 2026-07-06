#requires -version 5.1
# =============================================================================
# ArkManiaGest -- Interactive dev-side update
# =============================================================================
# Like install-panel.ps1, but for a panel that is ALREADY installed.  Pushes
# the working-tree code (no GitHub release needed) to a remote panel host and
# runs server-update.sh to apply it in place.
#
# Flow:
#   1. Ask for target host / SSH user / port (or read them from deploy.conf).
#   2. Probe SSH (default keys / agent first; explicit key / password fallback).
#   3. Check that /opt/arkmaniagest/backend/.env exists on the target
#      (otherwise we're not updating, we're reinstalling).
#   4. Package the current project into a tarball (same .deployignore).
#   5. Upload the tarball + server-update.sh to /tmp.
#   6. Run server-update.sh FULL on the target (streams remote output).
#   7. Poll /health until the new version answers.
#
# Usage:
#   .\deploy\update-panel.ps1                        # fully interactive
#   .\deploy\update-panel.ps1 -Server user@host      # skip the host prompt
#   .\deploy\update-panel.ps1 -BackendOnly           # only push + restart backend
#   .\deploy\update-panel.ps1 -FrontendOnly          # only push + rebuild UI
#   .\deploy\update-panel.ps1 -NoDeps                # skip pip/npm install
#   .\deploy\update-panel.ps1 -DryRun                # report, no upload/run
# =============================================================================

[CmdletBinding()]
param(
    [string]$Server = "",
    [int]$Port = 0,
    [string]$SshUser = "",
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$NoDeps,
    [switch]$WithDeps,
    [switch]$DryRun
)

# ---------------------------------------------------------------------------
# Paths + helpers
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Continue'   # stderr from native tools is NOT fatal

$PROJECT = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ARCHIVE = Join-Path $env:TEMP "arkmaniagest-update.tar.gz"
$DEPLOYIGNORE = Join-Path $PROJECT "deploy\.deployignore"
$TAR = if (Test-Path "C:\Windows\System32\tar.exe") { "C:\Windows\System32\tar.exe" } else { "tar" }

function Section([string]$text) {
    Write-Host ""
    $bar = "-" * [Math]::Max(0, 70 - $text.Length)
    Write-Host "-- $text $bar" -ForegroundColor Cyan
}
function OK([string]$text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Info([string]$text) { Write-Host "  $text" -ForegroundColor Gray }
function Warn([string]$text) { Write-Host "  WARNING: $text" -ForegroundColor Yellow }
function Fail([string]$msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }

# Run ssh without having $ErrorActionPreference='Stop' turn stderr into a
# terminating error.  Native-command stderr stays on its own stream; the
# exit code is returned via $LASTEXITCODE.
function Invoke-SSH([string[]]$SshArgs) {
    & ssh.exe @SshArgs | Out-Host
    return $LASTEXITCODE
}
function Invoke-SSH-Quiet([string[]]$SshArgs) {
    & ssh.exe @SshArgs 2>&1 | Out-Null
    return $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# Load defaults from deploy/deploy.conf (if present)
# ---------------------------------------------------------------------------

$conf = @{}
$confPath = Join-Path $PROJECT "deploy\deploy.conf"
if (Test-Path $confPath) {
    Get-Content $confPath | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$' -and $_ -notmatch '^\s*#') {
            $conf[$Matches[1]] = $Matches[2]
        }
    }
}

Section "ArkManiaGest -- Dev update"
Info "Project: $PROJECT"

# ---------------------------------------------------------------------------
# 1. Target prompts
# ---------------------------------------------------------------------------

Section "Target panel host"

if (-not $Server) {
    $default = if ($conf["DEPLOY_SERVER"]) { $conf["DEPLOY_SERVER"] } else { "" }
    $ans = Read-Host "Server address (IP or hostname)$(if ($default) { " [$default]" })"
    if (-not $ans) { $ans = $default }
    $Server = $ans
}
if (-not $Server) { Fail "Server address is required." }

# Split user@host if the operator pasted that form.
if ($Server -match '^(.+)@(.+)$') {
    if (-not $SshUser) { $SshUser = $Matches[1] }
    $Server = $Matches[2]
}

if (-not $SshUser) {
    $default = if ($conf["SSH_USER"]) { $conf["SSH_USER"] } else { "root" }
    $ans = Read-Host "SSH user [$default]"
    if (-not $ans) { $ans = $default }
    $SshUser = $ans
}

if (-not $Port -or $Port -le 0) {
    $default = if ($conf["SSH_PORT"]) { [int]$conf["SSH_PORT"] } else { 22 }
    $ans = Read-Host "SSH port [$default]"
    if (-not $ans) { $Port = $default } else { $Port = [int]$ans }
}

# When the operator has a dedicated key for this host, pass `-i $key`
# everywhere PLUS `IdentitiesOnly=yes` so OpenSSH does NOT try every
# ~/.ssh/id_* in addition (which on hosts with a tight MaxAuthTries causes
# spurious lockouts before our key is even attempted).  `BatchMode=yes`
# turns a failed key into a hard fail with a clear rc instead of a hidden
# password prompt that hangs the script.
$SshKeyPath = if ($conf["SSH_KEY_PATH"]) { $conf["SSH_KEY_PATH"].Trim() } else { "" }
$sshTarget = "${SshUser}@${Server}"
$sshCommonArgs = @(
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=30",
    "-p", "$Port"
)
$scpCommonArgs = @(
    "-o", "StrictHostKeyChecking=accept-new",
    "-P", "$Port"
)
if ($SshKeyPath) {
    if (-not (Test-Path $SshKeyPath)) {
        Fail "SSH_KEY_PATH='$SshKeyPath' (from deploy.conf) does not exist on this machine."
    }
    Info "Using SSH key: $SshKeyPath"
    $sshCommonArgs += @(
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-i", $SshKeyPath
    )
    $scpCommonArgs += @(
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-i", $SshKeyPath
    )
}

# ---------------------------------------------------------------------------
# 2. SSH probe
# ---------------------------------------------------------------------------

Section "Probing SSH (default keys / agent)"
# Capture stderr so the operator sees the actual reason (host key mismatch,
# permission denied, network unreachable, banner exchange) on rc!=0.
# `2>&1` here merges stderr into the success stream so we can surface it.
$probeOut = & ssh.exe @sshCommonArgs $sshTarget "echo ArkManiaGest-DevUpdate-OK" 2>&1
$probeRc  = $LASTEXITCODE
if ($probeRc -ne 0) {
    Write-Host "  ssh output:" -ForegroundColor DarkGray
    $probeOut | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host ""
    Write-Host "  Hints:" -ForegroundColor Yellow
    Write-Host "    - rerun verbose: ssh -vv $sshTarget 'echo OK'" -ForegroundColor Yellow
    Write-Host "    - check the host accepts your key: ssh-add -l   (then -V on the server's authorized_keys)" -ForegroundColor Yellow
    Write-Host "    - if you use a non-default key, set SSH_KEY_PATH in deploy/deploy.conf" -ForegroundColor Yellow
    Fail "SSH to $sshTarget failed (rc=$probeRc)."
}
OK "SSH OK"

# ---------------------------------------------------------------------------
# 3. Sanity checks on the remote host
# ---------------------------------------------------------------------------

Section "Sanity checks"

$envRc = Invoke-SSH-Quiet ($sshCommonArgs + @($sshTarget, "test -f /opt/arkmaniagest/backend/.env"))
if ($envRc -ne 0) {
    Warn "/opt/arkmaniagest/backend/.env not found on target."
    Warn "This script updates an EXISTING panel.  For a fresh install, use install-panel.ps1."
    $go = Read-Host "Continue anyway? [y/N]"
    if ($go -ne 'y' -and $go -ne 'Y') { exit 1 }
}

$scriptRc = Invoke-SSH-Quiet ($sshCommonArgs + @($sshTarget, "test -f /opt/arkmaniagest/deploy/server-update.sh"))
if ($scriptRc -ne 0) {
    Warn "server-update.sh not present on target; uploading a fresh copy alongside."
}
OK "Checks done"

# ---------------------------------------------------------------------------
# 4. Package the current project
# ---------------------------------------------------------------------------

Section "Packaging working tree"

if ($DryRun) {
    Info "DryRun: would tar the project and skip upload/run."
    exit 0
}

Push-Location $PROJECT
try {
    if (Test-Path $DEPLOYIGNORE) {
        & $TAR -czf $ARCHIVE --exclude-from="$DEPLOYIGNORE" .
    } else {
        Warn ".deployignore not found; using inline exclusion list"
        & $TAR -czf $ARCHIVE `
            --exclude=node_modules --exclude=venv --exclude=__pycache__ `
            --exclude=.git --exclude=frontend/dist `
            --exclude='*.vault' --exclude='.env' `
            --exclude='deploy/maintainer' --exclude='release-build' `
            .
    }
} finally {
    Pop-Location
}

if (-not (Test-Path $ARCHIVE)) { Fail "tar failed (no archive produced)" }
$sizeMB = [math]::Round((Get-Item $ARCHIVE).Length / 1MB, 2)
OK "Archive: $ARCHIVE ($sizeMB MB)"

# ---------------------------------------------------------------------------
# 5. Upload + run server-update.sh
# ---------------------------------------------------------------------------

Section "Uploading to target"

$scpArgs = $scpCommonArgs + @(
    "$ARCHIVE",
    "${sshTarget}:/tmp/arkmaniagest-update.tar.gz"
)
& scp.exe @scpArgs
if ($LASTEXITCODE -ne 0) { Fail "scp tarball failed (rc=$LASTEXITCODE)" }
OK "Tarball uploaded"

# The remote /opt/arkmaniagest may be running an older server-update.sh
# than the one we just packaged; we overwrite it before running so the
# fresh rsync + restart logic from this source tree is used.
$updateScript = Join-Path $PROJECT "deploy\server-update.sh"
if (Test-Path $updateScript) {
    # Strip CRLF + UTF-8 BOM -- bash chokes on both.
    $scriptUnix = Join-Path $env:TEMP "server-update-unix.sh"
    $content = (Get-Content $updateScript -Raw) -replace "`r`n", "`n"
    # PS 5.1 does NOT accept a trailing comma in an argument list, so keep
    # all three args on a single "no trailing comma" signature.
    [System.IO.File]::WriteAllText(
        $scriptUnix,
        $content,
        [System.Text.UTF8Encoding]::new($false)
    )
    $scpScript = $scpCommonArgs + @(
        "$scriptUnix",
        "${sshTarget}:/tmp/server-update.sh"
    )
    & scp.exe @scpScript
    Remove-Item -Force $scriptUnix -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) { Fail "scp server-update.sh failed (rc=$LASTEXITCODE)" }
    OK "Update script uploaded"
}

Section "Running remote update"

$mode = "FULL"
if ($BackendOnly)  { $mode = "BACKEND" }
if ($FrontendOnly) { $mode = "FRONTEND" }
$deps = "AUTO"
if ($NoDeps)   { $deps = "SKIP" }
if ($WithDeps) { $deps = "FORCE" }

# Use the freshly-uploaded /tmp copy as the authoritative script.  We run
# it under sudo -n so a non-root ssh user (operator / deploy user) can
# still perform the update when the sudoers snippet is in place.
$remoteCmd = @"
set -e
chmod +x /tmp/server-update.sh
if command -v sudo >/dev/null 2>&1 && [ "`$(id -un)" != "root" ]; then
    sudo -n bash /tmp/server-update.sh $mode $deps
else
    bash /tmp/server-update.sh $mode $deps
fi
rm -f /tmp/server-update.sh
"@

# The .ps1 file is CRLF on disk, so the here-string embeds \r\n.  Remote
# bash treats the \r as part of each token ("set -e<CR>" -> invalid
# option; "/tmp/server-update.sh<CR>" -> no such file).  Normalize to LF
# before sending, exactly like the scp'd script above.
$remoteCmd = $remoteCmd -replace "`r`n", "`n"

$rc = Invoke-SSH ($sshCommonArgs + @($sshTarget, $remoteCmd))
if ($rc -ne 0) { Fail "Remote update failed (rc=$rc)" }
OK "Remote update finished"

# ---------------------------------------------------------------------------
# 6. Verify
# ---------------------------------------------------------------------------

Section "Verification"

$healthRc = Invoke-SSH-Quiet ($sshCommonArgs + @($sshTarget, "curl -sf http://127.0.0.1:8000/health >/dev/null"))
if ($healthRc -eq 0) {
    OK "Backend /health responded"
    Invoke-SSH ($sshCommonArgs + @($sshTarget, "curl -sf http://127.0.0.1:8000/health")) | Out-Null
} else {
    Warn "Backend not answering /health yet.  Check: sudo systemctl status arkmaniagest"
}

Remove-Item -Force $ARCHIVE -ErrorAction SilentlyContinue
Section "Done"
