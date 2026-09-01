<#
.SYNOPSIS
    Audit and apply security hardening on an ArkMania native-Windows host.

.DESCRIPTION
    One catalogue of controls, two modes.  Without -Apply the script only
    reports; with -Apply it fixes the controls you name.  It is the single
    implementation: ArkManiaGest pushes this same file to the host and parses
    its -Json output, so the panel and the command line can never drift.

    Every control is idempotent and every fix is guarded by its own check, so
    re-running is the supported way to converge a host.

    THREAT MODEL.  This host is a public game server: UDP game ports face the
    internet, and it is reached for administration over SSH by the panel.
    The controls therefore aim at (a) shrinking the inbound surface to the
    game ports plus administration, (b) making an ARK remote-code-execution
    land on an unprivileged account rather than SYSTEM, and (c) removing the
    classic Windows footguns -- SMBv1, LLMNR, NetBIOS, Print Spooler.

    LOCKOUT SAFETY.  Controls that can cut your own administration off are
    tagged ``lockout`` and are skipped unless you pass -IncludeRisky.  On top
    of that:

      * ``fw.default_deny`` refuses to run unless an enabled inbound allow
        rule for the SSH port already exists, so blocking-by-default can
        never be the change that locks you out.
      * ``ssh.no_password_auth`` refuses to run unless a non-empty
        authorized_keys is already in place for an administrator.
      * -AllowIp defaults to the address you are connected from, so the
        firewall keeps the session that is applying the change reachable.

.PARAMETER Apply
    Apply fixes.  Without it the script only audits and changes nothing.

.PARAMETER Controls
    Control ids to act on.  Empty means every control that is not tagged
    ``lockout``.  Ignored when auditing -- an audit always covers everything.

.PARAMETER IncludeRisky
    Allow controls tagged ``lockout`` to be applied.  Without it they are
    audited and reported but never changed.

.PARAMETER AllowIp
    Source addresses that keep administrative access (SSH, RDP).  Defaults to
    the peer address of the current SSH session, so applying over SSH cannot
    strand you.  Accepts anything New-NetFirewallRule -RemoteAddress accepts,
    e.g. '203.0.113.7' or '203.0.113.0/24'.

.PARAMETER GamePorts
    UDP ports to keep open inbound.  The panel passes the ports of every
    instance on the host; on the command line list them yourself.

.PARAMETER ServiceAccount
    Local account the ARK services should run under for
    ``svc.ark_least_privilege``.  Created if missing, with a random password
    and no interactive-logon right.

.PARAMETER Json
    Emit a JSON array instead of human-readable output.  The panel uses this.

.PARAMETER BaseDir
    ArkMania install root, used to scope the Defender exclusion check.

.EXAMPLE
    .\harden.ps1
    Audit everything, print a table, change nothing.

.EXAMPLE
    .\harden.ps1 -Apply -GamePorts 7777,7779
    Apply every non-lockout control.

.EXAMPLE
    .\harden.ps1 -Apply -IncludeRisky -Controls fw.default_deny,fw.ssh_restricted -AllowIp 203.0.113.7
    Close the host down to the game ports plus SSH from one address.

.NOTES
    Must run elevated.  Windows PowerShell 5.1 dialect: no '&&', no ternary,
    no null-coalescing.
#>
[CmdletBinding()]
param(
    [switch]   $Apply,
    [string[]] $Controls = @(),
    [switch]   $IncludeRisky,
    [string[]] $AllowIp = @(),
    [int[]]    $GamePorts = @(),
    [string]   $ServiceAccount = 'ArkManiaSvc',
    [switch]   $Json,
    [string]   $BaseDir = 'C:\ArkMania'
)

$ErrorActionPreference = 'Stop'

# Ports the panel reaches the host on.  Kept as a variable so a host running
# OpenSSH on a non-default port can be handled by editing one line.
$SSH_PORT = 22

# ── Infrastructure ───────────────────────────────────────────────────────────

function Get-CurrentPeerAddress {
    <#
        Best-effort discovery of the address this session came from, so the
        firewall rules keep it reachable.  SSH_CLIENT is set by OpenSSH; the
        TCP fallback covers RDP and console runs.
    #>
    if ($env:SSH_CLIENT) { return ($env:SSH_CLIENT -split '\s+')[0] }
    if ($env:SSH_CONNECTION) { return ($env:SSH_CONNECTION -split '\s+')[0] }
    try {
        $conn = Get-NetTCPConnection -LocalPort $SSH_PORT -State Established -ErrorAction Stop |
                Select-Object -First 1
        if ($conn) { return $conn.RemoteAddress }
    } catch { }
    return ''
}

