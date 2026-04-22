# =============================================================================
# ArkManiaGest - Release automation
# =============================================================================
# End-to-end first-class release flow:
#
#   1. Validate working tree (clean, on main, up-to-date with origin).
#   2. Resolve the new version (explicit -Version OR -Bump patch|minor|major).
#   3. Rewrite every hardcoded version string in source (backend + frontend).
#   4. Prepend a new CHANGELOG section (from -Notes / -NotesFile, or stub).
#   5. Smoke-build the frontend (skip with -SkipBuild).
#   6. Commit "Bump version to X.Y.Z" and push.
#   7. Create annotated tag vX.Y.Z and push it (fires the Release workflow).
#   8. Poll the GitHub Actions run until the release is published (or fail).
#
# Examples (run from anywhere; the script cd's to the repo root itself):
#
#   .\deploy\maintainer\release.ps1 -Bump patch
#   .\deploy\maintainer\release.ps1 -Bump minor -Notes "i18n polish + bug fixes"
#   .\deploy\maintainer\release.ps1 -Version 3.0.0 -NotesFile .\next-release-notes.md
#   .\deploy\maintainer\release.ps1 -Bump patch -DryRun      # print plan, change nothing
#   .\deploy\maintainer\release.ps1 -Version 2.4.0-rc1       # pre-release; sets prerelease=true on GH
#
# Flags:
#   -SkipBuild        do NOT run "npx vite build" (faster; CI will build anyway)
#   -NoMonitor        push the tag and exit; do not wait for GitHub Actions
#   -DryRun           report what would happen, touch nothing
#   -AllowDirty       proceed with uncommitted changes (not recommended)
#   -SkipPull         skip git fetch + ahead/behind check
# =============================================================================

[CmdletBinding(DefaultParameterSetName = 'Explicit')]
param(
    [Parameter(ParameterSetName = 'Explicit', Mandatory = $false)]
    [string]$Version,

    [Parameter(ParameterSetName = 'Bump', Mandatory = $true)]
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump,

    [string]$Notes = "",
    [string]$NotesFile = "",
    [switch]$SkipBuild,
    [switch]$NoMonitor,
    [switch]$DryRun,
    [switch]$AllowDirty,
    [switch]$SkipPull
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Paths + helpers
# ---------------------------------------------------------------------------

# This script lives under deploy\maintainer\, two levels below the repo
# root.  Earlier iterations lived at deploy\release.ps1, so any update that
# re-uses $PSScriptRoot\.. will silently resolve to deploy\ (and Select-String
# will fail with "cannot find path deploy\backend\..." — very confusing).
$PROJECT = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $PROJECT

function Write-Section([string]$text) {
    Write-Host ""
    $bar = "-" * [Math]::Max(0, 70 - $text.Length)
    Write-Host "-- $text $bar" -ForegroundColor Cyan
}

function Write-Action([string]$text) {
    Write-Host "  > $text" -ForegroundColor Yellow
}

function Write-OK([string]$text) {
    Write-Host "  [OK] $text" -ForegroundColor Green
}

function Fail([string]$msg, [int]$code = 1) {
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
    exit $code
}

function Read-VersionFromBackend {
    $mainPy = Join-Path $PROJECT "backend\app\main.py"
    $m = Select-String -Path $mainPy -Pattern 'version="([^"]+)"' | Select-Object -First 1
    if (-not $m) { Fail "Cannot read backend version from main.py" }
    return $m.Matches[0].Groups[1].Value
}

function Invoke-Bump-Semver([string]$current, [string]$kind) {
    if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$') {
        Fail "Current version '$current' is not semver-compatible"
    }
    [int]$maj = $Matches[1]
    [int]$min = $Matches[2]
    [int]$pat = $Matches[3]
    switch ($kind) {
        'major' { $maj++; $min = 0; $pat = 0 }
        'minor' { $min++; $pat = 0 }
        'patch' { $pat++ }
    }
    return "$maj.$min.$pat"
}

