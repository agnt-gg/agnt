@echo off
REM Thin wrapper. The real runner is run-tests.ps1 — PowerShell because NSIS
REM executables are GUI-subsystem and cmd.exe does not wait for GUI processes,
REM which made a pure-batch runner race its own verdict files.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-tests.ps1"
exit /b %errorlevel%
