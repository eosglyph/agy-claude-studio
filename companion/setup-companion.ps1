param(
  [string]$AntigravityExe = '',
  [switch]$WithAutostart,
  [switch]$UpdateStartMenuIcon
)

$ErrorActionPreference = 'Stop'
$packDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installerExe = Join-Path $packDir 'installer.exe'
$icoSrc = Join-Path $packDir 'agy-gemini-clawd.ico'

if (-not (Test-Path -LiteralPath $installerExe)) { throw "未找到 installer.exe: $installerExe" }
if (-not (Test-Path -LiteralPath $icoSrc)) { throw "未找到图标文件: $icoSrc" }

function Find-AntigravityExe([string]$instExe) {
  $existingDir = Join-Path $env:LOCALAPPDATA 'agy-claude-studio'
  $existingPs1 = Join-Path $existingDir 'launch-antigravity.ps1'
  if (Test-Path -LiteralPath $existingPs1) {
    $ps1Raw = Get-Content -LiteralPath $existingPs1 -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($ps1Raw -match '\$antigravityExe\s*=\s*''((?:[^'']|'''')+)''') {
      $cand = $Matches[1] -replace "''", "'"
      if ($cand -and (Test-Path -LiteralPath $cand)) { return $cand }
    } elseif ($ps1Raw -match '\$antigravityExe\s*=\s*"([^"]+)"') {
      $cand = $Matches[1]
      if ($cand -and (Test-Path -LiteralPath $cand)) { return $cand }
    }
  }

  $existingVbs = Join-Path $existingDir 'launch-antigravity.vbs'
  if (Test-Path -LiteralPath $existingVbs) {
    $vbsRaw = Get-Content -LiteralPath $existingVbs -Raw -ErrorAction SilentlyContinue
    if ($vbsRaw) {
      foreach ($m in [regex]::Matches($vbsRaw, '"([^"\r\n]+Antigravity\.exe)"', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        $cand = $m.Groups[1].Value.Trim()
        if ($cand -and (Test-Path -LiteralPath $cand)) { return $cand }
      }
    }
  }

  $statusFile = Join-Path $env:TEMP ("agy-cs-status-" + [guid]::NewGuid().ToString('N') + ".json")
  try {
    Start-Process -FilePath $instExe -ArgumentList '--status', '--out', $statusFile -Wait
    if (Test-Path -LiteralPath $statusFile) {
      $st = Get-Content -LiteralPath $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($st.antigravityExe -and (Test-Path -LiteralPath $st.antigravityExe)) {
        return $st.antigravityExe
      }
    }
  } finally {
    if (Test-Path -LiteralPath $statusFile) { Remove-Item -LiteralPath $statusFile -Force -ErrorAction SilentlyContinue }
  }

  $proc = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc -and $proc.Path -and (Test-Path -LiteralPath $proc.Path)) { return $proc.Path }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'),
    (Join-Path $env:ProgramFiles 'Antigravity\Antigravity.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Antigravity\Antigravity.exe')
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($AntigravityExe)) {
  $AntigravityExe = Find-AntigravityExe $installerExe
}
if ([string]::IsNullOrWhiteSpace($AntigravityExe) -or -not (Test-Path -LiteralPath $AntigravityExe)) {
  throw "未自动检测到 Antigravity.exe，请通过参数指定路径，例如: -AntigravityExe 'D:\Path\To\Antigravity.exe'"
}

$installOut = Join-Path $env:TEMP ("agy-cs-install-" + [guid]::NewGuid().ToString('N') + ".json")
$installArgs = @('--silent', '--out', $installOut)
if (-not $WithAutostart) {
  $installArgs += '--no-autostart'
}

Write-Host "[1/4] 正在运行 installer.exe 安装 / 升级到 %LOCALAPPDATA%\agy-claude-studio ..."
Start-Process -FilePath $installerExe -ArgumentList $installArgs -Wait

if (-not (Test-Path -LiteralPath $installOut)) {
  throw "安装未生成结果文件: $installOut"
}
$res = Get-Content -LiteralPath $installOut -Raw -Encoding UTF8 | ConvertFrom-Json
Remove-Item -LiteralPath $installOut -Force -ErrorAction SilentlyContinue
if (-not $res.ok) {
  throw "安装失败: $($res.error)"
}