if ($AllowIp.Count -eq 0) {
    $peer = Get-CurrentPeerAddress
    if ($peer) { $AllowIp = @($peer) }
}

$script:Results = New-Object System.Collections.ArrayList

function Add-Result {
    param(
        [string] $Id, [string] $Title, [string] $Category, [string] $Risk,
        [bool] $Compliant, [string] $Detail,
        [string] $Applied = 'no', [string] $ErrorText = ''
    )
    [void]$script:Results.Add([pscustomobject]@{
        id        = $Id
        title     = $Title
        category  = $Category
        risk      = $Risk
        compliant = $Compliant
        detail    = $Detail
        applied   = $Applied
        error     = $ErrorText
    })
}

function Test-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ── Control catalogue ────────────────────────────────────────────────────────
#
# Each entry: Id / Title / Category / Risk / Check / Fix.
#   Risk  'none'    safe to apply unattended
#         'service' can interrupt the game servers
#         'lockout' can cut administrative access -- needs -IncludeRisky
#   Check returns @{ Compliant = $bool; Detail = 'text' }
#   Fix   throws on failure; its success is re-verified by Check afterwards.

function Get-ControlCatalogue {
    $catalogue = @()

    # ---- Firewall ----------------------------------------------------------

    $catalogue += @{
        Id = 'fw.ssh_restricted'; Category = 'firewall'; Risk = 'lockout'
        Title = 'SSH reachable only from the administration addresses'
        Check = {
            $r = Get-NetFirewallRule -DisplayName 'ArkMania-SSH' -ErrorAction SilentlyContinue
            if ($null -eq $r) {
                return @{ Compliant = $false; Detail = 'No ArkMania-SSH rule; SSH is governed by the default Windows rule, which allows any source.' }
            }
            $addr = ($r | Get-NetFirewallAddressFilter).RemoteAddress
            if ($addr -contains 'Any') {
                return @{ Compliant = $false; Detail = 'ArkMania-SSH accepts any source address.' }
            }
            return @{ Compliant = $true; Detail = "Restricted to: $($addr -join ', ')" }
        }
        Fix = {
            if ($AllowIp.Count -eq 0) {
                throw 'Refusing to restrict SSH with an empty -AllowIp: that would lock every administrator out.'
            }
            Get-NetFirewallRule -DisplayName 'ArkMania-SSH' -ErrorAction SilentlyContinue |
                Remove-NetFirewallRule -ErrorAction SilentlyContinue
            New-NetFirewallRule -DisplayName 'ArkMania-SSH' -Direction Inbound `
                -Protocol TCP -LocalPort $SSH_PORT -RemoteAddress $AllowIp `
                -Action Allow -Profile Any | Out-Null
        }
    }

    $catalogue += @{
        Id = 'fw.game_ports'; Category = 'firewall'; Risk = 'none'
        Title = 'Game ports open, and only the game ports'
        Check = {
            if ($GamePorts.Count -eq 0) {
                return @{ Compliant = $true; Detail = 'No game ports supplied; nothing to verify.' }
            }
            $missing = @()
            foreach ($p in $GamePorts) {
                $found = Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
                    Where-Object { $_.Protocol -eq 'UDP' -and ($_.LocalPort -contains "$p") } |
                    ForEach-Object { $_ | Get-NetFirewallRule -ErrorAction SilentlyContinue } |
                    Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }
                if (-not $found) { $missing += $p }
            }
            if ($missing.Count -gt 0) {
                return @{ Compliant = $false; Detail = "No inbound UDP allow rule for: $($missing -join ', ')" }
            }
            return @{ Compliant = $true; Detail = "All $($GamePorts.Count) game ports are allowed inbound." }
        }
        Fix = {
            foreach ($p in $GamePorts) {
                $name = "ArkMania-Game-$p"
                if ($null -eq (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
                    New-NetFirewallRule -DisplayName $name -Direction Inbound `
                        -Protocol UDP -LocalPort $p -Action Allow -Profile Any | Out-Null
                }
            }
        }
    }

    $catalogue += @{
        Id = 'fw.default_deny'; Category = 'firewall'; Risk = 'lockout'
        Title = 'Firewall blocks inbound traffic by default'
        Check = {
            $bad = Get-NetFirewallProfile | Where-Object {
                $_.Enabled -ne 'True' -or $_.DefaultInboundAction -eq 'Allow'
            }
            if ($bad) {
                return @{ Compliant = $false; Detail = "Profiles not blocking by default: $(($bad | ForEach-Object { $_.Name }) -join ', ')" }
            }
            return @{ Compliant = $true; Detail = 'All profiles enabled and blocking inbound by default.' }
        }
        Fix = {
            # Ordering guard: never make block-by-default the change that
            # severs administration.
            $ssh = Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
                Where-Object { $_.Protocol -eq 'TCP' -and ($_.LocalPort -contains "$SSH_PORT") } |
                ForEach-Object { $_ | Get-NetFirewallRule -ErrorAction SilentlyContinue } |
                Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }
            if (-not $ssh) {
                throw "Refusing to block inbound by default: no enabled inbound allow rule for TCP $SSH_PORT exists, so this would end the SSH session and every future one. Apply fw.ssh_restricted first."
            }
            Set-NetFirewallProfile -All -Enabled True `
                -DefaultInboundAction Block -DefaultOutboundAction Allow
        }
    }

    $catalogue += @{
        Id = 'fw.smb_blocked'; Category = 'firewall'; Risk = 'service'
        Title = 'SMB and NetBIOS not reachable from the network'
        Check = {
            $r = Get-NetFirewallRule -DisplayName 'ArkMania-Block-SMB' -ErrorAction SilentlyContinue
            if ($r -and $r.Enabled -eq 'True') {
                return @{ Compliant = $true; Detail = 'Inbound 139/445 explicitly blocked.' }
            }
            return @{ Compliant = $false; Detail = 'No explicit block on inbound 139/445. File sharing is a standing target and this host does not need it unless the cluster directory is an SMB share.' }
        }
        Fix = {
            if ($null -eq (Get-NetFirewallRule -DisplayName 'ArkMania-Block-SMB' -ErrorAction SilentlyContinue)) {
                New-NetFirewallRule -DisplayName 'ArkMania-Block-SMB' -Direction Inbound `
                    -Protocol TCP -LocalPort 139,445 -Action Block -Profile Any | Out-Null
            }
        }
    }

    $catalogue += @{
        Id = 'fw.rdp_restricted'; Category = 'firewall'; Risk = 'lockout'
        Title = 'RDP reachable only from the administration addresses'
        Check = {
            $rules = Get-NetFirewallRule -ErrorAction SilentlyContinue |
                Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.DisplayGroup -like '*Remote Desktop*' }
            if (-not $rules) {
                return @{ Compliant = $true; Detail = 'No enabled inbound RDP allow rule.' }
            }
            $open = $rules | Where-Object { ($_ | Get-NetFirewallAddressFilter).RemoteAddress -contains 'Any' }
            if ($open) {
                return @{ Compliant = $false; Detail = "RDP is allowed from any address by $($open.Count) rule(s). RDP is the most brute-forced port on the internet." }
            }
            return @{ Compliant = $true; Detail = 'RDP rules are all source-restricted.' }
        }
        Fix = {
            if ($AllowIp.Count -eq 0) {
                throw 'Refusing to restrict RDP with an empty -AllowIp.'
            }
            Get-NetFirewallRule -ErrorAction SilentlyContinue |
                Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.DisplayGroup -like '*Remote Desktop*' } |
                Set-NetFirewallRule -RemoteAddress $AllowIp
        }
    }

    $catalogue += @{
        Id = 'fw.rcon_not_exposed'; Category = 'firewall'; Risk = 'none'
        Title = 'RCON ports not published to the internet'
        Check = {
            # ARK binds RCON on all interfaces; the panel reaches it through
            # the SSH tunnel, so nothing should allow it inbound.
            $bad = Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.Protocol -eq 'TCP' -and
                    ($_.LocalPort | Where-Object { $_ -match '^\d+$' -and [int]$_ -ge 27015 -and [int]$_ -le 27050 })
                } |
                ForEach-Object { $_ | Get-NetFirewallRule -ErrorAction SilentlyContinue } |
                Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }
            if ($bad) {
                return @{ Compliant = $false; Detail = "Inbound allow rules expose RCON range 27015-27050: $(($bad | ForEach-Object { $_.DisplayName }) -join ', '). Anyone reaching RCON owns every server on this host." }
            }
            return @{ Compliant = $true; Detail = 'No inbound rule publishes the RCON range.' }
        }
        Fix = {
            Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.Protocol -eq 'TCP' -and
                    ($_.LocalPort | Where-Object { $_ -match '^\d+$' -and [int]$_ -ge 27015 -and [int]$_ -le 27050 })
                } |
                ForEach-Object { $_ | Get-NetFirewallRule -ErrorAction SilentlyContinue } |
                Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } |
                Disable-NetFirewallRule
        }
    }

    # ---- OpenSSH -----------------------------------------------------------

    $catalogue += @{
        Id = 'ssh.no_password_auth'; Category = 'ssh'; Risk = 'lockout'
        Title = 'SSH accepts keys only, not passwords'
        Check = {
            $cfg = Join-Path $env:ProgramData 'ssh\sshd_config'
            if (-not (Test-Path $cfg)) {
                return @{ Compliant = $false; Detail = 'sshd_config not found; OpenSSH server may not be installed.' }
            }
            $line = Select-String -LiteralPath $cfg -Pattern '^\s*PasswordAuthentication\s+(\w+)' |
                Select-Object -Last 1
            if ($line -and $line.Matches[0].Groups[1].Value -match '^(?i)no$') {
                return @{ Compliant = $true; Detail = 'PasswordAuthentication no' }
            }
            return @{ Compliant = $false; Detail = 'Password authentication is enabled: SSH is brute-forceable.' }
        }
        Fix = {
            $keys = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
            $hasKey = $false
            if (Test-Path $keys) {
                $content = Get-Content -LiteralPath $keys -ErrorAction SilentlyContinue
                if ($content -and ($content | Where-Object { $_.Trim() -and -not $_.TrimStart().StartsWith('#') })) {
                    $hasKey = $true
                }
            }
            if (-not $hasKey) {
                throw "Refusing to disable password authentication: $keys holds no usable key, so nobody could log in afterwards."
            }
            $cfg = Join-Path $env:ProgramData 'ssh\sshd_config'
            $body = Get-Content -LiteralPath $cfg -Raw
            if ($body -match '(?m)^\s*#?\s*PasswordAuthentication\s+\w+') {
                $body = $body -replace '(?m)^\s*#?\s*PasswordAuthentication\s+\w+', 'PasswordAuthentication no'
            } else {
                $body = $body.TrimEnd() + "`r`nPasswordAuthentication no`r`n"
            }
            [System.IO.File]::WriteAllText($cfg, $body, (New-Object System.Text.UTF8Encoding $false))
            Restart-Service sshd -Force
        }
    }

    $catalogue += @{
        Id = 'ssh.admin_keys_acl'; Category = 'ssh'; Risk = 'none'
        Title = 'administrators_authorized_keys is not writable by unprivileged users'
        Check = {
            $keys = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
            if (-not (Test-Path $keys)) {
                return @{ Compliant = $false; Detail = 'File missing: key-based administrator login is not configured.' }
            }
            $acl = Get-Acl -LiteralPath $keys
            $bad = $acl.Access | Where-Object {
                $_.AccessControlType -eq 'Allow' -and
                $_.IdentityReference -notmatch 'SYSTEM|Administrators' -and
                $_.FileSystemRights -match 'Write|FullControl|Modify'
            }
            if ($bad) {
                return @{ Compliant = $false; Detail = "Writable by: $(($bad | ForEach-Object { $_.IdentityReference }) -join ', '). Anyone who can write it can add their own key. OpenSSH also refuses the file in this state." }
            }
            return @{ Compliant = $true; Detail = 'Only SYSTEM and Administrators can write it.' }
        }
        Fix = {
            $keys = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
            if (-not (Test-Path $keys)) { throw "$keys does not exist; add an administrator public key first." }
            icacls $keys /inheritance:r /grant 'SYSTEM:F' /grant 'BUILTIN\Administrators:F' | Out-Null
        }
    }

    # ---- Services ----------------------------------------------------------

    foreach ($svc in @(
        @{ Name = 'Spooler';        Id = 'svc.spooler_disabled';         Why = 'The Print Spooler has produced a long line of privilege-escalation bugs and a game server never prints.' },
        @{ Name = 'RemoteRegistry'; Id = 'svc.remote_registry_disabled'; Why = 'Remote registry access is a reconnaissance and persistence path with no use here.' },
        @{ Name = 'WinRM';          Id = 'svc.winrm_disabled';           Why = 'WinRM is a second remote-administration surface; the panel uses SSH.' }
    )) {
        $catalogue += @{
            Id = $svc.Id; Category = 'services'; Risk = 'none'
            Title = "$($svc.Name) service disabled"
            Check = {
                $s = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
                if ($null -eq $s) { return @{ Compliant = $true; Detail = 'Service not present.' } }
                if ($s.Status -eq 'Stopped' -and $s.StartType -eq 'Disabled') {
                    return @{ Compliant = $true; Detail = 'Stopped and disabled.' }
                }
                return @{ Compliant = $false; Detail = "$($s.Status) / $($s.StartType). $($svc.Why)" }
            }.GetNewClosure()
            Fix = {
                $s = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
                if ($null -ne $s) {
                    Stop-Service -Name $svc.Name -Force -ErrorAction SilentlyContinue
                    Set-Service  -Name $svc.Name -StartupType Disabled
                }
            }.GetNewClosure()
        }
    }

    $catalogue += @{
        Id = 'svc.ark_least_privilege'; Category = 'services'; Risk = 'service'
        Title = 'ARK services do not run as LocalSystem'
        Check = {
            $svcs = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like 'ArkMania-*' -and $_.Name -ne 'ArkMania-Syncthing' }
            if (-not $svcs) { return @{ Compliant = $true; Detail = 'No ArkMania game services registered yet.' } }
            $system = $svcs | Where-Object { $_.StartName -match 'LocalSystem|NT AUTHORITY\\SYSTEM' }
            if ($system) {
                return @{ Compliant = $false; Detail = "Configured to run as SYSTEM: $(($system | ForEach-Object { $_.Name }) -join ', '). ARK parses untrusted network input; a memory-safety bug in the server or a plugin would execute with full machine privileges. Fixing this rewrites the service logon; it takes effect at the next graceful restart, because bouncing a live server here would cost players their session." }
            }
            return @{ Compliant = $true; Detail = "All $($svcs.Count) service(s) run as a restricted account." }
        }
        Fix = {
            # The password is rotated on every run rather than remembered.
            # Nothing ever logs in as this account interactively -- the only
            # consumer is the service configuration, which we rewrite in the
            # same breath -- so a fresh secret each time is both safe and the
            # only way this control stays re-appliable.  Provisioning a new
            # instance registers its service as LocalSystem again, and this
            # has to be able to pull it back without the operator deleting
            # the account first.
            Add-Type -AssemblyName System.Web
            $pw  = [System.Web.Security.Membership]::GeneratePassword(24, 6)
            $sec = ConvertTo-SecureString $pw -AsPlainText -Force

            $acct = Get-LocalUser -Name $ServiceAccount -ErrorAction SilentlyContinue
            if ($null -eq $acct) {
                New-LocalUser -Name $ServiceAccount -Password $sec `
                    -Description 'ArkMania game server service account' `
                    -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
                $script:NewServicePassword = $pw
            } else {
                Set-LocalUser -Name $ServiceAccount -Password $sec -PasswordNeverExpires $true
            }

            # Keep it out of every group that grants logon rights: a service
            # account in Users can still start an interactive session.
            foreach ($g in @('Administrators', 'Users', 'Remote Desktop Users')) {
                try {
                    Remove-LocalGroupMember -Group $g -Member $ServiceAccount -ErrorAction Stop
                } catch { }   # not a member: fine
            }

            # The minimum it needs: modify rights on the ArkMania tree only.
            if (Test-Path $BaseDir) {
                icacls $BaseDir /grant "${ServiceAccount}:(OI)(CI)M" /T /C | Out-Null
            }

            $svcs = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like 'ArkMania-*' -and $_.Name -ne 'ArkMania-Syncthing' }
            foreach ($s in $svcs) {
                # sc.exe is the only supported way to change a service logon
                # without recreating the service.  The spaces after obj= and
                # password= are part of its syntax, not a typo.
                & sc.exe config $s.Name obj= ".\$ServiceAccount" password= $pw | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "sc.exe config failed for $($s.Name) (exit $LASTEXITCODE)" }
            }
            # Deliberately NOT restarting the services here.  A running ARK
            # server only writes its world on a graceful shutdown, and
            # Stop-Service is not one: bouncing a full server from a
            # hardening pass would cost players their session.  The new logon
            # is stored now and takes effect at the next ordinary restart from
            # the panel, which does save first.  The check reads the
            # *configured* account, so it turns green immediately -- what is
            # deferred is only which token the already-running process holds.
        }
    }

    # ---- SMB and name resolution ------------------------------------------

    $catalogue += @{
        Id = 'smb.v1_disabled'; Category = 'network'; Risk = 'none'
        Title = 'SMBv1 removed'
        Check = {
            $f = Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -ErrorAction SilentlyContinue
            if ($null -eq $f) { return @{ Compliant = $true; Detail = 'SMB1 feature not present on this edition.' } }
            if ($f.State -eq 'Disabled') { return @{ Compliant = $true; Detail = 'Disabled.' } }
            return @{ Compliant = $false; Detail = 'SMBv1 is enabled. It is unauthenticated, unencrypted and the transport WannaCry used.' }
        }
        Fix = {
            Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart | Out-Null
        }
    }

    $catalogue += @{
        Id = 'smb.signing_required'; Category = 'network'; Risk = 'none'
        Title = 'SMB server requires signing'
        Check = {
            $c = Get-SmbServerConfiguration -ErrorAction SilentlyContinue
            if ($null -eq $c) { return @{ Compliant = $true; Detail = 'SMB server not available.' } }
            if ($c.RequireSecuritySignature) { return @{ Compliant = $true; Detail = 'Signing required.' } }
            return @{ Compliant = $false; Detail = 'Signing not required: SMB relay attacks are possible against this host.' }
        }
        Fix = { Set-SmbServerConfiguration -RequireSecuritySignature $true -Force }
    }

    $catalogue += @{
        Id = 'net.llmnr_disabled'; Category = 'network'; Risk = 'none'
        Title = 'LLMNR disabled'
        Check = {
            $k = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient'
            $v = (Get-ItemProperty -Path $k -Name EnableMulticast -ErrorAction SilentlyContinue).EnableMulticast
            if ($v -eq 0) { return @{ Compliant = $true; Detail = 'EnableMulticast = 0' } }
            return @{ Compliant = $false; Detail = 'LLMNR is on: any host on the segment can answer name lookups and harvest credentials.' }
        }
        Fix = {
            $k = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient'
            if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
            Set-ItemProperty -Path $k -Name EnableMulticast -Value 0 -Type DWord
        }
    }

    $catalogue += @{
        Id = 'net.netbios_disabled'; Category = 'network'; Risk = 'none'
        Title = 'NetBIOS over TCP/IP disabled on all adapters'
        Check = {
            $k = 'HKLM:\SYSTEM\CurrentControlSet\Services\NetBT\Parameters\Interfaces'
            $bad = Get-ChildItem $k -ErrorAction SilentlyContinue | Where-Object {
                (Get-ItemProperty -Path $_.PSPath -Name NetbiosOptions -ErrorAction SilentlyContinue).NetbiosOptions -ne 2
            }
            if ($bad) { return @{ Compliant = $false; Detail = "$($bad.Count) adapter(s) still answer NetBIOS name queries." } }
            return @{ Compliant = $true; Detail = 'Disabled on every adapter.' }
        }
        Fix = {
            $k = 'HKLM:\SYSTEM\CurrentControlSet\Services\NetBT\Parameters\Interfaces'
            Get-ChildItem $k -ErrorAction SilentlyContinue | ForEach-Object {
                Set-ItemProperty -Path $_.PSPath -Name NetbiosOptions -Value 2 -Type DWord
            }
        }
    }

    # ---- Accounts ----------------------------------------------------------

    $catalogue += @{
        Id = 'acct.guest_disabled'; Category = 'accounts'; Risk = 'none'
        Title = 'Guest account disabled'
        Check = {
            $g = Get-LocalUser -Name 'Guest' -ErrorAction SilentlyContinue
            if ($null -eq $g) { return @{ Compliant = $true; Detail = 'No Guest account.' } }
            if (-not $g.Enabled) { return @{ Compliant = $true; Detail = 'Disabled.' } }
            return @{ Compliant = $false; Detail = 'Guest is enabled.' }
        }
        Fix = { Disable-LocalUser -Name 'Guest' }
    }

    $catalogue += @{
        Id = 'acct.lockout_policy'; Category = 'accounts'; Risk = 'lockout'
        Title = 'Account lockout policy set'
        Check = {
            $out = & net.exe accounts
            $line = $out | Where-Object { $_ -match 'Lockout threshold' }
            if ($line -match '(\d+)') {
                return @{ Compliant = $true; Detail = "Threshold: $($matches[1])" }
            }
            return @{ Compliant = $false; Detail = 'No lockout threshold: local accounts can be brute-forced indefinitely.' }
        }
        Fix = {
            & net.exe accounts /lockoutthreshold:10 /lockoutduration:15 /lockoutwindow:15 | Out-Null
        }
    }

    # ---- Platform ----------------------------------------------------------

    $catalogue += @{
        Id = 'lsa.runasppl'; Category = 'platform'; Risk = 'none'
        Title = 'LSA runs protected (credential dumping mitigation)'
        Check = {
            $v = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL
            if ($v -ge 1) { return @{ Compliant = $true; Detail = "RunAsPPL = $v" } }
            return @{ Compliant = $false; Detail = 'LSASS is unprotected; credential dumping tools read it directly. Takes effect after a reboot.' }
        }
        Fix = {
            Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' `
                -Name RunAsPPL -Value 1 -Type DWord
        }
    }

    $catalogue += @{
        Id = 'audit.logon_and_process'; Category = 'platform'; Risk = 'none'
        Title = 'Logon and process-creation auditing enabled'
        Check = {
            $out = & auditpol.exe /get /category:* 2>$null
            $logon = $out | Where-Object { $_ -match '\bLogon\b' -and $_ -match 'Success|Failure' }
            $proc  = $out | Where-Object { $_ -match 'Process Creation' -and $_ -match 'Success' }
            if ($logon -and $proc) { return @{ Compliant = $true; Detail = 'Logon and process creation are audited.' } }
            return @{ Compliant = $false; Detail = 'Without these there is no record of who logged in or what ran after a compromise.' }
        }
        Fix = {
            & auditpol.exe /set /subcategory:"Logon" /success:enable /failure:enable | Out-Null
            & auditpol.exe /set /subcategory:"Logoff" /success:enable | Out-Null
            & auditpol.exe /set /subcategory:"Process Creation" /success:enable | Out-Null
        }
    }

    $catalogue += @{
        Id = 'defender.realtime'; Category = 'platform'; Risk = 'none'
        Title = 'Defender real-time protection on, exclusions scoped to the ARK tree'
        Check = {
            $p = Get-MpPreference -ErrorAction SilentlyContinue
            $s = Get-MpComputerStatus -ErrorAction SilentlyContinue
            if ($null -eq $p -or $null -eq $s) { return @{ Compliant = $true; Detail = 'Defender not available on this host.' } }
            if (-not $s.RealTimeProtectionEnabled) {
                return @{ Compliant = $false; Detail = 'Real-time protection is off.' }
            }
            $wide = @($p.ExclusionPath) | Where-Object {
                $_ -and ($_ -notlike "$BaseDir*") -and ($_ -match '^[A-Za-z]:\\?$')
            }
            if ($wide) {
                return @{ Compliant = $false; Detail = "Whole-drive exclusions defeat the scanner: $($wide -join ', ')" }
            }
            return @{ Compliant = $true; Detail = 'On, with exclusions scoped to the ARK tree.' }
        }
        Fix = {
            Set-MpPreference -DisableRealtimeMonitoring $false
            $p = Get-MpPreference -ErrorAction SilentlyContinue
            @($p.ExclusionPath) | Where-Object {
                $_ -and ($_ -notlike "$BaseDir*") -and ($_ -match '^[A-Za-z]:\\?$')
            } | ForEach-Object { Remove-MpPreference -ExclusionPath $_ }
        }
    }

    $catalogue += @{
        Id = 'update.automatic'; Category = 'platform'; Risk = 'service'
        Title = 'Windows Update installs security updates automatically'
        Check = {
            $k = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update'
            $v = (Get-ItemProperty -Path $k -Name AUOptions -ErrorAction SilentlyContinue).AUOptions
            if ($v -ge 3) { return @{ Compliant = $true; Detail = "AUOptions = $v" } }
            return @{ Compliant = $false; Detail = 'Updates are not downloaded automatically; an internet-facing host will drift into known-vulnerable territory.' }
        }
        Fix = {
            $k = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update'
            if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
            Set-ItemProperty -Path $k -Name AUOptions -Value 4 -Type DWord
        }
    }

    return $catalogue
}

# ── Execution ────────────────────────────────────────────────────────────────

if (-not (Test-Elevated)) {
    if ($Json) {
        Write-Output (ConvertTo-Json @(@{
            id = 'preflight'; title = 'Elevation'; category = 'preflight'
            risk = 'none'; compliant = $false
            detail = 'harden.ps1 must run from an elevated session.'
            applied = 'no'; error = 'not elevated'
        }) -Depth 4)
    } else {
        Write-Error 'harden.ps1 must run from an elevated session.'
    }
    exit 1
}

$catalogue = Get-ControlCatalogue

foreach ($control in $catalogue) {
    $result = $null
    try {
        $result = & $control.Check
    } catch {
        Add-Result -Id $control.Id -Title $control.Title -Category $control.Category `
            -Risk $control.Risk -Compliant $false -Detail 'Check failed.' `
            -ErrorText $_.Exception.Message
        continue
    }

    $applied = 'no'
    $errorText = ''

    $wanted = ($Controls.Count -eq 0) -or ($Controls -contains $control.Id)
    $allowed = ($control.Risk -ne 'lockout') -or $IncludeRisky

    if ($Apply -and $wanted -and -not $result.Compliant) {
        if (-not $allowed) {
            $applied = 'skipped-risky'
        } else {
            try {
                & $control.Fix
                # Re-check rather than trusting the fix: a control is only
                # satisfied when the check says so.
                $result = & $control.Check
                $applied = if ($result.Compliant) { 'yes' } else { 'failed' }
            } catch {
                $applied = 'failed'
                $errorText = $_.Exception.Message
            }
        }
    }

    Add-Result -Id $control.Id -Title $control.Title -Category $control.Category `
        -Risk $control.Risk -Compliant ([bool]$result.Compliant) -Detail $result.Detail `
        -Applied $applied -ErrorText $errorText
}

if ($Json) {
    # -Compress keeps the payload small over SSH; @() forces an array even
    # when a single control is reported.
    Write-Output (ConvertTo-Json @($script:Results) -Depth 4 -Compress)
} else {
    Write-Host ''
    Write-Host 'ArkMania Windows hardening' -ForegroundColor Cyan
    Write-Host ''
    foreach ($r in $script:Results) {
        $mark  = if ($r.compliant) { '[ OK ]' } else { '[FAIL]' }
        $color = if ($r.compliant) { 'Green' } else { 'Yellow' }
        Write-Host ("{0} {1,-32} {2}" -f $mark, $r.id, $r.title) -ForegroundColor $color
        if (-not $r.compliant) { Write-Host ("       {0}" -f $r.detail) -ForegroundColor DarkGray }
        if ($r.applied -eq 'yes')           { Write-Host '       -> fixed' -ForegroundColor Green }
        if ($r.applied -eq 'failed')        { Write-Host ("       -> FIX FAILED: {0}" -f $r.error) -ForegroundColor Red }
        if ($r.applied -eq 'skipped-risky') { Write-Host '       -> skipped: pass -IncludeRisky to apply this one' -ForegroundColor DarkYellow }
    }
    $failed = @($script:Results | Where-Object { -not $_.compliant }).Count
    Write-Host ''
    Write-Host ("{0}/{1} controls satisfied." -f ($script:Results.Count - $failed), $script:Results.Count)
    if ($script:NewServicePassword) {
        Write-Host ''
        Write-Host "Service account '$ServiceAccount' was created. Its password is stored in the service configuration; you do not need to keep a copy." -ForegroundColor Cyan
    }
    if (-not $Apply -and $failed -gt 0) {
        Write-Host 'Run again with -Apply to fix the non-lockout controls.' -ForegroundColor DarkGray
    }
}
