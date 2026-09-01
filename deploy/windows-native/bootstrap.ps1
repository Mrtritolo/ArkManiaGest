<#
.SYNOPSIS
    Provision a Windows host to run ARK: Survival Ascended natively.

.DESCRIPTION
    Prepares everything ArkManiaGest's "native" runtime expects on a Windows
    machine: SteamCMD, one shared ASA installation, the MSVC 2019
    redistributable AsaApi needs, WinSW, the cluster directory, and
    optionally Syncthing to replicate that directory across the cluster.

    No Docker, no WSL, no Proton: the ASA Windows binaries run directly.

    The script is idempotent -- re-running it on a provisioned host is the
    supported upgrade path.  Every step checks before it acts.

    Written for Windows PowerShell 5.1, the version that ships with Windows
    Server, so it avoids PS7-only syntax (no '&&', no ternary, no '??').

.PARAMETER BaseDir
    Install root.  Everything the runtime owns lives underneath it.

.PARAMETER SkipServerFiles
    Skip the SteamCMD download of the ~20 GB server files.  Useful when
    re-running the script only to refresh the tooling.

.PARAMETER InstallSyncthing
    Install Syncthing as a service to replicate the cluster directory.
    Pairing with the other hosts is done afterwards from the Syncthing UI or
    from the panel -- this script only puts the daemon in place.

.EXAMPLE
    .\bootstrap.ps1 -BaseDir 'C:\ArkMania' -InstallSyncthing

.NOTES
    Must run elevated: it registers services and writes firewall rules.
#>
[CmdletBinding()]
param(
    [string] $BaseDir = 'C:\ArkMania',
    [switch] $SkipServerFiles,
    [switch] $InstallSyncthing
)

$ErrorActionPreference = 'Stop'

$ASA_APP_ID       = '2430930'
$STEAMCMD_URL     = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
$WINSW_URL        = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$VCREDIST_URL     = 'https://aka.ms/vs/16/release/vc_redist.x64.exe'
$VCREDIST_REG_KEY = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64'
$SYNCTHING_URL    = 'https://github.com/syncthing/syncthing/releases/latest/download/syncthing-windows-amd64.zip'