$installDir = $res.installDir
if (-not $installDir) { $installDir = Join-Path $env:LOCALAPPDATA 'agy-claude-studio' }
if (-not (Test-Path -LiteralPath $installDir)) { throw "未找到安装目录: $installDir" }

if ($res.preservedExistingConfig) {
  Write-Host "      已保留本机现有 config.json 用户配置"
} else {
  Write-Host "      已写入默认配置 config.json"
}

Write-Host "[2/4] 正在部署 Gemini AI 娘 × Clawd 图标、CDP 调试参数与自动退出监控脚本..."
$icoDest = Join-Path $installDir 'agy-gemini-clawd.ico'
Copy-Item -LiteralPath $icoSrc -Destination $icoDest -Force

$ps1Path = Join-Path $installDir 'launch-antigravity.ps1'
$escapedExe = $AntigravityExe -replace "'", "''"
$ps1Template = @'
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ForwardArgs
)

$ErrorActionPreference = 'SilentlyContinue'
$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$antigravityExe = '__ANTIGRAVITY_EXE__'
$watcherExe = Join-Path $installDir 'agy-claude-studio-watcher.exe'

$agArgs = @('--remote-debugging-port=0')
if ($ForwardArgs) {
  foreach ($a in $ForwardArgs) {
    if ($null -ne $a -and $a -ne '') {
      $agArgs += ('"' + ($a -replace '"', '\"') + '"')
    }
  }
}

Start-Process -FilePath $antigravityExe -ArgumentList $agArgs -WorkingDirectory (Split-Path $antigravityExe -Parent)

# If the native Antigravity plugin is installed and not explicitly disabled,
# let its MCP lifecycle host manage injection instead of running the legacy standalone watcher.
$nativePluginHost = Join-Path $env:USERPROFILE '.gemini\config\plugins\agy-claude-studio\plugin\mcp-host.js'
$nativePluginActive = $false
if (Test-Path -LiteralPath $nativePluginHost) {
  $nativePluginActive = $true
  $agyCfgPath = Join-Path $env:USERPROFILE '.gemini\config\config.json'
  if (Test-Path -LiteralPath $agyCfgPath) {
    try {
      $agyCfg = Get-Content -LiteralPath $agyCfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($agyCfg.plugins -and $agyCfg.plugins.'agy-claude-studio' -and $agyCfg.plugins.'agy-claude-studio'.enabled -eq $false) {
        $nativePluginActive = $false
      }
    } catch {}
  }
}
if ($nativePluginActive) {
  return
}