function Invoke-Replace([string]$path, [string]$old, [string]$new, [int]$expectedHits) {
    # Read UTF-8 explicitly.  PS 5.1's default is the current ANSI codepage
    # (Windows-1252 on Italian locales), which silently corrupts every
    # non-ASCII char on round-trip — e.g. "—" becomes "â€”" in the rewritten
    # file.  We target cross-platform sources so all our files are UTF-8.
    $content = Get-Content -Raw -Path $path -Encoding UTF8
    $hits = ([regex]::Matches($content, [regex]::Escape($old))).Count
    if ($hits -eq 0) {
        Write-Host "    skip: $path (no occurrence of '$old')" -ForegroundColor DarkGray
        return 0
    }
    if ($expectedHits -gt 0 -and $hits -ne $expectedHits) {
        Fail "$path : expected $expectedHits occurrences of '$old', found $hits"
    }
    if ($DryRun) {
        Write-Host "    would replace $hits occurrence(s) in $path" -ForegroundColor DarkGray
        return $hits
    }
    $new_content = $content.Replace($old, $new)
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Resolve-Path $path), $new_content, $utf8NoBom)
    Write-Host "    patched $hits occurrence(s): $path" -ForegroundColor DarkGray
    return $hits
}

# ---------------------------------------------------------------------------
# 0. Resolve version
# ---------------------------------------------------------------------------

Write-Section "ArkManiaGest release"

$currentVersion = Read-VersionFromBackend
Write-Host "  current version : $currentVersion" -ForegroundColor Gray

if ($Bump) {
    $Version = Invoke-Bump-Semver $currentVersion $Bump
    Write-Host "  -Bump $Bump       -> $Version" -ForegroundColor Gray
}

if (-not $Version) {
    Fail "Pass -Version X.Y.Z[-tag] or -Bump patch|minor|major"
}

if ($Version -eq $currentVersion) {
    Fail "Target version equals current version ($Version)"
}

if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$') {
    Fail "Target version '$Version' is not semver-compatible"
}

$tag = "v$Version"
$isPreRelease = $Version -match '-(rc|beta|alpha)'
Write-Host "  target version  : $Version" -ForegroundColor Gray
Write-Host "  git tag         : $tag" -ForegroundColor Gray
Write-Host "  pre-release     : $isPreRelease" -ForegroundColor Gray
if ($DryRun) { Write-Host "  mode            : DRY-RUN (no changes will be written)" -ForegroundColor Magenta }

# ---------------------------------------------------------------------------
# 1. Working tree checks
# ---------------------------------------------------------------------------

Write-Section "Workspace validation"

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") {
    if ($AllowDirty) {
        Write-Host "  WARNING: on branch '$branch' (not main) - allowed via -AllowDirty" -ForegroundColor Yellow
    } else {
        Fail "Refusing to release from branch '$branch' (expected 'main'). Use -AllowDirty to override."
    }
}
Write-OK "branch: $branch"

$dirty = (git status --porcelain) | Where-Object { $_ }
if ($dirty) {
    if ($AllowDirty) {
        Write-Host "  WARNING: uncommitted changes present (proceeding via -AllowDirty):" -ForegroundColor Yellow
        $dirty | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    } else {
        Fail "Uncommitted changes present. Commit or stash them first, or pass -AllowDirty."
    }
} else {
    Write-OK "working tree clean"
}

if (-not $SkipPull -and -not $DryRun) {
    Write-Action "git fetch origin"
    git fetch origin --tags --quiet
    $behindRaw = (git rev-list --count "HEAD..origin/$branch" 2>$null)
    $aheadRaw  = (git rev-list --count "origin/$branch..HEAD" 2>$null)
    $behind = if ($behindRaw) { $behindRaw.Trim() } else { "0" }
    $ahead  = if ($aheadRaw)  { $aheadRaw.Trim() }  else { "0" }
    if ($behind -ne "0") {
        Fail "Local branch is $behind commit(s) behind origin/$branch. Pull first."
    }
    Write-OK "up-to-date with origin (ahead=$ahead)"
}

if ((git tag --list $tag)) {
    Fail "Tag $tag already exists locally. Delete with 'git tag -d $tag' if this is a retry."
}
$remoteTag = (git ls-remote --tags origin $tag 2>$null)
if ($remoteTag) {
    Fail "Tag $tag already exists on origin. Pick a different version."
}
Write-OK "tag $tag is available"

# ---------------------------------------------------------------------------
# 2. Patch version strings
# ---------------------------------------------------------------------------

Write-Section "Bump version strings: $currentVersion -> $Version"

$cv = $currentVersion

