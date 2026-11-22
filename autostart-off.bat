@echo off
rem Disable Windows Startup autostart for Claude Studio (agy-claude-studio).
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = [Environment]::GetFolderPath('Startup'); $hit = $false;" ^
  "foreach ($n in @('Claude-Studio.lnk', 'Antigravity Claude Style.lnk')) { $p = Join-Path $s $n; if (Test-Path $p) { Remove-Item $p -Force; Write-Host ('Autostart disabled: ' + $p); $hit = $true } }" ^
  "if (-not $hit) { Write-Host 'Claude Studio (agy-claude-studio) autostart shortcut not found.' }"
pause
