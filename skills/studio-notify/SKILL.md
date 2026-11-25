---
name: studio-notify
description: >-
  Claude Studio 0-Token 手机推送配置与排障向导。当用户想配置任务完成手机提醒（Server酱微信、Bark iOS、ntfy、飞书、钉钉、企业微信、Telegram、Webhook），或排查「为什么没收到手机推送」「开启 Server酱 28KB 全文 Markdown 推送」时触发。
---

# Claude Studio 手机推送配置与排障向导 (`studio-notify`)

指导用户安全配置或排查 `Claude Studio` 的 **0-Token `Stop` Hook 手机推送**（任务结束时自动将摘要或全文推送到手机，完全不消耗模型 Token）。

## 安全铁律

1. **凭据绝对隔离**：所有推送密钥（`sendKey`、`deviceKey`、`webhookUrl`、`botToken`、`token`、`authHeader`）**只能**存放在本机隔离文件 `~/.gemini/antigravity/plugin_data/agy-claude-studio/notify.json`（权限 `0600`）。
2. **严禁泄露**：绝不允许把任何推送 Key/Webhook 写入 `config.json`、代码仓库、Git 提交记录或注入到渲染进程 JS；在回复中展示已保存凭据时必须打码（仅保留前 4 位与后 4 位）。
3. **Server酱全文推送范围**：28KB 完整 Markdown 正文推送（`channels.serverchan.fullMarkdown`，带 64 字卡片预览与 `noip: 1`）**仅适用于 Server酱通道**，其余 7 个通道保持精简摘要。

## 场景 A：首次配置向导

1. 如果用户未指定推送渠道，用 `ask_question` 帮用户快速选通道：
   - `(Recommended) 微信接收 → Server酱 (ServerChan)`（支持 28KB 完整 Markdown 回复直推微信，零装 App）
   - `iPhone / iPad 原生推送 → Bark`（超轻量、低延迟）
   - `跨平台免费推送 → ntfy`（iOS / Android 均支持）
   - `办公群机器人 → 飞书 / 钉钉 / 企业微信`
   - `其他 → Telegram Bot / 自定义 Webhook`
2. 告知用户最稳妥的填写方式：
   - **方式 1（推荐）**：直接在右侧栏 **Claude Studio → 设置 → 手机推送** 填入凭据、勾选「开启手机推送」并点击「发送测试」（后续也可在 **工具** 页的折叠卡片里一键开关与改阈值）；
   - **方式 2（对话代填）**：若用户愿意直接发凭据给你，由你通过 `notify-core.js` 的 `writeNotifyConfig` 安全写入 `PLUGIN_DATA/notify.json`，并调用 `deliverNotification` 立即发一条真实测试消息验证通路。
3. 顺手确认 3 个实用项：
   - **最短耗时门槛**（`minDurationSec`，默认 `180` 秒 / 3 分钟，短对话不打扰）；
   - **防打扰过滤**：是否仅在后台全空闲时推送（`onlyFullyIdle`，默认开启）、异常报错立即推送（`notifyOnError`，默认开启）、手动停止时不推送（`skipUserCanceled`，默认开启）；
   - 若选了 **Server酱**，确认是否开启「推送完整 Markdown 全文（最高约 28KB）」（默认开启）。

## 场景 B：没收到推送的快速排障清单

按以下顺序逐项检查（只读诊断，不打印明文密钥）：
1. 检查 `~/.gemini/antigravity/plugin_data/agy-claude-studio/notify.json` 是否存在、`enabled` 是否为 `true`、所选通道凭据是否非空。
2. 检查 `~/.gemini/config/plugins/agy-claude-studio/hooks.json` 是否正确指向 `scripts/notify-stop.mjs`。
3. 检查是否命中静默过滤条件：
   - 本轮任务耗时是否小于 `minDurationSec`（默认 `180s` / 3 分钟）？
   - 是否开启了 `onlyFullyIdle` 而此时仍有子代理或后台任务在运行？
   - 是否为用户手动点击停止（命中 `skipUserCanceled`）或处于 `cooldownSec`（默认 20s）冷却窗口内？
4. 查看 `PLUGIN_DATA/notify-state.json` 中的最近一次投递状态，或直接触发一次测试推送定位 HTTP 状态码与接口返回信息，给出明确修复建议。
