---
name: studio-translation-protect
description: >-
  Claude Studio 翻译保护名单管理助手。当用户说「某插件/某区域被 Claude Studio 误翻了」「把 XX 加入翻译保护名单」「查看或移除翻译保护名单」「不要翻译 XX」时触发。交互式定位精准 DOM 选择器并安全写入 i18nIgnoreSelectors。
---

# Claude Studio 翻译保护名单助手 (`studio-translation-protect`)

帮助用户把容易被误翻的第三方插件界面或特定 UI 区域安全加入 / 移出 `Claude Studio` 的自定义翻译保护名单（`config.json` 中的 `i18nIgnoreSelectors`），全程无需用户手写 CSS 选择器。

## 安全红线

1. **严禁写入过宽选择器**：绝不允许把 `div`、`span`、`p`、`body`、`html`、`main`、`button`、`*` 等通用标签或通配符写入 `i18nIgnoreSelectors`，否则会破坏全站界面翻译。
2. **优先最窄、最稳定的根选择器**：优先选用插件专属 ID（如 `#my-plugin-root`、`[id^="my-plugin-"]`）、专属 `data-testid` 或唯一插件容器类名。
3. **落盘前必须向用户确认**：展示即将添加/移除的选择器及作用范围，用户点头后再写入。

## 标准流程

### 第一步：明确目标插件或区域

- 若用户已说明具体插件名（例如某款第三方插件）或页面位置，直接进入第二步。
- 若用户表述较模糊（如“有个地方被翻乱了”），用简短问题或 `ask_question` 问清：
  1. 是哪个已安装的插件或界面区域（侧边栏 / 底栏 / 弹窗 / 设置页）？
  2. 想**新增保护**、**查看当前保护名单**，还是**移除已有规则**？

### 第二步：定位精准选择器

1. 读取现有配置 `~/.gemini/antigravity/plugin_data/agy-claude-studio/config.json` 中的 `i18nIgnoreSelectors` 以及插件内置的 `i18n-compat.json`（只读参考，不改内置文件）。
2. 查找目标插件的精准根选择器（任选最快方式）：
   - 检查 `~/.gemini/config/plugins/` 下对应插件的源码（查找其挂载的 DOM ID / 专属 class / `data-testid`）；
   - 或在用户允许且目标界面当前可见时，通过本机 Antigravity CDP 端口只读检查目标元素的 ID / `data-testid` / 根容器属性。
3. 校验候选选择器：确认它是合法 CSS 选择器、足够精准且不在 `i18n-compat.json` 已内置的规则里重复。

### 第三步：确认、写入并热生效

1. 向用户简洁展示：「将把 `<选择器>` 加入翻译保护名单，仅保护 `<插件/区域名>` 不被翻译，不影响其余界面」，征得确认（若用户已明确指令添加特定插件且选择器 100% 唯一明确，也可直接写入并告知支持随时撤销）。
2. 通过插件目录 `cdp.js` 的 `updateConfigSetting('i18nIgnoreSelectors', nextList)` 原子写入 `config.json`（避免破坏其他配置）。
3. 运行插件目录下的 `node inject.js` 热刷新当前窗口，让被误翻的区域立即恢复原文并汇报结果。
