@echo off
rem Enable Windows Startup autostart for Claude Studio (agy-claude-studio).
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Claude-Studio.lnk';" ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk);" ^
  "$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe';" ^
  "$s.Arguments = '\"%~dp0watch-hidden.vbs\"';" ^
  "$s.WorkingDirectory = '%~dp0'.TrimEnd('\');" ^
  "$s.Description = 'Claude Studio (agy-claude-studio) watcher';" ^
  "$s.Save(); Write-Host ('Autostart enabled: ' + $lnk)"
pause
