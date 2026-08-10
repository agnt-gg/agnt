# Behavioural tests for build/installer.nsh.
#
# Compiles THE REAL installer.nsh into a silent harness exe and drives its
# macros against real directories, asserting what each guard actually does.
# PowerShell rather than batch for one load-bearing reason: NSIS executables
# are GUI-subsystem, and cmd.exe does not wait for GUI processes — the batch
# spelling of this runner raced its own verdict files. Start-Process -Wait
# is deterministic.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File run-tests.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$makensis = if ($env:MAKENSIS) { $env:MAKENSIS } else {
  Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis\nsis-3.0.4.1\Bin\makensis.exe'
}
if (-not (Test-Path $makensis)) { Write-Host "FATAL: makensis not found at $makensis"; exit 2 }

$sb = Join-Path $env:TEMP 'agnt-nsh-tests'
Remove-Item -Recurse -Force $sb -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $sb | Out-Null

$script:pass = 0
$script:fail = 0

function Check([string]$name, $got, $want) {
  if ("$got" -ceq "$want") { $script:pass++; Write-Host "  [PASS] $name" }
  else { $script:fail++; Write-Host "  [FAIL] $name  got=`"$got`" want=`"$want`"" }
}
function Alive([string]$name, [string]$path) {
  if (Test-Path $path) { $script:pass++; Write-Host "  [PASS] $name" }
  else { $script:fail++; Write-Host "  [FAIL] $name  -- MISSING: $path" }
}
function Gone([string]$name, [string]$path) {
  if (-not (Test-Path $path)) { $script:pass++; Write-Host "  [PASS] $name" }
  else { $script:fail++; Write-Host "  [FAIL] $name  -- STILL EXISTS: $path" }
}

# A faithful top-level Electron payload, per the classifier's contract.
function New-Payload([string]$dir) {
  New-Item -ItemType Directory -Path "$dir\resources" -Force | Out-Null
  New-Item -ItemType Directory -Path "$dir\locales" -Force | Out-Null
  Set-Content "$dir\resources\app.asar" 'a'
  Set-Content "$dir\locales\en-US.pak" 'l'
  foreach ($f in 'AGNT.exe','Uninstall AGNT.exe','ffmpeg.dll','chrome_100_percent.pak',
                 'icudtl.dat','snapshot_blob.bin','vk_swiftshader_icd.json',
                 'LICENSE.electron.txt','LICENSES.chromium.html','install.log') {
    Set-Content "$dir\$f" 'x'
  }
}

# Five things a human might keep next to their install. backup.dat and
# my-tool.exe are deliberate traps: .dat and .exe must NOT be wildcarded.
function New-Foreign([string]$dir) {
  New-Item -ItemType Directory -Path "$dir\projects" -Force | Out-Null
  New-Item -ItemType Directory -Path "$dir\repo" -Force | Out-Null
  Set-Content "$dir\projects\work.md" 'w'
  Set-Content "$dir\repo\x.txt" 'r'
  Set-Content "$dir\notes.md" 'n'
  Set-Content "$dir\my-tool.exe" 't'
  Set-Content "$dir\backup.dat" 'b'
}

function Invoke-Harness([string]$mode, [string]$dir, [string]$dest, [string]$out) {
  $args = @('/S', "/MODE=$mode", "/TDIR=$dir", "/TOUT=$out")
  if ($dest) { $args += "/TDEST=$dest" }
  $p = Start-Process -FilePath "$root\harness.exe" -ArgumentList $args -Wait -PassThru
  if ($p.ExitCode -ne 0) { return "EXIT=$($p.ExitCode)" }
  if (Test-Path $out) { return (Get-Content $out -Raw) }
  return 'NO-OUTPUT'
}

Write-Host 'Compiling harness against ..\installer.nsh ...'
& $makensis /V1 "$root\harness.nsi" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'FATAL: harness failed to compile'; exit 2 }

Write-Host ''
Write-Host '================================================================'
Write-Host '  installer.nsh - behavioural tests'
Write-Host '================================================================'

# ---------------- verify: may the installer target this dir? ------------
New-Payload "$sb\v-ourinstall"
New-Payload "$sb\v-upgrade"; New-Foreign "$sb\v-upgrade"
New-Item -ItemType Directory -Path "$sb\v-empty" | Out-Null
New-Item -ItemType Directory -Path "$sb\v-userdata\projects" -Force | Out-Null
Set-Content "$sb\v-userdata\notes.md" 'n'
New-Item -ItemType Directory -Path "$sb\v-uninstonly" | Out-Null
Set-Content "$sb\v-uninstonly\Uninstall AGNT.exe" 'x'

