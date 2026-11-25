---
name: studio-setup
description: >-
  Claude Studio 30 秒新手引导与偏好配置向导。当用户刚安装 Claude Studio、请求「新手引导 / 初始配置 / 快速设置主题与功能偏好 / 一键调教 Claude Studio」时触发。通过原生交互选择卡片一次性收集偏好并热应用，零弹窗打扰。
---

# Claude Studio 新手引导与偏好向导 (`studio-setup`)

用 1 轮精炼的交互式选择卡片，帮助用户在 30 秒内把 **Claude Studio (`agy-claude-studio`)** 配置成最顺手的样子并立刻热生效。

## 核心原则

1. **优先用 `ask_question` 交互选择卡片**：让用户点选，不要抛出一长串纯文本问题让用户打字。
2. **一次问完、一次落盘**：最多 1 轮（3~4 个精选问题），拿到答案后一次性写入插件配置并热刷新，立即见效。
3. **不泄露凭据**：如果用户勾选了「手机推送」，不要把 Key 写进 `config.json`，完成后无缝转入 `studio-notify` 技能引导配置。

## 标准流程

### 第一步：弹出偏好选择卡片

调用 `ask_question` 向用户呈现 3 个简洁问题（如果用户用英文/日文沟通，对应切换提问语言）：

1. **外观与质感（单选）**：
   - `(Recommended) Claude 暖灰 + 毛玻璃质感` → `palette: "claude"`, `glassEffect: true`, `homeLayout: "studio"`
   - `黑曜石暗夜 + 毛玻璃质感` → `palette: "obsidian"`, `glassEffect: true`, `homeLayout: "studio"`
   - `保留 Antigravity 官方原色（只用汉化与效率功能）` → `palette: "host"`, `glassEffect: false`, `homeLayout: "off"`
2. **界面语言与翻译（单选）**：
   - `(Recommended) 简体中文 + 插件市场谷歌一键翻译` → `language: "zh-CN"`, `pluginPageTranslate: true`
   - `繁體中文 + 插件市場一鍵翻譯` → `language: "zh-TW"`, `pluginPageTranslate: true`
   - `粵語 + 插件市場一鍵翻譯` → `language: "yue"`, `pluginPageTranslate: true`
   - `日本語 + マーケットプレイス翻訳` → `language: "ja"`, `pluginPageTranslate: true`
   - `English（保持英文原版）` → `language: "en"`, `pluginPageTranslate: false`
3. **想要开启哪些增强功能？（多选 `is_multi_select: true`，每个选项相互独立，不勾选即保持极简）**：
   - `(Recommended) 协作模式快捷开关 + 元素周期表选模型` → 勾选：`orchestratorSwitch: true`, `periodicSelector: true`；未勾选：`orchestratorSwitch: false`, `periodicSelector: false`
   - `(Recommended) /compact 一键压缩预设（精简降噪）` → 勾选：`compactPreset: "clean"`；未勾选：`compactPreset: "empty"`
   - `像素螃蟹 Clawd + 丝滑光标 + 首页波纹` → 勾选：`mascot: "crab"`, `smoothCaret: true`, `homeRipple: true`；未勾选：`mascot: "off"`, `smoothCaret: false`, `homeRipple: false`（即极简无装饰）
   - `任务完成时手机推送提醒（稍后引导配置）` → 勾选：标记待衔接 `studio-notify`

> 注意：以上 4 项均为正向独立开关，禁止在同一多选题内放入互斥选项；若用户全部不选（或选「其他」说明只要极简），则按上述未勾选值写入极简配置。

### 第二步：定位插件目录并批量写入配置

1. 定位已安装的 `agy-claude-studio` 目录（优先级：`~/.gemini/config/plugins/agy-claude-studio` 或当前工作区）与数据目录 `~/.gemini/antigravity/plugin_data/agy-claude-studio/config.json`。
2. 使用插件自带的 `cdp.js`（`updateConfigSetting` / `sanitizeConfig` + `writeFileAtomic`）将用户选择的所有偏好安全写入 `config.json`（保留用户已有且本次未涉及的配置项）。
3. 执行插件目录下的 `node inject.js`（或仅当需要刷新侧边栏时提示），让所有视觉与语言偏好在当前 Antigravity 窗口**零重启热生效**。

### 第三步：输出 3 行速览 + 衔接

向用户简洁总结：
- 已生效的核心偏好（配色、语言、开启的功能）；
- 3 个平时最顺手的入口：
  1. 右侧边栏打开 **Claude Studio** 随时微调所有开关（可直接附带打开侧边栏的导航链接或引导通过侧边栏打开）；
  2. 插件市场页面顶部点击 **「翻译此页」** 可 0 额度一键调用谷歌翻译并秒切原文；
  3. 遇到其他插件被误翻，随时说「帮我把 XX 加入翻译保护名单」（触发 `studio-translation-protect`）；遇到样式没生效随时说「帮我诊断 Claude Studio」（触发 `studio-doctor`）。
- 若用户在第 3 题勾选了「手机推送提醒」，立即询问是否现在接着用 `studio-notify` 配好手机推送。
