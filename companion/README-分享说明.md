# AGY Claude Style · Gemini 定制增强包 (`v1.3.0`)

本发布包基于 [0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style) `v1.0.0` 编译，并在上游基础上合入了以下 5 项实用增强：

1. **自定义 Gemini AI 娘 × Clawd 透明图标与伴随启动**
   - 附带多分辨率（`16~256px`）`agy-gemini-clawd.ico`，默认关闭开机自启（`--no-autostart`），点击桌面快捷方式时随用随启。
2. **Antigravity `2.32.2+` CDP 失效修复**
   - 启动脚本默认附带 `--remote-debugging-port=0` 参数，解决新版本客户端默认不再开启调试端口导致的注入失效问题。
3. **退出 Antigravity 自动关闭后台（不留常驻进程）**
   - `launch-antigravity.vbs` 静默拉起 `launch-antigravity.ps1`，在 `Antigravity` 主进程与系统托盘彻底退出约 6 秒后自动执行 `agy-claude-style-watcher.exe --remove` 停掉后台守护并退出。
4. **Gemini 4 元素周期表模型选择器（AI Studio 同款悬浮卡）**
   - 在底部模型名称左侧加入 Gemini 四角星图标按钮：点击弹出磨砂玻璃悬浮周期表卡片，支持按全部 / Gemini / Orchestrator / Claude 搜索筛选、悬停查看模型定位与计费信息、`Effort` 推理强度直选、`6 C`（Carbon）订阅限制标识，以及右上角 **「同步新元素」** 一键填入提示词让 Gemini 去 AI Studio 自动抓取新模型。
5. **9 套双模极光毛玻璃主题 + 顶部栏主题切换胶囊（参考 `SeredenFei/agy-claude-style` & `MCRYII/antigravity-custom-themes`）**
   - 在原版 `obsidian` / `claude` / `host` 外新增 6 套深浅自适应极光毛玻璃主题（`gemini` / `sky` / `cyan` / `orange` / `red` / `purple`），顶部工具栏新增一键切换胶囊并联动标题栏配色与终端背景兼容；同步包含 macOS 守护进程内存/端口泄漏修复与 Linux 构建支持。

---

## 包含文件
- `installer.exe`：独立 Windows 安装器（内置完整 UI 美化与 `agy-claude-style-watcher.exe`）。
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

> **升级说明（针对已安装初版图标包的用户）**：脚本会自动复用你原来的 `Antigravity.exe` 路径与桌面快捷方式（即使你已将快捷方式重命名为 `Gemini` 也不会重复新建），并自动保留 `%LOCALAPPDATA%\agy-claude-style\config.json` 个人设置。运行完成后请**彻底退出 Antigravity（含系统托盘）并用桌面快捷方式重新打开**，即可同时启用新功能、`2.32.2+` 修复与退出自动清理后台。

---

## 卸载方法
1. 在 Windows **「设置 → 应用 → 已安装的应用」** 中找到 **AGY Claude Style (Antigravity 界面增强补丁)** 直接卸载。
2. 删除桌面上对应的快捷方式即可。
