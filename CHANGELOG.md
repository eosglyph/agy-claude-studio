# Changelog

All notable changes to **Claude Studio (`agy-claude-studio`)** and its upstream base **AGY Claude Style (`0DNANCY/agy-claude-style`)** are documented in this file.

## [v2.3.0] - 2026-11-28

`v2.3.0` 推出独立常驻三栏 Claude Studio 侧栏与对话顶栏插件快捷钉住，升级 5 套对称显式浅/深配色，新增 Claude 风格环境分支菜单与完整 `/btw` 旁支提问工作流，同步完成 Antigravity `v2.36.0` 本地化、技能说明按需翻译胶囊、暖白 Windows 安装器改版，以及 CLI 宿主隔离、旧文件自清理与 Windows 代理环境变量透传加固。

### 独立常驻三栏侧栏与对话顶栏插件钉住
- **独立三栏常驻 Dock**：支持将 Claude Studio 固定在最右侧作为独立第三栏（`pinRightPane: 'studio' | 'off'`），与浏览器、文件预览、终端等辅助面板标签页共存不遮挡，并支持单栏独立常驻、SVG 侧栏徽标与防抖动保护。
- **全屏看图零帧让位与顶栏 `✦` 折叠**：辅助面板最大化（如全屏看图）时常驻侧栏与 iframe 零帧隐藏让位、恢复后自动归位；折叠常驻侧栏后收成 `0px`，改为在对话顶栏 `⋮` 左侧展示单枚陶土红 `✦` 展开按钮。
- **对话顶栏插件快捷钉住**：在 `⋮ → 插件` 子菜单每行右侧新增 `📌` 胶囊一键钉住/取消任意 UI 侧栏插件（不误触打开、不关菜单），在对话顶栏 `⋮` 左侧展示原版图标并支持三态点击（打开 / 切换 / 关闭收起），与常驻 Studio 折叠 `✦` 自动去重，同时修复多会话桥接串扰与辅助栏关闭按钮误判。

### 5 套对称显式浅色与深色配色
- **跨宿主明暗的 5 项对称配色**：提供 `claude`、`claude-dark`、`obsidian`、`obsidian-dark` 与 `host` 五项选择，5 语种下拉清晰标明「浅色 / 深色 / 跟随宿主」。
- **端到端主题覆盖**：显式浅色与显式深色不再受 Antigravity 宿主明暗模式制约，完整覆盖界面变量、代码块语法高亮、图表色板、思考强度滑块、毛玻璃浮层与控制室 Sidecar。

### Claude 风格环境菜单、`/btw` 旁支提问与输入区打磨
- **Claude 风格环境菜单**：新增环境分支与 Git Worktree 切换菜单，支持 `.repo + worktree/` 容器仓库识别与暗色分支悬浮提示。
- **`/btw` 旁支提问与 `/compact` 继续压缩**：控制室「对话」页完整追踪 `/btw` 旁支提问，统一平静卡片样式、隔离多会话串扰，并将旁支运行徽章精简标为 `旁`（`Side` / `副`）；`/compact` 新增 `continue`（「继续压缩」）预设，Lexical 输入框支持 `/compact` ↔ `/btw` 无感替换同时保留普通草稿与 IME 输入法组合状态。
- **模型胶囊分组与原生控件隔离**：`✦` 与模型名合并为统一悬浮/展开胶囊并拦截原生模型弹窗，思考强度独立为等高胶囊；新增 `effortSliderStyle: 'off'` 保留原生思考控件（周期表收敛为仅由 `✦` 进入），并在 `composerRestyle: false` 时隔离原生输入框布局与毛玻璃。

### Antigravity v2.36.0 本地化、技能翻译胶囊与按需语言包
- **Antigravity `v2.36.0` 全量词条补齐**：补全旁支提问、新建标签页与设置页新增文案的 4 语种离线词库与规则，并新增过期云端词库防回退保护，避免旧远端包覆盖内置新词条。
- **技能翻译胶囊与精简按需包**：为「设置 → 技能」与 `/customizations` 新增按需「翻译说明」胶囊；将繁体中文（`zh-TW`）改为按需下载（基础包仅内置简体中文与英文），修复词库同步/重置请求体并区分「云端」与「云端已更新」状态及绿色更新按钮。