# The patches we apply are all unambiguous literals.
$q = [char]0x22  # double-quote literal, used inside the search/replace strings below.
Invoke-Replace "backend\app\main.py"                      "version=$q$cv$q"            "version=$q$Version$q"            1 | Out-Null
Invoke-Replace "backend\app\main.py"                      "${q}version${q}: ${q}$cv$q" "${q}version${q}: ${q}$Version$q" 1 | Out-Null
Invoke-Replace "frontend\package.json"                    "${q}version${q}: ${q}$cv$q" "${q}version${q}: ${q}$Version$q" 1 | Out-Null
Invoke-Replace "frontend\src\components\Sidebar.tsx"      ">V $cv<"                     ">V $Version<"                     1 | Out-Null
Invoke-Replace "backend\app\api\routes\settings.py"       "${q}app_version${q}, ${q}$cv$q" "${q}app_version${q}, ${q}$Version$q" 1 | Out-Null
Invoke-Replace "backend\app\api\routes\settings.py"       "or ${q}$cv${q}"             "or ${q}$Version${q}"              1 | Out-Null
Invoke-Replace "backend\app\schemas\settings.py"          "version: str = ${q}$cv${q}" "version: str = ${q}$Version${q}"  1 | Out-Null

Write-OK "version literals patched"

# ---------------------------------------------------------------------------
# 3. CHANGELOG
# ---------------------------------------------------------------------------

Write-Section "CHANGELOG"

$changelogPath = Join-Path $PROJECT "CHANGELOG.md"
# UTF-8 read (see Invoke-Replace for why) — the CHANGELOG contains em-dashes
# and accented characters that would round-trip to mojibake on ANSI locales.
$changelogRaw  = Get-Content -Raw -Path $changelogPath -Encoding UTF8

if ($changelogRaw -match "## \[$([regex]::Escape($Version))\]") {
    Write-Host "  section for $Version already exists - leaving CHANGELOG untouched" -ForegroundColor DarkGray
} else {
    $notesBody = ""
    if ($NotesFile) {
        if (-not (Test-Path $NotesFile)) { Fail "NotesFile not found: $NotesFile" }
        $notesBody = Get-Content -Raw -Path $NotesFile -Encoding UTF8
    } elseif ($Notes) {
        $notesBody = $Notes
    } else {
        $notesBody = "_Release notes to fill in.  See commit log since v$currentVersion for changes._"
    }

    $today = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
    $newSection = "## [$Version] - $today`r`n`r`n$notesBody`r`n`r`n---`r`n"

    # Insert just after the first "---" line (that ends the intro block).
    $sep = "`n---`n"
    $idx = $changelogRaw.IndexOf($sep)
    if ($idx -lt 0) { Fail "Cannot locate '---' separator in CHANGELOG.md" }
    $insertAt = $idx + $sep.Length

    $new_changelog = $changelogRaw.Substring(0, $insertAt) + "`r`n" + $newSection + $changelogRaw.Substring($insertAt).TrimStart("`r", "`n")

    if ($DryRun) {
        Write-Host "  would prepend section:" -ForegroundColor DarkGray
        $newSection.Split("`n") | Select-Object -First 6 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Write-Host "    ..." -ForegroundColor DarkGray
    } else {
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($changelogPath, $new_changelog, $utf8NoBom)
        Write-OK "CHANGELOG section [$Version] prepended"
    }
}

# ---------------------------------------------------------------------------
# 4. Smoke build
# ---------------------------------------------------------------------------

if (-not $SkipBuild) {
    Write-Section "Smoke build (frontend)"
    if ($DryRun) {
        Write-Host "  would run: npx vite build" -ForegroundColor DarkGray
    } else {
        Push-Location (Join-Path $PROJECT "frontend")
        try {
            Write-Action "npx vite build"
            $env:NODE_OPTIONS = "--max-old-space-size=1536"

            # PS 5.1 gotcha: with $ErrorActionPreference = "Stop" a native
            # command writing anything on stderr (vite's progress/info lines
            # do!) gets wrapped in a NativeCommandError and aborts the script
            # before we can even check $LASTEXITCODE.  We lower the preference
            # just for the duration of the call and rely on $LASTEXITCODE for
            # the real pass/fail verdict.  The buffered output is printed in
            # full only if the exit code is non-zero, so a successful build
            # stays quiet.
            $prev_eap = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $buildOut = $null
            try {
                $buildOut = & npx vite build 2>&1
            } finally {
                $ErrorActionPreference = $prev_eap
            }
            if ($LASTEXITCODE -ne 0) {
                $buildOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
                Fail "Frontend build failed; aborting release"
            }
            Write-OK "vite build OK"
        } finally {
            Pop-Location
        }
    }
} else {
    Write-Section "Smoke build"
    Write-Host "  -SkipBuild set; relying on CI to catch build breakage" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 5. Commit + push
# ---------------------------------------------------------------------------

Write-Section "Commit + push"

if ($DryRun) {
    Write-Host "  would run: git add -A; git commit -m 'Bump version to $Version'; git push origin main" -ForegroundColor DarkGray
    Write-Host "  would run: git tag -a $tag -m 'ArkManiaGest $tag'; git push origin $tag" -ForegroundColor DarkGray
    Write-Section "DRY-RUN complete"
    exit 0
}

Write-Action "git add -A"
git add -A | Out-Null

Write-Action "git commit"
git commit -m "Bump version to $Version" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "git commit failed" }

