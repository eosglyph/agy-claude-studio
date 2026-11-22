@echo off
chcp 65001 >nul
rem Inject Claude Studio (agy-claude-studio) into Antigravity windows once.
echo Injecting Claude Studio (agy-claude-studio)...
node "%~dp0inject.js"
pause