Check 'verify-missing: nonexistent dir is allowed'   (Invoke-Harness verify "$sb\v-does-not-exist" '' "$sb\o1") 'ALLOW'
Check 'verify-empty: empty dir is allowed'           (Invoke-Harness verify "$sb\v-empty"          '' "$sb\o2") 'ALLOW'
Check 'verify-userdata: dir with files is REFUSED'   (Invoke-Harness verify "$sb\v-userdata"       '' "$sb\o3") 'REFUSE'
Check 'verify-ourinstall: existing install allowed'  (Invoke-Harness verify "$sb\v-ourinstall"     '' "$sb\o4") 'ALLOW'
Check 'verify-upgrade: install+userdata allowed'     (Invoke-Harness verify "$sb\v-upgrade"        '' "$sb\o5") 'ALLOW'
Check 'verify-uninstonly: half-removed allowed'      (Invoke-Harness verify "$sb\v-uninstonly"     '' "$sb\o6") 'ALLOW'

# ---------------- count: foreign-entry census ---------------------------
New-Payload "$sb\c-mixed"; New-Foreign "$sb\c-mixed"
New-Payload "$sb\c-clean"

$got = Invoke-Harness count "$sb\c-mixed" '' "$sb\o7"
Check 'count-mixed finds 5 foreign entries' ($got -split '\|')[0] '5'
Check 'count-clean finds none' (Invoke-Harness count "$sb\c-clean" '' "$sb\o8") '0|'

# ---------------- move: rescue relocates foreign, leaves payload --------
New-Payload "$sb\m-src"; New-Foreign "$sb\m-src"

Check 'move reports 5 moved, 0 failed' (Invoke-Harness move "$sb\m-src" "$sb\m-dest" "$sb\o9") 'moved=5 failed=0'
Alive 'move: dest got projects'    "$sb\m-dest\projects\work.md"
Alive 'move: dest got notes'       "$sb\m-dest\notes.md"
Alive 'move: dest got user exe'    "$sb\m-dest\my-tool.exe"
Alive 'move: dest got backup.dat'  "$sb\m-dest\backup.dat"
Alive 'move: dest got repo'        "$sb\m-dest\repo\x.txt"
Alive 'move: src keeps AGNT.exe'   "$sb\m-src\AGNT.exe"
Alive 'move: src keeps resources'  "$sb\m-src\resources\app.asar"
Gone  'move: src lost projects'    "$sb\m-src\projects"

# ---------------- remove: surgical uninstall ----------------------------
New-Payload "$sb\r-mixed"; New-Foreign "$sb\r-mixed"

Check 'remove completes' (Invoke-Harness remove "$sb\r-mixed" '' "$sb\o10") 'removed'
foreach ($f in 'AGNT.exe','Uninstall AGNT.exe','ffmpeg.dll','chrome_100_percent.pak',
               'icudtl.dat','snapshot_blob.bin','vk_swiftshader_icd.json',
               'LICENSE.electron.txt','LICENSES.chromium.html','install.log',
               'resources','locales') {
  Gone "remove: '$f' deleted" "$sb\r-mixed\$f"
}
Alive 'remove: SURVIVES projects\work.md' "$sb\r-mixed\projects\work.md"
Alive 'remove: SURVIVES notes.md'         "$sb\r-mixed\notes.md"
Alive 'remove: SURVIVES my-tool.exe'      "$sb\r-mixed\my-tool.exe"
Alive 'remove: SURVIVES backup.dat'       "$sb\r-mixed\backup.dat"
Alive 'remove: SURVIVES repo\x.txt'       "$sb\r-mixed\repo\x.txt"
Alive 'remove: dir itself remains'        "$sb\r-mixed"

# ---------------- remove-clean: payload only, folder disappears ---------
New-Payload "$sb\rc"
Check 'remove-clean completes' (Invoke-Harness remove "$sb\rc" '' "$sb\o11") 'removed'
Gone 'remove-clean: whole dir removed' "$sb\rc"

Write-Host ''
Write-Host '----------------------------------------------------------------'
Write-Host "  passed=$($script:pass)  failed=$($script:fail)"
Write-Host '----------------------------------------------------------------'
exit $script:fail
