@echo off
setlocal enabledelayedexpansion
rem Launch Antigravity with CDP remote debugging enabled (--remote-debugging-port=0)
rem and start the Claude Studio watcher (managed exit-on-close by default, or --daemon).
rem Usage: launch.bat [--relaunch] [--daemon]
cd /d "%~dp0"

set "DAEMON=0"
set "LAUNCH_ARGS="

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--daemon" (
  set "DAEMON=1"
) else (
  set "LAUNCH_ARGS=!LAUNCH_ARGS! %1"
)
shift
goto parse_args

:args_done
node "%~dp0inject.js" --launch!LAUNCH_ARGS!
if errorlevel 1 (
  echo.
  echo [Tip] If Antigravity is already running without CDP, run: launch.bat --relaunch
  pause
  exit /b 1
)

if "!DAEMON!"=="1" (
  start "" /b wscript.exe "%~dp0watch-hidden.vbs" --watch --replace
  echo Claude Studio launched with CDP enabled ^(daemon watcher mode^). Log: %~dp0watch.log
) else (
  start "" /b wscript.exe "%~dp0watch-hidden.vbs" --watch --exit-on-host-close --skip-if-running
  echo Claude Studio launched with CDP enabled ^(managed mode: watcher exits when Antigravity closes^). Log: %~dp0watch.log
)
timeout /t 2 >nul 2>&1