### 暖白 Windows 安装器、测试版通道、自清理与可靠性加固
- **暖白安装包与更新日志自动汉化**：Windows 安装器升级为 Claude 暖白界面并持久化快捷方式图标；`scripts/fetch-agy-changelog.mjs` 新增官方更新日志自动中文翻译（同时退役重复的 `check-agy-update.mjs`）。
- **测试版通道与控制室精修**：设置页新增「接受测试版本推送（`receivePrerelease`）」开关、紧凑单开手风琴与去灰框词库列表；「对话」页支持活跃任务置顶；`configSchemaVersion: 2` 升级自动启用常驻侧栏。
- **`src/` 整理与旧文件自清理**：核心运行代码收拢至 `src/` 并移除 11 个旧版平铺脚本；新增基于 SHA-256 白名单的 `v2.2.4` 前根目录遗留文件自清理（保留用户自定义修改）及在线更新后子进程热重注。
- **CLI 隔离、安全与 Windows 代理透传**：隔离 `antigravity-cli` 宿主与桌面端 CDP 注入及数据写入；加固侧栏子进程环境隔离、清理边界与发布 CI 6 处版本号硬门禁；Windows 重启 Antigravity 时安全透传进程级代理环境变量（`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`、`NODE_USE_ENV_PROXY`）并自动清理临时脚本（PR #4，感谢 `@fexpopopoi`）。

