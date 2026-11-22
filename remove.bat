@echo off
chcp 65001 >nul
rem Stop the Claude Studio (agy-claude-studio) watcher and restore Antigravity UI.
echo Removing Claude Studio (agy-claude-studio)...
node "%~dp0remove.js"
pause