# Ensure watcher is running (watcher enforces single-instance via Mutex)
Start-Process -FilePath $watcherExe -ArgumentList '--watch', '--dir', "`"$installDir`"" -WorkingDirectory $installDir -WindowStyle Hidden

# Keep only one exit-monitor instance active across repeated shortcut clicks
$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\AGYClaudeStudioExitMonitor', [ref]$createdNew)
if (-not $createdNew) {
  return
}

try {
  # Wait up to 20s for Antigravity process to appear
  for ($i = 0; $i -lt 20; $i++) {
    if (Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue) { break }
    Start-Sleep -Seconds 1
  }

  # Poll until all Antigravity processes exit (confirmed twice to avoid transient handoffs)
  $emptyStreak = 0
  while ($true) {
    Start-Sleep -Seconds 3
    $procs = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue
    if ($procs) {
      $emptyStreak = 0
    } else {
      $emptyStreak++
      if ($emptyStreak -ge 2) { break }
    }
  }

  # Cleanly stop the watcher once Antigravity has exited
  Start-Process -FilePath $watcherExe -ArgumentList '--remove', '--dir', "`"$installDir`"" -WorkingDirectory $installDir -WindowStyle Hidden -Wait
} finally {
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
'@
$ps1Content = $ps1Template.Replace('__ANTIGRAVITY_EXE__', $escapedExe)
[System.IO.File]::WriteAllText($ps1Path, $ps1Content, [System.Text.UTF8Encoding]::new($false))

$vbsPath = Join-Path $installDir 'launch-antigravity.vbs'
$vbsContent = @'
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(dir, "launch-antigravity.ps1")
args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " """ & Replace(WScript.Arguments(i), """", """""") & """"
Next
shell.Run "powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """" & args, 0, False
'@
[System.IO.File]::WriteAllText($vbsPath, $vbsContent, [System.Text.Encoding]::Default)

Write-Host "[3/4] 正在注册 / 更新 Windows 应用卸载入口..."
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AGYClaudeStudio'
$selfExe = Join-Path $installDir 'agy-claude-studio-installer.exe'
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name 'DisplayName' -Value 'Claude Studio (Antigravity 界面增强补丁)'
Set-ItemProperty -Path $regPath -Name 'DisplayVersion' -Value '2.2.1'
Set-ItemProperty -Path $regPath -Name 'Publisher' -Value 'Claude Studio'
Set-ItemProperty -Path $regPath -Name 'InstallLocation' -Value $installDir
Set-ItemProperty -Path $regPath -Name 'DisplayIcon' -Value "$icoDest,0"
Set-ItemProperty -Path $regPath -Name 'UninstallString' -Value "`"$selfExe`" --uninstall"
Set-ItemProperty -Path $regPath -Name 'NoModify' -Value 1 -Type DWord
Set-ItemProperty -Path $regPath -Name 'NoRepair' -Value 1 -Type DWord

Write-Host "[4/4] 正在创建 / 更新桌面伴随启动快捷方式..."
$desktop = [Environment]::GetFolderPath('Desktop')
$wsh = New-Object -ComObject WScript.Shell
$matchedShortcuts = @()
foreach ($file in (Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -ErrorAction SilentlyContinue)) {
  try {
    $sc = $wsh.CreateShortcut($file.FullName)
    if ($sc.TargetPath -like '*\wscript.exe' -and $sc.Arguments -like '*launch-antigravity.vbs*') {
      $sc.Arguments = "`"$vbsPath`""
      $sc.WorkingDirectory = Split-Path $AntigravityExe -Parent
      $sc.IconLocation = "$icoDest,0"
      $sc.Save()
      $matchedShortcuts += $file.FullName
    }
  } catch {}
}

if ($matchedShortcuts.Count -eq 0) {
  $lnkPath = Join-Path $desktop 'Antigravity (Claude Style).lnk'
  $lnk = $wsh.CreateShortcut($lnkPath)
  $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $lnk.Arguments = "`"$vbsPath`""
  $lnk.WorkingDirectory = Split-Path $AntigravityExe -Parent
  $lnk.IconLocation = "$icoDest,0"
  $lnk.Description = 'Launch Antigravity Desktop with Claude Studio companion watcher'
  $lnk.Save()
  $matchedShortcuts += $lnkPath
}

$startMenuUpdated = $false
if ($UpdateStartMenuIcon) {
  $startMenuLnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Antigravity.lnk'
  if (Test-Path -LiteralPath $startMenuLnk) {
    $smSc = $wsh.CreateShortcut($startMenuLnk)
    $smSc.IconLocation = "$icoDest,0"
    $smSc.Save()
    $startMenuUpdated = $true
  }
}

Write-Host ""
Write-Host "安装 / 更新完成 (v2.2.1)！"
Write-Host "  Antigravity:   $AntigravityExe"
Write-Host "  安装目录:      $installDir"
Write-Host "  启动脚本:      $vbsPath"
Write-Host "  退出监控脚本:  $ps1Path"
Write-Host "  桌面快捷方式:  $($matchedShortcuts -join ', ')"
if ($UpdateStartMenuIcon) {
  Write-Host "  开始菜单图标:  $(if ($startMenuUpdated) { '已更新' } else { '未找到 Antigravity.lnk，已跳过' })"
}
Write-Host "  实时注入结果:  $($res.headline)"
Write-Host ""
Write-Host "重要提示：若当前 Antigravity 之前未使用 --remote-debugging-port=0 启动，或为启用“退出 Antigravity 自动关闭后台”，请先彻底退出 Antigravity（含系统托盘图标），再从桌面快捷方式重新打开。"