### Summary (English)
- **Independent Persistent Studio Dock & Titlebar Plugin Pinning**: Adds a persistent far-right 3-column Studio dock (`pinRightPane: 'studio' | 'off'`) with solo dock mode, zero-frame auto-yield when the Aux Pane is maximized, `0px` collapse into a titlebar `✦` button, and per-row `📌` pinning in `⋮ → Plugins` to dock any UI sidecar plugin in the conversation titlebar with 3-state toggling and multi-conversation bridge fixes.
- **5 Explicit Light & Dark Palettes**: Upgrades palette selection to 5 explicit modes (`claude`, `claude-dark`, `obsidian`, `obsidian-dark`, `host`) that render consistently across host light/dark modes, covering syntax highlighting, charts, effort sliders, glassmorphism overlays, and the Studio sidecar.
- **Claude-Style Environment Menus, `/btw` Workflow & Composer Polish**: Adds branch/worktree Environment menus with `.repo + worktree/` container detection, full `/btw` side-question tracking with concise `Side` (`旁` / `副`) badges, a `continue` preset for `/compact`, seamless Lexical `/compact` ↔ `/btw` token swaps preserving drafts and IME composition, a grouped `✦` + model pill with separate equal-height effort pill, `effortSliderStyle: 'off'`, and clean native composer isolation when `composerRestyle: false`.
- **Antigravity v2.36.0 Localization & On-Demand Packs**: Completes `v2.36.0` string coverage across all 4 locale packs with stale cloud pack protection, adds an on-demand "Translate Descriptions" pill for Skills settings and `/customizations`, moves `zh-TW` to on-demand download, and clarifies `Cloud` vs. `Cloud Updated` status badges.
- **Warm Ivory Installer, Beta Channel, Self-Cleanup & Hardening**: Refreshes the Windows installer in warm ivory with persistent shortcut icons and auto-translated Antigravity changelogs; adds the opt-in `receivePrerelease` beta channel toggle, compact accordion Settings, active task pinning, and `configSchemaVersion: 2` migration; organizes runtime code into `src/` with SHA-256 allowlisted pre-v2.2.4 legacy cleanup and subprocess re-injection; isolates `antigravity-cli` hosts; and preserves Windows process proxy env vars across relaunches (PR #4, thanks `@fexpopopoi`).

**Full Changelog**: https://github.com/eosglyph/agy-claude-studio/compare/v2.2.3...v2.3.0

---

## [v2.2.3] - 2026-11-26

`v2.2.3` 全面收敛为 Antigravity 原生插件架构：推出全新 Windows 一键原生插件安装器，补齐 Antigravity `v2.35.2` 全量中文本地化并支持粤语、日语按需云端下载，新增 Gemini 娘加载动效与聊天区内嵌宽屏脚本输出卡片，并针对输入框同步、光标测量与侧边栏轮询做了一轮实测驱动的性能优化。

> 注：`v2.2.2` 被猫猫吃掉了，本版本直接从 `v2.2.1` 跳至 `v2.2.3`。

### Windows 一键原生安装器与统一发布产物
- **开箱即用的原生插件安装**：新版 Windows `.exe` 安装器直接将完整原生插件部署到宿主插件目录并自动启用，同时创建带有定制图标的桌面与开始菜单启动入口，支持自动定位自定义盘符中的 Antigravity 程序。
- **无损清理旧版遗留**：安装时自动检测并卸载早期 `v2.1.0 / v2.2.0 / v2.2.1` 独立守护进程与旧版 `agy-claude-style` 插件，同时完整保留个人偏好、推送配置与自定义脚本。
- **跨平台通用插件包**：同步提供精简的跨平台 `plugin.zip` 供 macOS / Linux 及手动安装使用，并在 README 中补充了可直接发给 Gemini 的一键升级指引。

### Antigravity v2.35.2 汉化补齐与按需语言包
- **补齐新版本界面词条**：覆盖 Antigravity `v2.35.2` 新增的界面提示与蜂群侧栏文案，同时精简了内置语言包体积。
- **云端按需语言包**：插件默认内置简体中文、繁体中文与英文；粤语和日语改为在设置页按需从 GitHub 手动下载，附带完整性校验，随时可一键更新或恢复默认，原地升级时也会保留已下载的语言包。
- **插件页翻译胶囊更稳**：遇到 Google 翻译接口临时限流时自动切换备用翻译通道，减少网络报错。

### 界面体验与日常细节打磨
- **Gemini 娘加载动效**：在「设置 → 界面微调」中新增「加载动效（Gemini发现了新玩具）」开关，开启后可将开屏与面板加载转圈替换为 Gemini 娘形象与头顶刻度环，随时可一键切回原版。
- **侧边栏更紧凑顺手**：重排右侧 Claude Studio 面板顶栏与三栏切换条，在窄栏宽度下保持单行清爽显示，并修正了顶栏窗口数量统计。
- **聊天区内嵌宽屏脚本输出**：在工具页运行本地脚本后，可直接把完整 Markdown 输出以可收起/展开的宽屏卡片展示在聊天输入框上方，不影响对话上下文，收起后也能随时重新打开。
- **Windows 文件右键更流畅**：修复聊天文件右键菜单图标在部分环境下显示偏大的问题；在文件夹中显示文件时改用原生资源管理器定位，消除此前偶发的窗口缩小闪烁。

### 性能与稳定性优化
- **消除输入框重复计算**：合并输入框同步链路的草稿统计与回合徽标更新，避免同一轮刷新里重复测量草稿和重复扫描历史回合；环绕 HUD 全关时直接跳过多余计算。
- **光标测量更克制**：未聚焦的输入框不再执行光滑光标的几何与样式读取，并将滚动监听收敛到当前聚焦编辑器及其滚动容器。
- **异步会话防串写**：切换回首页或新对话时，若旧会话的异步统计结果迟到返回，会直接丢弃而不覆盖当前界面。
- **侧边栏轮询减负**：设置页状态未变化时不再重复重建表单（避免打断自定义提示词编辑），会话检查器按会话合并在途请求，状态轮询中的仓库状态检测改为异步短缓存。

### Summary (English)
- **Note**: `v2.2.2` was eaten by the cat — this release jumps directly from `v2.2.1` to `v2.2.3`.
- **Native Windows 1-Click Installer & Unified Artifacts**: Deploys the full native plugin, automatically cleans up legacy `v2.1.0 / v2.2.0 / v2.2.1` standalone watchers while preserving personal settings, notification credentials, and scripts, and ships alongside a cross-platform `plugin.zip`.
- **Antigravity v2.35.2 Localization & On-Demand Packs**: Ships Simplified Chinese, Traditional Chinese, and English built-in; Cantonese and Japanese download on demand with integrity checks. Marketplace page translation now falls back cleanly when rate-limited.
- **UI & Workflow Polish**: Adds the optional Gemini-chan loading spinner toggle, tightens the narrow Studio sidecar header, adds a collapsible wide in-chat output card for local scripts, and fixes Windows file-reveal flicker and context-menu icon sizing.
- **Performance & Stability**: Deduplicates per-sync draft measurement and turn-badge scans, skips smooth-caret layout reads for unfocused editors, discards late async responses after navigating away from a conversation, and avoids redundant sidecar form rebuilds and blocking status polls.

**Full Changelog**: https://github.com/eosglyph/agy-claude-studio/compare/v2.2.1...v2.2.3

---

## [v2.2.1] - 2026-11-26

`v2.2.1` 是一次聚焦安全性与日常体验的维护更新：收紧了侧边栏通信、手机推送、本地脚本、原地升级与本地文件操作的权限边界，新增聊天文件链接右键菜单，支持关闭插件时自动停注并还原窗口，同时补齐了 `/btw` 提示的 5 语言翻译。

### 聊天文件链接右键菜单
- **右键直接操作**：右击对话中的本地文件链接或提及胶囊，可直接选择「打开文件」「在文件夹中显示」或「复制完整路径」，查看与定位文件更顺手。
- **可随时关闭**：设置页提供独立开关；关闭后会立即清理已打开的浮层与待处理状态。

### 关闭插件自动停注与还原
- **随插件开关即时响应**：在 Antigravity 插件管理中停用 Claude Studio 后，后台守护会立即停止注入并无损还原已打开的窗口。
- **重启不再重复注入**：停用状态下重启 Antigravity 不会再自动注入；重新启用插件后会自动恢复。

### 本地安全加固
- **侧边栏通信鉴权**：侧边栏与宿主之间的通信改用令牌校验，未携带有效凭据的请求会被直接拒绝。
- **手机推送凭据保护**：已保存的推送密钥不再以明文返回界面，编辑时留空即可沿用旧值，也可手动清空；切换推送渠道时会自动清除上一渠道的旧密钥。敏感配置以更严格的本机文件权限写入，网络请求禁止意外跳转并受统一超时限制。
- **本地脚本与原地升级校验**：本地脚本运行前会校验工作目录并拦截批处理入口，运行环境与侧边栏内部变量隔离，超时后会终止整个子进程树；原地升级增加了个人数据保护校验，并在替换失败时自动回滚。
- **跨平台文件操作限制**：统一三端的文件打开与定位规则——仅常见文档与媒体文件支持直接打开，脚本和可执行程序仅允许在文件夹中显示或复制路径；拦截网络共享路径、异常软链接及特殊应用包误启动，并仅响应来自主会话窗口的调用。

### 本地化补齐与迁移说明
- **补齐 5 语言词条**：补充了 `/btw` 等新增界面提示的 5 语言翻译。
- **旧版 Windows 守护迁移提醒**：发布说明中补充了从早期 `agy-claude-style` 迁移时卸载旧版守护进程的核对指引。

**Full Changelog**: https://github.com/eosglyph/agy-claude-studio/compare/v2.2.0...v2.2.1

---

## [v2.2.0] - 2026-11-25

`v2.2.0` 重点重构了右侧 Claude Studio 面板，同时补齐了任务完成手机提醒、本地脚本工具箱、4 项原生引导技能，以及 Antigravity `v2.35.x` 的全套界面适配。

### 侧边栏全新改版（`对话 | 工具 | 设置`）
- **新增「对话」实时状态页**：
  - 一眼看到当前工作区路径、Git 分支、已接入的连接器，以及与实际计费一致的上下文占用分布（支持展开查看 MCP 工具、技能与规则明细）。
  - 底部实时显示当前任务进展：区分等待首字、推理中、执行/等待命令、正在输出回复等阶段，支持实时摘要预览、并行工具进度，以及展开查看运行中的子代理与蜂群成员。
- **更清爽的扁平视觉**：三页统一改用极简扁平样式、单色线性图标和更宽松的留白，信息层次更清楚。
- **顶栏一键升级**：检测到新版本后会在顶栏出现升级提示，Git 克隆版和直接下载的插件包都能一键原地更新，用户配置与推送密钥不受影响。
- **右侧栏常驻改为三选一**：支持按需选择 `关闭` / `Studio 对话面板`（默认） / `用量监控`；老配置会自动迁移，没装 `usage-monitor` 时也能顺畅使用。

### 手机推送提醒（任务结束自动发，不耗对话额度）
- 支持 **8 种渠道**：**Server酱**（支持推送最长约 28KB 完整 Markdown 回复 + 卡片摘要）、**Bark（iOS）**、**ntfy**、**飞书**、**钉钉**、**企业微信**、**Telegram Bot** 与 **自定义 Webhook**。
- 工具页新增可折叠快捷控制区，支持按任务耗时过滤（默认超过 3 分钟才提醒）、等子代理全部结束后再发、出错立即提醒、手动停止不打扰。
- 所有密钥只保存在本机独立文件 `PLUGIN_DATA/notify.json`，不会混进界面配置。

### 协作模式、`/compact` 与模型体验
- **协作模式快捷开关**：模型选择器旁新增一键切换协作模式（Orchestrator）的按钮，重启后能记住上次的思考强度设置。
- **运行期间防误触锁定**：智能体干活时，同步锁定协作模式开关、元素周期表入口和思考强度标签，并翻译了 Antigravity `v2.35` 的锁定提示。
- **`/compact` 快捷压缩预设**：点击快捷按钮后自动精准选中 `/compact` 并显示内联提示，内置 4 套压缩指令预设（留空 / 精简降噪（默认） / 开发接力 / 自定义），不自动发送、方便先微调再回车。
- **AI Studio 元素周期表直连同步**：在周期表弹窗里可以直接拉取 Google AI Studio 最新发布的 Gemini 4 模型信息与配色，无需手动更新插件。

### 本地脚本工具箱与 4 项原生技能
- **「工具」页本地脚本运行器**：支持登记并一键运行本机 Node / Python / Shell 脚本，实时查看输出结果。
- **随包附带 Antigravity 更新日志脚本**：内置 `scripts/fetch-agy-changelog.mjs`（抓取 Antigravity 官方最新版本号与更新日志，支持 `--all` / `--json` / `--push`），新装用户首次打开即可一键使用。
- **4 项原生插件技能**：
  - `studio-setup`：30 秒点选卡片完成初始偏好配置并立即生效；
  - `studio-doctor`：排查样式未生效、热重注入自愈与自然语言调参；
  - `studio-notify`：手把手配好手机推送与排障；
  - `studio-translation-protect`：把不想被翻译的第三方插件区域加入保护名单。

### 本地化与免打扰翻译协议
- **通用免翻译保护**：遵循标准 `translate="no"` / `.notranslate` 等免翻译标记，支持同步云端第三方插件保护名单，也可自定义忽略规则，避免误翻其他插件界面。
- **插件市场按需翻译**：在插件市场列表和详情页顶部加入谷歌翻译小胶囊，默认不发任何请求，点一下就能翻译并随时切回原文。
- **Antigravity `v2.35.x` 适配**：支持 React 拆分文本节点翻译，补齐了 `v2.35.1`、Automations、设置页新版大小写及 `Compacting` 等 100+ 条界面词条。

### 细节与默认配置调整
- 毛玻璃输入框在失焦时保留一圈克制的微光；`logoInk` 现在也会同步作用于左上角应用图标。
- 精简内置用量选项，移除不再使用的「底栏配额标签」与「紧凑统计样式」，并优化了开箱默认配置（默认开启顶部精简上下文条、`/compact` 精简降噪预设、常驻 Studio 对话面板，默认推送耗时门槛 3 分钟）。
- **macOS 平台说明**：macOS Universal `.dmg` 安装包已通过 GitHub Actions CI 构建与自动化测试，目前尚待真机 Mac 环境实测验证，欢迎 macOS 用户试用反馈。

**Full Changelog**: https://github.com/eosglyph/agy-claude-studio/compare/v2.1.0...v2.2.0

---

## [v2.1.0] - 2026-11-22

**Claude Studio (`eosglyph/agy-claude-studio`)** 的首个正式版本，基于上游 `0DNANCY/agy-claude-style v2.1.0` 独立演进：

### 原生插件托管与右侧「Claude Studio」面板
- **原生插件托管**：接入 Antigravity 原生插件体系，随宿主启动和退出，不留后台孤儿进程；首次启用时自动迁移旧版 `agy-claude-style` 的个人配置。
- **右侧控制面板**：右侧辅助栏新增「Claude Studio」面板，主题配色、毛玻璃、元素周期表、思考强度滑块、5 语言切换和用量监控协同都可以在这里直接调整并即时生效。

### Gemini 4 元素周期表模型选择器
- **直观卡片快选**：在输入框模型选择旁加入元素周期表样式的快选卡片，支持分类筛选、即时搜索以及切换模型和思考档位。
- **模型同步提示词**：支持生成最新的 AI Studio 模型同步提示词，方便保持模型列表与官方一致。

### 外观微调与 60fps 思考强度滑块
- **独立毛玻璃开关**：新增毛玻璃效果开关，让浮窗边框、看图悬浮胶囊和输入框视觉上更有层次。
- **重写思考强度滑块**：提供 Codex 星云与 Claude 点阵两种 60fps 滑块样式，兼容 Antigravity 2.33.1 模型标签，并移除了旧版立绘滑块以精简体积。

### 搭档插件协同与上游 2.1.0 特性整合
- **与 `antigravity-usage-monitor` 协同**：支持底栏进度环分流、冷启动稳定渲染、切换会话后自动常驻右侧栏，以及翻译免打扰保护（MIT 与 GPLv3 保持各自独立）。
- **整合上游 2.1.0 改进**：包含 Swarm 蜂群侧栏（`/swarm`）完整 5 语言本地化，以及长对话虚拟列表和思考阶段的轮次统计对齐修复。

**Full Changelog**: https://github.com/eosglyph/agy-claude-studio/commits/v2.1.0

---

## [v2.1.0 (Upstream)] - 2026-11-22

`v2.1.0` 新增 **Swarm 蜂群侧栏（`/swarm` 面板）与 Plan / Orchestrator 模式完整 5 语言本地化**（#15），并修复了长对话虚拟列表及模型思考阶段输出下方轮次 HUD（`#T` 徽章）可能出现历史或残缺虚假信息的问题。

### 🌐 语言支持增强（Swarm UI 侧栏 & Plan / Orchestrator 模式，#15）
- **Swarm 蜂群侧栏（`/swarm` 面板）完整 5 语言本地化**：
  - Node（`cdp.js`）、Windows C#（`CdpClient.cs`）与 macOS Swift（`CdpClient.swift`）三端 CDP 目标过滤统一支持 `plugin://swarm--` 侧栏 OOPIF `iframe` 目标，并自动随主窗口语言切换通过轻量 `refreshConfig` 实时同步。
  - 新增 `sidecar-core.js` 侧栏精简运行时：在 `plugin:` 协议上下文下跳过主窗口 `style.css` 与 UI 增强，仅挂载可逆 DOM 翻译器，精准保护帖子正文、成员句柄、任务描述与叙述者视图，同时放行 `<select><option>` 筛选选项翻译，卸载时无损还原。
- **Plan / Orchestrator / Coordinator / Plugins 词典补齐**：
  - 扩充 `i18n-locales.js` 约 180+ 条 5 语言静态词条与 25 条动态正则规则，覆盖 Swarm 面板（Overview / Board / Members / Graph / Raw / Hive / Replay / GIF 导出）及主窗口新版 Orchestrator 模型设置、Coordinator/Subagent 控件、Pause/Resume 提示与插件管理界面。

### 🐛 Token HUD 轮次徽章（`#T`）精准对齐与思考态防串位修复
- **消除长对话思考阶段 `#T` 徽章盗用历史轮次问题**：
  - 修复在长对话虚拟列表仅挂载最近若干轮次（如 `#T12`～`#T20`）时，新提问处于“工作中 / 思考中”阶段因 `matchTurnByFiber` 返回 `null` 而掉入 `remainingTurns` 尾部回退队列、导致 `#T20` 下方的思考中节点错误挂载未渲染历史轮次（如 `#T11`）的问题。
  - 对缺失 Fiber 定位器的降级匹配施加严格的 DOM 先后单调性约束，并禁止自身已携带 Fiber 索引/时间戳的新轮次节点进入降级回退队列。
- **禁止进行中（思考中 / 流式生成中 / 工具执行中）轮次提前挂载残缺 HUD**：
  - 在 `usage-core.js` 中为仍包含 `status === 1` / `status === 2` 步骤或正在等待工具调用后模型响应的轮次标记 `inProgress: true`；在 `ui-runtime.js` 的 `extractFiberTurnContainer` 与多响应合并 `mergeFiberInfo` 中追踪 `hasRunningStep` / `isEmptySteps`（同时覆盖主会话与子智能体面板），确保模型思考期间下方不出现半成品或虚假 HUD，待生成完成后立即挂载完整 `#T` 统计。
- **防御发送瞬间缓存窗口期抢占与 0-Token 启动占位**：
  - 防止刚按下发送键、轨迹轮询尚未闭合上一轮 `nextUserStepIdx`（仍为 `Infinity`）的瞬间，新插入的 DOM 轮次节点覆盖抢占上一轮的 `#T` 徽章。
  - 过滤 `generatorMetadata` 启动期仅有 `chatStartMetadata` 尚无 `usage` token 的占位条目进入 `callList`（同时保留其实时上下文窗口占用更新）。

### 🧪 自动化测试扩充
- 全平台自动化测试扩展至 **90 项**（新增 Swarm 侧栏翻译器与 OOPIF 目标发现测试、20 轮虚拟列表 + 第 21 轮思考中四阶段防串位回归测试及未完成调用过滤测试）。

**Full Changelog**: https://github.com/0DNANCY/agy-claude-style/compare/v2.0.0...v2.1.0

---

## [v2.0.0] - 2026-11-21

`v2.0.0` 为重大架构与体验升级版本：正式引入 **「启动器托管模式（随宿主生灭、零后台常驻）」**（#4、#14），并全面整合 **PR #13**（@zhyan0603 / ZihanYAN）在守护进程安全加固、轻量配置热更新与 Token HUD 方面的深度优化。

### 🚀 启动器托管模式与双模式切换（#4、#14）
- **三端统一无窗启动器（`--launch` / `--managed`）**：
  - Windows `agy-claude-style-watcher.exe` 与 macOS `agy-claude-style-watcher` 新增 `--launch`、`--relaunch`、`--replace`、`--startup-grace <sec>`（默认 `90` 秒），Node 端 `inject.js` 同步新增 `--managed` 一键组合参数与 `npm run managed`。
  - 启动时优先复用并激活已有 CDP 窗口；未运行或未开启 CDP 时按参数/配置以 `--remote-debugging-port=0` 启动或温和重启，随后直接进入 `--exit-on-host-close` 监听并在宿主关闭后自动退出。
  - 新增重复实例去重（托管启动不重复驻留）与 **90 秒启动宽限保护**：若在首个窗口附着前宿主启动失败或中途关闭，watcher 会在宽限期后自动退出并清理 `.watch.pid`，避免孤儿进程挂起；普通 `--watch` 守护模式即使配置了 `exitOnHostClose: true` 也不会误触发宽限退出。
- **Windows 与 macOS 独立安装器双模式改造**：
  - 安装器 GUI 与 CLI 均默认推荐 **托管启动模式（免后台常驻）**，同时完整保留 **常驻守护模式（开机自启）**，支持 `--mode=managed|daemon`、`--managed`、`--daemon`、`--desktop-shortcut` / `--no-desktop-shortcut`（Windows）、`--app-launcher` / `--no-app-launcher`（macOS），并兼容 `--no-autostart`。
  - 托管模式下平时 **0 后台进程常驻**：不写入 Windows Startup / macOS `LaunchAgent`；仅当安装时检测到 Antigravity 已开启 CDP 会话才拉起一次性 `--exit-on-host-close` 监听接管当前会话。
  - 升级自动保留已有 `config.json` 并通过 `.install-mode` 记录当前模式；从常驻模式切换至托管模式时，主动删除旧版 Startup 快捷方式 / `LaunchAgent` plist 并停止原常驻进程；卸载时一并清理所有启动入口。
  - 统一启动入口：Windows 安装目录、开始菜单及桌面生成 `Antigravity (AGY Claude Style).lnk`（指向无黑框 watcher `--launch --relaunch --exit-on-host-close`）；macOS 生成 `Antigravity (AGY Claude Style).app` 与 `launch-antigravity.command`。
- **脚本模式升级**：
  - `launch.bat` 与 `launch.sh` 默认以托管模式启动并在关闭宿主后自动退出，传入 `--daemon` 可切回常驻守护模式；`watch-hidden.vbs` 支持命令行参数透传（无参保持默认 `--watch --replace`）。
- **零侵入安全原则**：全程不改动 Antigravity 原版安装目录，不使用 DLL 劫持或 IFEO 映像劫持，避免安全软件误报并保持 Windows / macOS / Linux 跨平台统一。

### 🛡️ 守护进程安全加固与轻量配置热更新（整合自 #13，致谢 @zhyan0603）
- **Fail-Closed PID 归属校验**：
  - 在 `cdp.js`、`inject.js`、`remove.js` 与 Windows C# / macOS Swift 安装器及守护进程中引入严格进程归属判定，综合校验可执行文件路径、命令行参数、`--dir` 及 macOS `/private/(var|tmp|etc)` 软链路径（支持 `--watch` 与 `--managed`）。
  - 仅终止确认属于目标安装目录的守护进程；遇到失效或属于其他程序的 PID 仅清理锁文件而不误杀；进程信息无法确认时执行 **Fail-Closed 拒绝策略**，既不发信号也不覆盖 `.watch.pid`。
  - `watch.sh` 与 `launch.sh` 统一改用 `$PWD/inject.js` 绝对路径启动，消除相对路径判重盲区；Windows 卸载自删除改用编码 PowerShell `-LiteralPath` 安全处理特殊路径字符。
- **`<2KB` 轻量配置热更新与三方配置合并**：
  - 将页面注入脚本拆分为不可变完整运行时（`bootstrapScriptId`）与独立短配置脚本（`configScriptId`）。仅编辑 `config.json` 或在面板切换设置时，仅下发 `<2KB` 配置脚本并触发 `window.__agClaudeStyle.refreshConfig()`，避免重复传输整包运行时与样式表；新开窗口、页面重载及轻量刷新回退时均保持最新配置生效。
  - 共享 `CONFIG_VALIDATORS` 单一校验源并消除重复校验表；`config.json` 改用临时文件原子替换写入（替换失败保留原文件）；前端 `loadSettings` 对前后配置快照与 `localStorage` 执行 **3-way 合并**，保留本地 UI 偏好不被外部非相关变更覆盖；对齐三端 `autoRelaunchWithCdp` 缺省值为 `true`，Windows `MiniJson.cs` 补齐 `\u2028`/`\u2029` 转义。

### 📊 Token HUD 增强与运行时性能优化（整合自 #13）
- **低上下文预警与精准 `/compact`**：上下文剩余 `<= 20%`（琥珀色预警）及 `<= 10%`（红色紧急）时，状态环、顶部 HUD `/compact` 按钮与详情浮窗同步展示提醒并支持点击一键填充 `/compact`；多会话视图下优先向当前卡片关联输入框填入指令。
- **配额联动与剪贴板反馈**：开启底部 HUD（`hudBottomBar`）时，即使圆环处于 `context` 模式也会同步拉取模型配额；点击复制遥测报告在剪贴板拒绝或失败时显示明确 `✕ 失败` 状态反馈。
- **绘制与缓存优化**：草稿输入时的弹层数据刷新通过 `requestAnimationFrame` 合并并优先局部更新数字节点；过滤非输入区的 `.monaco-editor` 与 `.xterm` 高频 DOM 变更；为主会话与子代理轨迹缓存增加 LRU 淘汰；首页字符波纹静止时跳过冗余计算并在零尺寸容器下安全创建与卸载绘制资源。

### 🧪 自动化测试扩充
- 全平台自动化测试扩展至 **84 项**（覆盖托管启动、90s 启动宽限、重复实例去重、Windows/macOS 双模式切换与卸载 E2E、fail-closed PID 归属保护、原子配置替换、`<2KB` 轻量热更新、低上下文预警及零尺寸波纹卸载）。

**Full Changelog**: https://github.com/0DNANCY/agy-claude-style/compare/v1.3.0...v2.0.0

---

## [v1.3.0] - 2026-11-20

- **Remote（Cloud）模式 Token HUD 与用量遥测支持（#11）**：接入 `AgentState` 流式遥测与状态订阅，解决 Remote 会话下 HUD、状态条、内联统计与 `#T` 轮次徽章缺失的问题，并支持带有 `v1/default/jetski_remote_agents_3p/...` 前缀的 `cascadeId` 与更准确的模型上下文上限/速度统计。
- **CI / Release 工作流优化与产物命名统一（#12）**：引入共享工作流 `.github/workflows/_build-and-test.yml`，统一输出 `AGY-Claude-Style-v<version>-Windows-x64.exe`、`AGY-Claude-Style-v<version>-macOS-universal.dmg` 与 `SHA256SUMS.txt`。

**Full Changelog**: https://github.com/0DNANCY/agy-claude-style/compare/v1.1.1...v1.3.0

---

## [v1.1.1] - 2026-11-20

- 修复 PR #8 复查反馈的问题（#9、#10）：加固 CDP 自动重启接管前对原生可执行路径的校验，修复流式回复阶段 `#T` 徽章跳位与用量统计双倍计数，并降低全局 DOM 监听开销。

**Full Changelog**: https://github.com/0DNANCY/agy-claude-style/compare/v1.1.0...v1.1.1

---

## [v1.1.0] - 2026-11-20

- 适配 **Antigravity 2.33.0+** 默认关闭 CDP 调试端口的变更（#2、#3、#5、#6、#7、#8）：新增 `--launch` / `--relaunch`、默认启用 `autoRelaunchWithCdp`、Windows 开始菜单启动快捷方式与 macOS `launch-antigravity.command`，修复 Token HUD 实时刷新、对话轮次统计与侧边栏样式。

**Full Changelog**: https://github.com/0DNANCY/agy-claude-style/compare/v1.0.0...v1.1.0

---

## [v1.0.0] - 2026-11-15

- 首个公开版本（#1）：基于 CDP 的 Antigravity 无损实时样式注入、Studio 首页与字符波纹场、Token HUD、5 语言翻译、像素螃蟹 `Clawd`、思考强度滑块，以及 Windows（C#）与 macOS（Swift Universal）独立免 Node.js 安装器。
