<div align="center">

<img src="assets/clawd-banner.svg" alt="Claude Studio Banner" width="840" />

# Claude Studio

**`agy-claude-studio`** — 给 **Google Antigravity 2.33.1+（全面适配 v2.35.x）** 换上一套顺手、好看的界面与效率小工具

Claude 暖灰与黑曜石配色 · 3-Tab 右侧控制室（对话 / 工具 / 设置） · 长任务手机推送 · Gemini 4 元素周期表直连同步 · 4 项内置技能 · 像素小螃蟹 Clawd

<p>
  <img src="https://img.shields.io/badge/Antigravity-2.33.1%2B%20%7C%202.35.x-18181b?style=flat-square" alt="Antigravity 2.33.1+ / 2.35.x" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-18181b?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Zero_Deps-Node_22%2B-2f855a?style=flat-square" alt="Zero Deps Node 22+" />
  <img src="https://img.shields.io/badge/i18n-5_Languages-3b82f6?style=flat-square" alt="5 Languages" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-d97757?style=flat-square" alt="MIT License" /></a>
</p>

<p>
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

[预览](#预览) · [特性](#核心特性) · [快速安装](#快速安装) · [推荐搭档](#推荐搭档) · [配置参考](#配置参考) · [常见问题](#常见问题) · [致谢](#致谢与开源协议)

</div>

---

> **关于本项目**：`Claude Studio` (`agy-claude-studio`) 是基于 [0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style) `v2.1.0` 独立演进的社区定制版，通过 Antigravity 内置 **Chrome DevTools Protocol (CDP)** 无损动态注入——**不修改宿主安装文件、不向模型发送额外上下文**，随时可一键还原原生界面。

---

<a id="预览"></a>
## 预览

<div align="center">

#### 全局实景（Claude 暖灰主题 + 极简 3-Tab 侧边栏 + 实时运行状态）
<img src="assets/screenshots/studio-overview.png" alt="Claude Studio Full Workspace Overview" width="880" />

<br/>

#### Gemini 4 元素周期表模型选择器
<img src="assets/screenshots/periodic-selector.png" alt="Gemini 4 Periodic Table Model Selector" width="760" />

<br/>

#### 60fps 思考强度滑块 & 极简输入框
<img src="assets/screenshots/effort-slider.png" alt="Effort Slider and Restyled Composer" width="760" />

<br/>

#### 右侧「Claude Studio」工具页 ×「用量监控」双栏协同
<table>
  <tr>
    <td align="center" width="50%">
      <img src="assets/screenshots/studio-panel.png" alt="Claude Studio Control Panel" width="308" /><br/>
      <sub><b>Claude Studio 工具页</b>：一键检查与原地升级、手机推送卡片、本地脚本工具箱与宽屏 Markdown 结果展示</sub>
    </td>
    <td align="center" width="50%">
      <img src="assets/screenshots/usage-monitor-pair.png" alt="Usage Monitor Companion" width="308" /><br/>
      <sub><b>Usage Monitor 搭档面板</b>：支持三态右侧栏常驻选择（Studio / 用量监控 / 关闭）与底栏胶囊智能拆分</sub>
    </td>
  </tr>
</table>

</div>

---

<a id="核心特性"></a>
## 核心特性

简单聊聊 `Claude Studio` 给 Antigravity 加了哪些顺手的小功能——全部通过 CDP 在内存里动态注入，既不改动安装目录里的原文件，想退回原版也随时一键还原。

### 3-Tab 右侧面板（`对话 | 工具 | 设置`）
右侧辅助栏换成了清爽的扁平三栏设计。顶栏做得很紧凑，就算把侧栏拉窄，冗余信息也会自动收起保持单行；右上角还自带**一键检查与原地升级**按钮，不管你是 Git 克隆还是安装包释放，点一下就能更新，本地配置和脚本都会原封不动留着。
- **「对话」页**：把当前工作区路径、Git 分支、连着的外部工具，以及按类别拆解的上下文占用（系统提示词、MCP 工具、技能、规则和对话历史）直接摊在眼前；最底下还有实时任务进度条，能看到等待首字、推理状态、正在跑的命令，点开还能看子代理列表。
- **「工具」页**：专门用来跑本机的 Node / Python / Shell 脚本，装好后默认带了一个 Antigravity 官方更新日志查询脚本。脚本跑完后，结果会**直接在对话区上方弹出宽屏 Markdown 卡片**，读起来很舒服——这只是本地渲染展示，不会发给模型触发回复；侧边栏里也可以随时收起/展开保留日志，或者点「宽屏」再把卡片呼出来。
- **「设置」页**：主题、排版、思考滑块风格、语言包和 HUD 开关都能实时勾选、自动保存。

### 对话区文件链接右键菜单
聊天时 AI 贴出来的本地文件链接或者文件提及胶囊，现在直接右键就能操作：
- **打开文件**：用系统默认应用打开（只对安全的文档、代码和媒体文件放行）。
- **在文件夹中显示**：Windows 下会优先直接调原生资源管理器（`explorer.exe /select`）快速选中文件，遇到带逗号等特殊路径也会通过专有助手稳妥兜底；macOS 下则在 Finder 里高亮定位。
- **复制完整路径**：一键把完整路径放进剪贴板。

不需要的话，在设置里把 `fileLinkContextMenu` 关掉就行。

### 手机推送提醒
有时候让 AI 跑个长重构或者批量任务，人走开倒杯水，任务跑完或报错了可以直接由本地发条消息到手机：
- **支持 8 种渠道**：Server酱（支持约 28KB 完整 Markdown 正文）、Bark（iOS）、ntfy、飞书、钉钉、企业微信、Telegram Bot 和自定义 Webhook。
- **不会乱发消息**：默认跑满 3 分钟以上的任务才推（几秒钟的短问答不打扰），出错立刻提醒，手动点取消的话也会保持安静。
- 密钥和 Webhook 地址只保存在本机的 `PLUGIN_DATA/notify.json` 里，不会写进 `config.json`，也不会注入到页面中。

### 模型选择、思考强度与 `/compact`
- **Gemini 4 元素周期表**：把模型按档位和能力排成一张直观的元素周期表，还能直接连 Google AI Studio 同步最新上线的模型和对应配色，不用等客户端发版。
- **协作模式（Orchestrator）快捷开关**：直接放在底栏模型名旁边，一键切换标准模式和协作模式；重启后会记住你的选择，对话跑起来时会自动锁定，防止误触。
- **60fps 思考强度滑块**：提供 ChatGPT 和 Claude 两种样式，拖动跟手，还有细腻的颜色过渡。
- **`/compact` 快捷预设**：在输入框敲 `/compact` 会自动弹出 4 套预设（**留空** `empty`、**精简降噪** `clean`【默认】、**开发交接** `dev`、**自定义** `custom`）。选好后只是把提示词填进输入框方便你微调，不会直接帮你发出去。

### 多语言与插件市场翻译
- **完整适配 Antigravity `v2.35.2`**：不管是主界面、各种弹窗还是 **`/swarm` 蜂群侧栏**，都能实时汉化。
- **按需下载语言包**：简体中文、繁体中文和英文直接内置；粤语（`yue`）和日语（`ja`）会在切换时按需从云端拉取并做 SHA-256 校验，省得基础安装包太大。
- **插件市场按需翻译小胶囊**：逛插件市场看英文介绍时，旁边会多出一个小胶囊——平时完全不发网络请求，点一下才帮你翻；主源限流了会自动切备用源，再点一下就能切回原文。引擎也会遵守 `translate="no"`、`.notranslate`、云端保护名单和你的自定义 CSS 忽略规则。

### 外观微调、加载动效与小螃蟹 Clawd
- **主题与细节**：内置 `claude` 暖灰、`obsidian` 深黑和跟随宿主的 `host` 三套配色，可以自由搭配毛玻璃边框、左上角 Logo 着色、中文输入法友好的丝滑光标，以及带交互水波纹的 Studio 首页。
- **加载动效（Gemini发现了新玩具）**（`geminiLoader`）：在「设置 → 界面微调」里打开后，可以把原来那个大号加载转圈换成可爱的 Gemini 娘和头顶的 12 刻度环。
- **像素小螃蟹 Clawd**：蹲在输入框边上的小跟班，会随 AI 的思考、输出、报错或完成状态切换动作。平时可以轻戳让它扭头、连点 4 下挠痒、按住拎起来晃两下，闲着没事还会打盹；问答卡片或排队栏弹出来时它也会自己挪开让路。

### 4 项内置技能
装好插件后，直接在对话框里就能呼唤这 4 个小向导：
- **`studio-setup`**：花 30 秒带你过一遍基础偏好设置。
- **`studio-doctor`**：帮你检查 CDP 连接、权限和后台进程，顺手修掉常见小毛病。
- **`studio-notify`**：一步步带你配好手机推送并测试发送。
- **`studio-translation-protect`**：帮你把不想被翻译的界面元素加进忽略名单。

---

<a id="推荐搭档"></a>
## 推荐搭档：`antigravity-usage-monitor`

`Claude Studio` 专注**视觉美学、交互打磨、会话实时检视与本地化**；如需实时速率（`tok/s`）、首字延迟（TTFT）、费用核算与多模型配额池，推荐搭配独立开源插件 **[yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor)**：

- **零冲突共存**：内置轻量 HUD 默认仅开启顶部精简条（`usageStatsEnabled: true`、`hudTopBar: true`、`hudBottomBar: false`、`hudRimProgress: false`），搭配外部用量监控时可随时在设置中一键关闭内置用量模块；翻译引擎通过内置保护名单永久避让 `#ag-usage-monitor-*` 节点，两者互不打扰。
- **底栏智能拆分**：当 `usage-monitor` 停靠在输入框底栏时，自动将其上下文进度环镜像至最右侧，避免两个组件互相挤压或引起界面抖动。
- **右侧栏三态常驻（`pinRightPane`）**：可在设置中按需选择 `关闭` / `Studio 对话面板`（默认） / `用量监控`；此前保存的旧版设置会自动平滑迁移，未安装搭档插件时也会智能回退到 Studio 面板。
- **协议边界清晰**：本项目遵循宽松的 MIT 协议，`antigravity-usage-monitor` 遵循 GPLv3 协议，两者严格解耦、各自独立安装。

---

<a id="快速安装"></a>
## 快速安装

### 环境要求
- **Google Antigravity Desktop `2.33.1+`**（全面适配 `2.35.x`，支持 Windows / macOS），启动时需开启 CDP 参数 `--remote-debugging-port=0`。
- **Node.js `>= 22`**（纯原生代码，零第三方 npm 依赖，仅使用内置 `fetch`、`WebSocket` 与 `node:test`）。

### 最省心方式：直接发给 Antigravity 里的 Gemini（推荐）

不用自己敲命令，直接在 Antigravity 对话框里发给 Gemini 即可：

**首次安装**：
> **帮我安装这个 Antigravity 插件：`https://github.com/eosglyph/agy-claude-studio`**

**旧版本升级与迁移**（如果本机此前已安装旧版或发过指定升级指令，直接发这句）：
> **请按 GitHub 仓库 `https://github.com/eosglyph/agy-claude-studio` 的 README.zh-CN.md（升级与旧版迁移核对清单）和最新 Release 说明，帮我把本机 Claude Studio 升级/迁移到最新版**

> **可选 · 截图同款双栏体验**：想一步到位配齐右侧「用量监控」搭档插件（独立开源，GPLv3），直接发：
>
> **帮我安装 `https://github.com/eosglyph/agy-claude-studio` 以及推荐搭档 `https://github.com/yuhuan-dev/antigravity-usage-monitor`**

安装启用后，还可以直接对 Gemini 说：
- *「带我 30 秒完成 Claude Studio 初始偏好配置」*（唤起 `studio-setup` 技能）
- *「帮我配置任务完成时的手机微信/iOS 推送提醒」*（唤起 `studio-notify` 技能）
- *「帮我诊断 Claude Studio 运行状态」*（唤起 `studio-doctor` 技能）

### 升级与旧版迁移核对清单

无论是升级更新还是由 AI 助手协助从旧版 `v2.1` / `v2.2` / `agy-claude-style` 迁移，请按以下要点核对：

1. **保留本地个人数据**：
   升级时完整保留 `~/.gemini/antigravity/plugin_data/agy-claude-studio/` 下的所有个人数据，包括 `config.json`（偏好设置）、`notify.json`（手机推送凭据）、`notify-state.json`（通知状态）、`scripts.json`（自定义脚本列表）、`i18n-packs/`（按需语言包缓存）以及 `scripts/ops/` 中的自定义脚本；首次从更早版本迁移时，插件会自动将遗留的 `plugin_data/agy-claude-style/config.json` 平滑迁移至新目录。
2. **旧版后台守护与残留排查（Windows 环境）**：
   - Windows 用户直接运行最新版 `.exe` 安装器即可自动完成旧版检测、遗留守护清理与平滑迁移。
   - 若手动升级或由 AI 助手协助迁移：请注意，仅更新插件目录源码**不会**自动关闭旧目录（如 `%LOCALAPPDATA%\agy-claude-style`）中仍在运行的遗留守护进程 `agy-claude-style-watcher.exe`。
   - 升级前请先执行只读检查，确认后台是否存在 `agy-claude-style-watcher` 进程或旧版开机自启/卸载项。若存在，请在**征得用户确认后**通过旧版卸载入口关闭自启并确保旧进程彻底退出，再启用新版 `Claude Studio`（新版已深度接入宿主生命周期，在插件管理中关闭开关即可自动停注还原，不留孤儿进程）。
3. **启用与快速生效**：
   若 Antigravity 已携带 `--remote-debugging-port=0` 运行，可在插件目录下执行 `node inject.js` 热刷新（**切勿未经用户确认强杀正在运行的 Antigravity 进程**）；完成后可运行 `studio-doctor` 技能进行环境自检。

### 方式一：Windows 一键原生插件安装器（推荐 Windows 用户）

直接在 [GitHub Releases](https://github.com/eosglyph/agy-claude-studio/releases) 下载 `Claude-Studio-v<version>-Windows-x64.exe`：
- 双击运行即可自动检测并清理旧版 `v2.1.0 / v2.2.0 / v2.2.1` 遗留守护进程与旧版插件，完整保留并迁移 `plugin_data/` 配置和自定义脚本。
- 将完整原生插件释放至 `%USERPROFILE%\.gemini\config\plugins\agy-claude-studio` 并在宿主配置中自动启用。
- 自动生成带有 **Gemini × Clawd 定制图标** 的桌面与开始菜单快捷方式（直连带 `--remote-debugging-port=0` 的 Antigravity）。
- 支持在 Windows「设置 → 应用」中一键干净卸载还原。

### 方式二：通用插件包（macOS / Linux / 离线安装）

在 Releases 中下载跨平台通用插件包 `Claude-Studio-v<version>-plugin.zip`（不再随 Release 预构建 `.dmg` 镜像）：
- 解压到 `~/.gemini/config/plugins/`（形成 `~/.gemini/config/plugins/agy-claude-studio` 目录）。
- 携带 `--remote-debugging-port=0` 重新启动 Antigravity，并在 **Customizations → Plugins** 中确认启用即可。
> **平台说明**：维护者目前没有 Mac 真机测试环境，macOS 与 Linux 用户推荐直接使用通用插件包或发给 Antigravity 里的 Gemini 自动安装，非常欢迎真机环境下的反馈与 PR！

<details>
<summary><b>方式三：Antigravity 原生插件模式（手动 Git 克隆）</b></summary>

1. 将仓库克隆到 Antigravity 插件目录：
   ```powershell
   # Windows (PowerShell)
   git clone https://github.com/eosglyph/agy-claude-studio.git "$env:USERPROFILE\.gemini\config\plugins\agy-claude-studio"
   ```
   ```bash
   # macOS / Linux
   git clone https://github.com/eosglyph/agy-claude-studio.git "$HOME/.gemini/config/plugins/agy-claude-studio"
   ```
2. 彻底退出 Antigravity（含系统托盘），以 `--remote-debugging-port=0` 重新启动（或直接运行仓库内的 `launch.bat` / `./launch.sh`）。
3. 在 Antigravity **Customizations → Plugins** 中确认 **`Claude Studio`** 已启用，即可自动注入并在右侧辅助栏打开 **Claude Studio** 控制面板。

</details>

<details>
<summary><b>本地构建 Windows 原生安装器 / 伴随启动包</b></summary>

- **构建 Windows 原生插件安装器与通用插件包**：
  ```bash
  npm run build:installer
  # 或同时生成跨平台 plugin.zip
  node scripts/build-installer.mjs --plugin-zip dist/Claude-Studio-plugin.zip
  ```

- **Windows 伴随启动包（含 Gemini × Clawd 定制图标）**：
  ```powershell
  npm run build:release
  powershell -NoProfile -ExecutionPolicy Bypass -File .\companion\setup-companion.ps1
  ```
  若本机已启用原生插件，伴随启动脚本会自动退让，仅负责以 `--remote-debugging-port=0` 和定制图标启动 Antigravity。

</details>

<details>
<summary><b>Node.js CLI 尝鲜 / 本地开发模式</b></summary>

```bash
cp config.example.json config.json   # 可选，默认使用内置配置
npm run inject                        # 单次注入当前窗口
npm run watch                         # 后台热更新守护（修改代码/配置自动生效）
npm run remove                        # 停止守护并无损还原原生界面
```

</details>

---

## 小螃蟹 Clawd 互动速览

<div align="center">
  <img src="assets/clawd-moods.svg" alt="Clawd Pixel Moods" width="840" />
</div>

| 互动 | 操作方式 | 表现 |
| --- | --- | --- |
| 轻戳 | 单击左侧或右侧身体 | 害羞扭头反馈（`poke-left` / `poke-right`） |
| 挠痒 | `450ms` 内连点 4 下 | 爆笑踢腿（`tickle`） |
| 拎起 | 按住鼠标左键拖拽 | 悬空挣扎，松手落地（`drag`） |
| 小憩 | 界面安静 60 秒以上 | 自动打盹（`sleeping`），点击或发消息伸懒腰唤醒（`waking`） |
| 状态跟随 | AI 思考 / 输出 / 报错 / 完成 | 自动切换对应动作，并在问答卡片或排队栏出现时主动避让 |

---

<a id="配置参考"></a>
## 配置参考

所有选项均可在右侧 **Claude Studio** 面板实时调整并自动保存（完整模板见 [config.example.json](config.example.json)）。手机推送配置与凭据单独隔离保存在本机 `PLUGIN_DATA/notify.json` 中，不会写入 `config.json` 也不会注入渲染进程。

<details>
<summary><b>展开查看全部配置项说明</b></summary>

| 分组 | 配置键 | 可选值 / 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| 基础设置 | `language` | `'zh-CN'` \| `'zh-TW'` \| `'yue'` \| `'en'` \| `'ja'` | `'zh-CN'` | 界面与控制面板语言（粤语与日语按需拉取） |
| 基础设置 | `homeLayout` | `'studio'` \| `'classic'` \| `'off'` | `'studio'` | 新会话首页布局 |
| 基础设置 | `palette` | `'claude'` \| `'obsidian'` \| `'host'` | `'claude'` | 纯色主题配色 |
| 界面微调 | `glassEffect` | `boolean` | `true` | 独立毛玻璃质感与失焦柔和环境光 |
| 界面微调 | `sidebarRestyle` / `sidebarCompact` | `boolean` | `true` | 侧边栏重塑与紧凑间距 |
| 界面微调 | `composerRestyle` / `placeholderStyle` | `boolean` / `'studio'` \| `'host'` | `true` / `'studio'` | 极简输入框与引导文案风格 |
| 界面微调 | `logoInk` | `'accent'` \| `'foreground'` | `'accent'` | 首页及左上角应用 Logo 着色模式 |
| 界面微调 | `geminiLoader` | `boolean` | `true` | 加载动效：用可爱的 Gemini 娘和 12 刻度环替换原生转圈 |
| 进阶交互 | `fileLinkContextMenu` | `boolean` | `true` | 对话文件右键菜单：右击本地文件链接唤起打开/定位/复制路径菜单 |
| 进阶交互 | `periodicSelector` / `orchestratorSwitch` | `boolean` | `true` | Gemini 4 元素周期表选择器与协作模式快捷开关 |
| 进阶交互 | `effortSliderStyle` / `effortAccent` | `'chatgpt'` \| `'claude'` / `boolean` | `'chatgpt'` / `true` | 思考强度滑块风格与色阶 |
| 进阶交互 | `compactPreset` / `compactCustomText` | `'empty'` \| `'clean'` \| `'dev'` \| `'custom'` / `string` | `'clean'` / `''` | `/compact` 压缩预设与自定义指令文案 |
| 进阶交互 | `smoothCaret` / `mascot` / `homeRipple` | `boolean` / `'crab'` \| `'off'` / `boolean` | `true` / `'crab'` / `true` | 丝滑光标、Clawd 挂件、首页字符水波纹 |
| 翻译保护 | `pluginPageTranslate` / `i18nIgnoreSelectors` | `boolean` / `string[]` | `true` / `[]` | 插件市场按需翻译小胶囊与自定义免翻译 CSS 选择器 |
| 侧栏与用量 | `pinRightPane` | `'off'` \| `'studio'` \| `'usage-monitor'` | `'studio'` | 切会话自动常驻右侧栏（自动迁移旧版 `pinUsageMonitorPane`） |
| 侧栏与用量 | `usageStatsEnabled` | `boolean` | `true` | 内置用量统计总开关（关闭时不覆盖子项偏好） |
| 侧栏与用量 | `inlineStats` / `ringMode` / `turnBadges` | `boolean` / `'context'` \| `'quota'` / `boolean` | `true` / `'context'` / `true` | *(总开关开启后生效)* 内置底栏统计、圆环与轮次徽章 |
| 侧栏与用量 | `hudTopBar` / `hudBottomBar` / `hudRimProgress` | `boolean` | `true` / `false` / `false` | *(总开关开启后生效)* 顶部 HUD、底部统计条与环绕进度条 |
| 运行时 | `autoRelaunchWithCdp` / `exitOnHostClose` / `pollIntervalMs` | `boolean` / `boolean` / `number` | `true` / `false` / `2500` | CDP 自动接管、宿主关闭随同退出与轮询间隔 |

</details>

---

<a id="常见问题"></a>
## 常见问题

<details>
<summary><b>1. 升级到 Antigravity 2.33.0+ 后没有自动注入？</b></summary>

Antigravity 从 `2.33.0` 起默认不再开启 CDP 端口。请彻底退出 Antigravity（含系统托盘）后携带 `--remote-debugging-port=0` 启动，或直接使用右侧面板的一键重启 / `launch.bat` / `./launch.sh`；也可以直接对 Gemini 说 *「帮我诊断 Claude Studio」* 触发 `studio-doctor` 技能排查。

</details>

<details>
<summary><b>2. 右侧栏常驻设置中的「用量监控」选项不可用？</b></summary>

该选项对应独立搭档插件 [yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor)。安装该插件后在 Studio 面板刷新状态即可激活；如果不装额外插件，直接保持 `Studio 对话面板` 搭配内置轻量用量统计即可开箱使用。

</details>

<details>
<summary><b>3. 为什么侧边栏会话列表的右键菜单仍是英文？</b></summary>

侧边栏右键菜单由 Electron 调用操作系统原生菜单（Win32 / NSMenu）绘制，不在网页 DOM 树中，纯无损 CDP 注入无法改写系统原生菜单文案；应用内所有 DOM 界面、设置页与浮窗均已支持 5 语言本地化。

</details>

<details>
<summary><b>4. 如何彻底还原原生界面？</b></summary>

点击右侧 **Claude Studio** 面板的 **「还原原生」**，或在 Antigravity 插件管理中禁用 `Claude Studio` / 运行 `npm run remove`，即可无痕恢复原版，绝不修改任何宿主文件。

</details>

<details>
<summary><b>5. Windows 非 TUN / 进程级代理环境使用提示</b></summary>

如果你在 Windows 下未开启系统全局代理或 TUN 模式，而是通过本地代理启动脚本为 Antigravity 注入进程级代理变量，可以按以下方式配置：

1. **首次启动快捷方式**：将桌面或开始菜单中的 `Antigravity (Claude Studio).lnk` 指向你的进程级代理启动脚本（需支持 `%*` 参数透传），并在快捷方式参数中附带 `--remote-debugging-port=0`。
2. **推荐环境变量**（以本地代理端口 `127.0.0.1:7890` 为例）：
   ```bat
   set HTTP_PROXY=http://127.0.0.1:7890
   set HTTPS_PROXY=http://127.0.0.1:7890
   set NODE_USE_ENV_PROXY=1
   set NO_PROXY=localhost,127.0.0.1,::1
   ```
   - `NODE_USE_ENV_PROXY=1` 可让 Node.js 22+ 原生 `fetch` 自动走代理，确保右侧面板的**检查更新**、**Gemini 4 元素周期表同步**与**按需语言包下载**正常联网；
   - `NO_PROXY=localhost,127.0.0.1,::1` 确保本地 CDP 调试端口与 `language_server` 回环通信保持直连，不被代理截断；
   - 如需 SOCKS5 代理，可按需一并设置 `ALL_PROXY`。
3. **侧栏重启自动保留代理**：从右侧 **Claude Studio** 面板触发重启时，插件会自动提取当前进程中的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`、`NODE_USE_ENV_PROXY` 并安全透传给重启后的 `Antigravity.exe` 进程，同时在临时启动脚本退出后自动清理。未使用进程级代理（TUN 模式或直连）的用户不受任何影响。

</details>

---

## 开发与测试

```bash
npm test                 # 运行全部单元测试（Node.js >= 22，零依赖）
npm run build:installer  # 构建 Windows 单文件安装器
npm run build:release    # 打包 Windows 伴随启动发布包
npm run build:macos      # 构建 macOS Universal .app 与 .dmg（需 macOS 环境）
```

<details>
<summary><b>查看项目目录结构</b></summary>

```text
agy-claude-studio/
├── plugin.json / mcp_config.json / hooks.json  # 原生插件清单、轻量宿主与 Stop Hook
├── plugin/mcp-host.js                          # 原生插件生命周期宿主（PID 复用校验与热接管）
├── sidecars/studio/                            # 右侧 3-Tab「Claude Studio」控制室（对话 / 工具 / 设置）
├── skills/                                     # 4 项原生技能（setup / doctor / notify / translation-protect）
├── cdp.js / lifecycle.js                       # CDP 客户端、配置迁移、进程守护与宿主看门狗
├── watcher-core.js / inject.js                 # 多窗口热更新控制器与 CLI 注入入口
├── style.css / ui-runtime.js                   # 核心主题样式与运行时（首页、周期表、滑块、/compact）
├── sidecar-core.js                             # Swarm 蜂群侧栏（/swarm）精简无损翻译运行时
├── periodic-core.js / periodic-sync.js         # Gemini 4 元素周期表目录与 AI Studio 直连同步
├── effort-core.js                              # 双风格 60fps 思考强度滑块数学模型
├── notify-core.js / scripts/notify-stop.mjs    # 8 渠道手机推送核心与 Stop Hook 入口
├── scripts-core.js / scripts/fetch-agy-changelog.mjs # 本地脚本工具箱与 Antigravity 更新日志抓取器
├── scripts/WindowsFileAction.cs                # Windows 原生资源管理器文件选中定位与路径动作
├── i18n-core.js / i18n-locales.js / i18n-compat.json # 本地化引擎、内置语言词典与免打扰保护名单
├── i18n-sync.js / locales/                     # 按需语言包同步器（粤语/日语按需拉取）与离线包
├── usage-core.js                               # 内置轨迹解析、上下文拆解与热力图引擎
├── mascot-core.js / crab-assets.js             # Clawd 状态机与 19 套像素双层精灵图
├── ripple-core.js                              # 首页字符矩阵噪声与二维水波求解器
├── installer/ & companion/                     # Windows (C#) / macOS (Swift) 安装器与伴随脚本
├── scripts/ & test/                            # 构建打包脚本与 node:test 自动化测试套件
└── assets/                                     # 图标、横幅与实景展示图
```

</details>

---

<a id="致谢与开源协议"></a>
## 致谢与开源协议

本项目基于 [MIT License](LICENSE) 开源，衷心感谢以下开源项目与社区贡献者：

- **上游原版仓库**：[0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style)（MIT License）
- **核心设计灵感与早期源码**：[Nwflower/dsh-claude-style](https://github.com/Nwflower/dsh-claude-style)
- **macOS 守护内存池与 CDP 连接复用参考**：[SeredenFei/agy-claude-style](https://github.com/SeredenFei/agy-claude-style)
- **原生插件托管、右侧辅助栏与 2.33.1 适配参考**：[Gruu6y/agy-claude-style](https://github.com/Gruu6y/agy-claude-style)
- **毛玻璃与看图悬浮胶囊设计灵感**：[MCRYII/antigravity-custom-themes](https://github.com/MCRYII/antigravity-custom-themes)
- **Codex 思考强度滑杆样式**：[Microqian2th/dsh-codex-effort-slider](https://github.com/Microqian2th/dsh-codex-effort-slider)
- **推荐搭档用量监控插件（GPLv3，独立解耦安装）**：[yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor)