function Write-Step  { param([string] $Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok    { param([string] $Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Skip  { param([string] $Message) Write-Host "    $Message (already present, skipping)" -ForegroundColor DarkGray }

function Assert-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This script must be run from an elevated PowerShell session.'
    }
}

function New-DirIfMissing {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
        Write-Ok "created $Path"
    } else {
        Write-Skip $Path
    }
}

function Get-RemoteFile {
    param([string] $Url, [string] $Destination)
    # TLS 1.2 is not the default on older Windows Server builds and every
    # download below is HTTPS-only.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'   # ~10x faster Invoke-WebRequest
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

# ── 0. Preconditions ─────────────────────────────────────────────────────────

Assert-Elevated

Write-Step "Provisioning native ASA runtime under $BaseDir"

$ToolsDir    = Join-Path $BaseDir 'tools'
$SteamDir    = Join-Path $BaseDir 'steamcmd'
$ServerFiles = Join-Path $BaseDir 'ServerFiles'
$Instances   = Join-Path $BaseDir 'Instances'
$ClusterDir  = Join-Path $BaseDir 'Cluster'
$BackupDir   = Join-Path $BaseDir 'Backups'

foreach ($d in @($BaseDir, $ToolsDir, $SteamDir, $ServerFiles, $Instances, $ClusterDir, $BackupDir)) {
    New-DirIfMissing -Path $d
}

# ARK appends clusters\<ClusterID> to -ClusterDirOverride itself.  Creating
# the intermediate level here makes the layout obvious to whoever configures
# replication later, and stops them from syncing one level off -- which
# leaves a plausible-looking directory that no server ever writes to.
New-DirIfMissing -Path (Join-Path $ClusterDir 'clusters')

# ── 1. MSVC 2019 redistributable (AsaApi hard requirement) ──────────────────

Write-Step 'Microsoft Visual C++ 2019 Redistributable'
if (Test-Path -LiteralPath $VCREDIST_REG_KEY) {
    Write-Skip 'vc_redist x64'
} else {
    $vc = Join-Path $env:TEMP 'vc_redist.x64.exe'
    Get-RemoteFile -Url $VCREDIST_URL -Destination $vc
    Start-Process -FilePath $vc -ArgumentList '/install', '/quiet', '/norestart' -Wait
    Remove-Item -LiteralPath $vc -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $VCREDIST_REG_KEY) {
        Write-Ok 'installed'
    } else {
        # Not fatal: the server itself runs without it, only AsaApi will
        # refuse to load.  Say so loudly rather than failing the bootstrap.
        Write-Warning 'vc_redist did not register. AsaApi plugins will NOT load until it is installed.'
    }
}

# ── 2. WinSW ─────────────────────────────────────────────────────────────────

Write-Step 'WinSW service supervisor'
$WinSW = Join-Path $ToolsDir 'WinSW.exe'
if (Test-Path -LiteralPath $WinSW) {
    Write-Skip 'WinSW.exe'
} else {
    Get-RemoteFile -Url $WINSW_URL -Destination $WinSW
    Write-Ok "downloaded to $WinSW"
}

# ── 3. SteamCMD ──────────────────────────────────────────────────────────────

Write-Step 'SteamCMD'
$SteamExe = Join-Path $SteamDir 'steamcmd.exe'
if (Test-Path -LiteralPath $SteamExe) {
    Write-Skip 'steamcmd.exe'
} else {
    $zip = Join-Path $env:TEMP 'steamcmd.zip'
    Get-RemoteFile -Url $STEAMCMD_URL -Destination $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $SteamDir -Force
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Write-Ok "installed to $SteamDir"
}

# ── 4. Shared ASA installation ───────────────────────────────────────────────

Write-Step 'ARK: Survival Ascended dedicated server (shared installation)'
$ServerExe = Join-Path $ServerFiles 'ShooterGame\Binaries\Win64\ArkAscendedServer.exe'
if ($SkipServerFiles) {
    Write-Host '    -SkipServerFiles given, not touching ServerFiles' -ForegroundColor DarkGray
} else {
    Write-Host '    running SteamCMD (this downloads ~20 GB on a fresh host)...'
    & $SteamExe +force_install_dir $ServerFiles +login anonymous +app_update $ASA_APP_ID validate +quit
    if ($LASTEXITCODE -ne 0) {
        throw "SteamCMD exited with code $LASTEXITCODE"
    }
    if (Test-Path -LiteralPath $ServerExe) {
        Write-Ok 'server files present'
    } else {
        throw "SteamCMD reported success but $ServerExe is missing."
    }
}

# ── 5. Windows tuning for a game-server host ────────────────────────────────

Write-Step 'Host tuning'

# ARK's asset paths are long; the shared-install + junction layout makes them
# longer.  Long paths are opt-in on Windows and off by default.
$lpKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem'
$lp = (Get-ItemProperty -Path $lpKey -Name 'LongPathsEnabled' -ErrorAction SilentlyContinue).LongPathsEnabled
if ($lp -eq 1) {
    Write-Skip 'long paths enabled'
} else {
    Set-ItemProperty -Path $lpKey -Name 'LongPathsEnabled' -Value 1 -Type DWord
    Write-Ok 'enabled long path support (reboot required to take effect)'
}

# Defender scanning the server tree costs real I/O on every world save.
if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {
    try {
        Add-MpPreference -ExclusionPath $BaseDir -ErrorAction Stop
        Write-Ok "excluded $BaseDir from Defender scanning"
    } catch {
        Write-Warning "Could not add the Defender exclusion: $($_.Exception.Message)"
    }
} else {
    Write-Host '    Defender cmdlets unavailable, skipping exclusion' -ForegroundColor DarkGray
}

# ── 6. Syncthing for cluster replication (optional) ─────────────────────────

if ($InstallSyncthing) {
    Write-Step 'Syncthing (cluster directory replication)'
    $SyncDir = Join-Path $ToolsDir 'syncthing'
    $SyncExe = Join-Path $SyncDir 'syncthing.exe'
    if (Test-Path -LiteralPath $SyncExe) {
        Write-Skip 'syncthing.exe'
    } else {
        New-DirIfMissing -Path $SyncDir
        $zip = Join-Path $env:TEMP 'syncthing.zip'
        Get-RemoteFile -Url $SYNCTHING_URL -Destination $zip
        $staging = Join-Path $env:TEMP 'syncthing-extract'
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force
        # The archive nests everything under syncthing-windows-amd64-<ver>\
        $inner = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
        Copy-Item -Path (Join-Path $inner.FullName '*') -Destination $SyncDir -Recurse -Force
        Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "installed to $SyncDir"
    }

    $svcName = 'ArkMania-Syncthing'
    if (Get-Service -Name $svcName -ErrorAction SilentlyContinue) {
        Write-Skip "service $svcName"
    } else {
        $xml = @"
<service>
  <id>$svcName</id>
  <name>$svcName</name>
  <description>Syncthing daemon replicating the ArkMania cluster directory</description>
  <executable>$SyncExe</executable>
  <arguments>serve --no-browser --home="$(Join-Path $SyncDir 'config')"</arguments>
  <onfailure action="restart" delay="15 sec"/>
  <startmode>Automatic</startmode>
  <logpath>$(Join-Path $SyncDir 'logs')</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>4</keepFiles></log>
</service>
"@
        $svcXml = Join-Path $SyncDir 'service.xml'
        [System.IO.File]::WriteAllText($svcXml, $xml, (New-Object System.Text.UTF8Encoding $false))
        Copy-Item -Path $WinSW -Destination (Join-Path $SyncDir 'WinSW.exe') -Force
        & (Join-Path $SyncDir 'WinSW.exe') install $svcXml
        Start-Service -Name $svcName
        Write-Ok "registered and started $svcName"
        Write-Host ''
        Write-Host '    Pair this host with the others from the Syncthing UI on' -ForegroundColor Yellow
        Write-Host "    http://127.0.0.1:8384 and share the folder:" -ForegroundColor Yellow
        Write-Host "      $(Join-Path $ClusterDir 'clusters')" -ForegroundColor Yellow
        Write-Host '    Share the folder ROOT shown above, not a cluster-id subfolder.' -ForegroundColor Yellow
    }
}

# ── 7. Summary ───────────────────────────────────────────────────────────────

Write-Host ''
Write-Step 'Done. Register this host in ArkManiaGest with:'
Write-Host "    OS type        : windows"
Write-Host "    Runtime        : native"
Write-Host "    ARK root path  : $BaseDir"
Write-Host "    Cluster dir    : $ClusterDir"
if ($InstallSyncthing) {
    Write-Host "    Cluster sync   : syncthing"
} else {
    Write-Host "    Cluster sync   : none  (set it once replication is configured)"
}
Write-Host ''
Write-Host 'The panel creates the per-instance directories, junctions, WinSW'
Write-Host 'services and firewall rules when you add an instance to this host.'
Write-Host ''
Write-Host 'Next: harden this host.' -ForegroundColor Cyan
Write-Host '  From the panel   : Settings -> Hardening -> Run audit'
Write-Host '  From here        : .\harden.ps1            (audit, changes nothing)'
Write-Host '                     .\harden.ps1 -Apply     (fix the safe controls)'
Write-Host 'Audit first. Controls that can cut your own SSH or RDP access are'
Write-Host 'tagged lockout and stay untouched until you pass -IncludeRisky.'