Write-Action "git push origin main"
$pushOut = & git push origin main 2>&1
if ($LASTEXITCODE -ne 0) {
    $pushOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Fail "git push failed (see output above)"
}
Write-OK "commit pushed"

# ---------------------------------------------------------------------------
# 6. Tag + push tag
# ---------------------------------------------------------------------------

Write-Section "Tag + push tag"

Write-Action "git tag -a $tag"
git tag -a $tag -m "ArkManiaGest $tag" | Out-Null

Write-Action "git push origin $tag"
$pushTagOut = & git push origin $tag 2>&1
if ($LASTEXITCODE -ne 0) {
    $pushTagOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Fail "git push tag failed"
}
Write-OK "tag $tag pushed - GitHub Actions 'Release' workflow fires now"

# ---------------------------------------------------------------------------
# 7. Monitor workflow (optional)
# ---------------------------------------------------------------------------

if ($NoMonitor) {
    Write-Section "Done"
    Write-Host "  Skipping workflow monitor (-NoMonitor). Watch it at:" -ForegroundColor DarkGray
    Write-Host "    https://github.com/Mrtritolo/ArkManiaGest/actions" -ForegroundColor Cyan
    exit 0
}

Write-Section "Monitoring GitHub Actions"

$apiRoot = "https://api.github.com/repos/Mrtritolo/ArkManiaGest/actions/runs"
Write-Host "  Polling every 15 s (max 10 min)..." -ForegroundColor Gray

$deadline = (Get-Date).AddMinutes(10)
$runId    = $null
Start-Sleep -Seconds 5

while ((Get-Date) -lt $deadline) {
    try {
        $runs = Invoke-RestMethod -Uri "$apiRoot`?per_page=5" -ErrorAction Stop
    } catch {
        Write-Host "  ! GitHub API error: $_" -ForegroundColor Yellow
        Start-Sleep -Seconds 15
        continue
    }

    $run = $runs.workflow_runs | Where-Object {
        $_.name -eq "Release" -and $_.head_branch -eq $tag
    } | Select-Object -First 1

    if ($run) {
        $runId = $run.id
        $status = $run.status
        $conclusion = if ($run.conclusion) { $run.conclusion } else { "-" }
        $ts = Get-Date -Format HH:mm:ss
        Write-Host "    [$ts] status=$status conclusion=$conclusion" -ForegroundColor DarkGray
        if ($status -eq "completed") {
            if ($conclusion -eq "success") {
                Write-OK "workflow succeeded"
                break
            } else {
                Fail "Release workflow ended with conclusion=$conclusion`n    $($run.html_url)"
            }
        }
    } else {
        Write-Host "    waiting for the Release run to appear..." -ForegroundColor DarkGray
    }

    Start-Sleep -Seconds 15
}

if (-not $runId) {
    Fail "Timed out waiting for the Release workflow to complete. Check manually: https://github.com/Mrtritolo/ArkManiaGest/actions"
}

# ---------------------------------------------------------------------------
# 8. Fetch + print release details
# ---------------------------------------------------------------------------

Write-Section "Release published"

try {
    $rel = Invoke-RestMethod "https://api.github.com/repos/Mrtritolo/ArkManiaGest/releases/tags/$tag"
    Write-Host "  Name   : $($rel.name)" -ForegroundColor Green
    Write-Host "  URL    : $($rel.html_url)" -ForegroundColor Green
    Write-Host "  Draft  : $($rel.draft)  Prerelease: $($rel.prerelease)" -ForegroundColor Green
    Write-Host "  Assets :" -ForegroundColor Green
    foreach ($a in $rel.assets) {
        $mb = [math]::Round($a.size / 1MB, 2)
        Write-Host ("    - {0,-50} {1,7:N2} MB" -f $a.name, $mb) -ForegroundColor DarkGray
    }
} catch {
    Write-Host "  Could not fetch release details: $_" -ForegroundColor Yellow
    Write-Host "  Check manually: https://github.com/Mrtritolo/ArkManiaGest/releases/tag/$tag" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
