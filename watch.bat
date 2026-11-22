@echo off
rem Start the Claude Studio (agy-claude-studio) background watcher (no console window). Stop it with remove.bat.
start "" /b wscript.exe "%~dp0watch-hidden.vbs"
echo Claude Studio (agy-claude-studio) watcher started. Log: %~dp0watch.log
timeout /t 2 >nul 2>&1
