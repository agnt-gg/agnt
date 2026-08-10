@echo off
REM =====================================================================
REM AGNT installer data-safety matrix. RUNS INSIDE WINDOWS SANDBOX ONLY.
REM
REM Driven by matrix.wsb: the host maps a staging folder to C:\gate
REM containing this script plus two installers:
REM   AGNT-OLD.exe  - a pre-guard build (blind RMDir /r uninstaller)
REM   AGNT-NEW.exe  - the build under test (surgical customRemoveFiles)
REM
REM Everything here is destructive by design; the whole VM evaporates when
REM the sandbox window closes. Results land in C:\gate\results\ which the
REM host reads back.
REM =====================================================================
setlocal enabledelayedexpansion
set GATE=C:\gate
set RES=%GATE%\results
mkdir "%RES%" 2>nul
set PASS=0
set FAIL=0

echo ===== AGNT installer matrix: %date% %time% > "%RES%\log.txt"

REM ---------------------------------------------------------------------
REM S1 - THE LOAD-BEARING TEST. Update-in-place with the NEW uninstaller:
REM user files inside the install dir must survive.
REM ---------------------------------------------------------------------
echo [S1] install NEW to C:\T1 ... >> "%RES%\log.txt"
start /wait "" "%GATE%\AGNT-NEW.exe" /S /D=C:\T1
if not exist "C:\T1\AGNT.exe" (echo S1-SETUP-FAIL: first install produced no AGNT.exe >> "%RES%\log.txt" & set /a FAIL+=1 & goto s2)

mkdir C:\T1\projects
echo my work > C:\T1\projects\work.md
echo my notes > C:\T1\notes.md
echo user tool > C:\T1\my-tool.exe

echo [S1] reinstall NEW over C:\T1 (isUpdated path, NEW surgical uninstaller) ... >> "%RES%\log.txt"
start /wait "" "%GATE%\AGNT-NEW.exe" /S /D=C:\T1

set S1=PASS
if not exist "C:\T1\projects\work.md" set S1=FAIL-lost-projects
if not exist "C:\T1\notes.md"         set S1=FAIL-lost-notes
if not exist "C:\T1\my-tool.exe"      set S1=FAIL-lost-user-exe
if not exist "C:\T1\AGNT.exe"         set S1=FAIL-app-missing
echo S1 update-preserves-user-files: !S1! >> "%RES%\log.txt"
if "!S1!"=="PASS" (set /a PASS+=1) else (set /a FAIL+=1)

:s2
REM ---------------------------------------------------------------------
REM S2 - Full uninstall: payload removed, user files left standing.
REM ---------------------------------------------------------------------
echo [S2] uninstall C:\T1 ... >> "%RES%\log.txt"
if exist "C:\T1\Uninstall AGNT.exe" (
  start /wait "" "C:\T1\Uninstall AGNT.exe" /S _?=C:\T1
  set S2=PASS
  if not exist "C:\T1\projects\work.md" set S2=FAIL-lost-projects
  if not exist "C:\T1\notes.md"         set S2=FAIL-lost-notes
  if exist "C:\T1\AGNT.exe"             set S2=FAIL-app-still-there
  if exist "C:\T1\resources"            set S2=FAIL-resources-still-there
) else (
  set S2=SKIP-no-uninstaller
)
echo S2 uninstall-preserves-user-files: !S2! >> "%RES%\log.txt"
if "!S2!"=="PASS" (set /a PASS+=1) else (set /a FAIL+=1)

REM ---------------------------------------------------------------------
REM S3 - DOCUMENTATION, NOT A GATE: the old-to-new SILENT transition.
REM The uninstaller that runs during this update is the OLD, blind one;
REM the rescue prompt is GUI-only. Silent old-to-new is therefore expected
REM to lose files - this scenario RECORDS the actual outcome so the release
REM notes state a fact rather than a guess. Not counted in pass/fail.
REM ---------------------------------------------------------------------
echo [S3] install OLD to C:\T3 ... >> "%RES%\log.txt"
start /wait "" "%GATE%\AGNT-OLD.exe" /S /D=C:\T3
if not exist "C:\T3\AGNT.exe" (echo S3-SETUP-FAIL: old install produced no AGNT.exe >> "%RES%\log.txt" & goto finish)
mkdir C:\T3\projects
echo old work > C:\T3\projects\work.md

echo [S3] silent update OLD to NEW over C:\T3 ... >> "%RES%\log.txt"
start /wait "" "%GATE%\AGNT-NEW.exe" /S /D=C:\T3
if exist "C:\T3\projects\work.md" (
  echo S3 old-to-new-silent: FILES SURVIVED [unexpected but welcome] >> "%RES%\log.txt"
) else (
  echo S3 old-to-new-silent: FILES LOST [expected - old blind uninstaller; GUI rescue is the mitigation] >> "%RES%\log.txt"
)

:finish
echo. >> "%RES%\log.txt"
echo ===== gated: passed=%PASS% failed=%FAIL% ===== >> "%RES%\log.txt"
echo %FAIL% > "%RES%\failcount.txt"
echo done > "%RES%\DONE.txt"
