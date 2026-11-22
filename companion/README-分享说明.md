# Claude Studio · Windows 伴随启动定制包 (`v2.1.0`)

本发布包基于 [eosglyph/agy-claude-studio](https://github.com/eosglyph/agy-claude-studio) `v2.1.0`（Forked from `0DNANCY/agy-claude-style`）扩展编译，集成了以下核心增强：

1. **自定义 Gemini AI 娘 × Clawd 透明图标与伴随启动**
   - 附带多分辨率（`16~256px`）`agy-gemini-clawd.ico`，默认关闭开机自启（`--no-autostart`），点击桌面快捷方式时随用随启；若本机已启用原生插件则自动退让，仅负责带 CDP 启动。
2. **Antigravity `2.33.0+` CDP 端口失效修复**
   - 启动脚本默认附带 `--remote-debugging-port=0` 参数，解决新版本客户端默认不再开启调试端口导致的注入失效问题。
3. **退出 Antigravity 自动关闭后台（不留常驻进程）**
   - `launch-antigravity.vbs` 静默拉起 `launch-antigravity.ps1`，在 `Antigravity` 主进程与系统托盘彻底退出约 6 秒后自动执行 `agy-claude-studio-watcher.exe --remove` 停掉后台守护并退出。
4. **Gemini 4 元素周期表模型选择器 & 60fps Codex 思考强度滑块**
   - 底部模型名左侧新增 Gemini 四角星入口，弹出 AI Studio 同款磨砂玻璃元素周期表，支持搜索筛选、悬停查看定位/计费/余量、`Effort` 档位切换与「同步新元素」；思考强度滑块默认启用丝滑 60fps ChatGPT Codex 星云进度条。
5. **纯色主题 + 独立毛玻璃质感 + Swarm / 2.33.1 完整 5 语言本地化**
   - 内置 `Claude 暖灰` / `黑曜石` / `宿主原生` 3 套深浅自适应纯色配色与独立可开关的 `毛玻璃质感`（浮层磨砂高光边框、看图悬浮胶囊与聚焦柔光环），覆盖主窗口与 Swarm 蜂群侧栏 5 语言热切，并与推荐搭档插件 [antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor) 零冲突协同。

---

## 包含文件
- `installer.exe`：独立 Windows 安装器（内置完整 UI 美化与 `agy-claude-studio-watcher.exe`）。
- `agy-gemini-clawd.ico` / `agy-gemini-clawd.png`：定制 Gemini AI 娘 × Clawd 图标。
- `setup-companion.ps1`：一键安装 / 无损升级脚本（自动识别本机 `Antigravity.exe` 路径、保留现有 `config.json`）。

---

## 全新安装与无损升级（PowerShell）

解压后在目录内执行：
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-companion.ps1
```

可选参数：
- **手动指定 `Antigravity.exe` 路径**：
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-companion.ps1 -AntigravityExe "你的路径\Antigravity.exe"
  ```
- **同时替换开始菜单 / 任务栏运行中图标**：
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-companion.ps1 -UpdateStartMenuIcon
  ```
- **保留开机自启**：追加 `-WithAutostart`。

> **升级说明**：脚本会自动复用你原来的 `Antigravity.exe` 路径与桌面快捷方式（即使已重命名为 `Gemini` 也不会重复新建），并自动保留 `%LOCALAPPDATA%\agy-claude-studio\config.json` 个人设置。运行完成后请**彻底退出 Antigravity（含系统托盘）并用桌面快捷方式重新打开**，即可同时启用新功能、`2.33.0+` CDP 修复与退出自动清理后台。

---

## 推荐搭档

推荐同时在 Antigravity 中安装 [yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor)（GPLv3），与本插件零冲突互补：可实时查看输出速度、首字延迟、费用估算、上下文拆解与多模型额度池余量，配合本插件原生右侧控制面板可一键跳转与切会话自动展开。

---

## 卸载方法
1. 在 Windows **「设置 → 应用 → 已安装的应用」** 中找到 **Claude Studio (Antigravity 界面增强补丁)** 直接卸载。
2. 删除桌面上对应的快捷方式即可。
