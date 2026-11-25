---
name: studio-doctor
description: >-
  Claude Studio 一键诊断、自愈与自然语言调参助手。当用户遇到「主题/汉化没生效」「Antigravity 更新后样式消失」「找不到调试端口」「侧边栏异常」，或想直接用自然语言切换配色/定制 /compact 预设时触发。
---

# Claude Studio 一键诊断与自愈助手 (`studio-doctor`)

快速排查并修复 `Claude Studio`（`agy-claude-studio`）的注入、CDP 调试端口、配置文件或侧边栏异常，同时支持用自然语言快速修改主题或 `/compact` 预设文案。

## 场景 A：故障诊断与一键修复

按顺序执行只读排查，定位真正病因后再动手修复：

1. **检查安装与配置完整性**：
   - 确认插件目录（`~/.gemini/config/plugins/agy-claude-studio`）关键文件齐全（`plugin.json`、`cdp.js`、`inject.js`、`ui-runtime.js`、`style.css`、`i18n-core.js`、`i18n-locales.js`、`sidecars/studio/main.mjs`）。
   - 检查 `~/.gemini/antigravity/plugin_data/agy-claude-studio/config.json` 是否为合法 JSON，必要时用 `cdp.js` 的 `sanitizeConfig` 检查字段合法性（切勿丢失用户配置）。
2. **检查 CDP 调试端口与进程状态**：
   - 运行插件目录下的 `node inject.js`（最直接、安全的一键探活与热重注入）。
   - 如果输出提示 **未找到调试端口 / Antigravity 未带 `--remote-debugging-port` 启动**：
     - 清晰向用户解释：Antigravity 需要通过带调试端口的快捷方式启动（或通过 Claude Studio 侧边栏点击「带调试端口重启」）；
     - 绝不擅自强杀正在运行的 Antigravity 主进程，先征得用户同意或引导其点击侧边栏按钮重启。
3. **检查侧边栏（Studio Sidecar）同步问题**：
   - 若用户反馈「改了新开关没保存 / 看不到新功能」，提示可能是 Antigravity 更新插件文件后 sidecar 进程尚未重启，引导用户在插件管理中重载 `Claude Studio` 或重启一次 Antigravity 即可。
4. **验证并简明汇报**：给出「问题原因 + 已执行动作 + 当前状态」三行清晰结论。

## 场景 B：自然语言快捷改配置

当用户说类似「换成黑曜石主题」「把 `/compact` 预设改成保留接口文档和报错堆栈」「关掉像素螃蟹」时：
1. 对照插件目录 `cdp.js` 中的 `DEFAULT_CONFIG` 与 `CONFIG_VALIDATORS` 确认合法键名与取值（如 `palette`、`glassEffect`、`language`、`pluginPageTranslate`、`pinRightPane`、`orchestratorSwitch`、`periodicSelector`、`compactPreset`、`compactCustomText`、`mascot`、`smoothCaret`、`homeRipple`、`usageStatsEnabled` 等）。
2. 通过 `cdp.js` 的 `updateConfigSetting` 安全写入 `config.json`。
3. 运行 `node inject.js` 立即热生效，并告知用户已生效（随时可撤销）。
