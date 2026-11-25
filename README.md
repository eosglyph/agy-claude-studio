<div align="center">

<img src="assets/clawd-banner.svg" alt="Claude Studio Banner" width="840" />

# Claude Studio

**`agy-claude-studio`** — Native UI Aesthetics & Productivity Plugin for **Google Antigravity 2.33.1+ (v2.35.x Ready)**

Claude Warm-Gray & Obsidian Palettes · 3-Tab Studio Sidecar (`Chat | Tools | Settings`) · 0-Token Mobile Push · Gemini 4 Periodic Table & Direct Sync · 4 Native Skills · Pixel Clawd Mascot

<p>
  <img src="https://img.shields.io/badge/Antigravity-2.33.1%2B%20%7C%202.35.x-18181b?style=flat-square" alt="Antigravity 2.33.1+ / 2.35.x" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-18181b?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/MCP_Tools-0_Tokens-2f855a?style=flat-square" alt="Zero Token MCP" />
  <img src="https://img.shields.io/badge/i18n-5_Languages-3b82f6?style=flat-square" alt="5 Languages" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-d97757?style=flat-square" alt="MIT License" /></a>
</p>

<p>
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

[Preview](#preview) · [Features](#features) · [Quick Install](#quick-install) · [Companion Plugin](#companion-plugin) · [Configuration](#configuration) · [FAQ](#faq) · [Credits](#credits--license)

</div>

---

> **About this project**: `Claude Studio` (`agy-claude-studio`) is an independently evolved community edition based on [0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style) `v2.1.0`. It injects non-destructively at runtime via Antigravity's built-in **Chrome DevTools Protocol (CDP)** — **zero host file modification, zero conversation token overhead**, and one-click restore to the native UI at any time.

---

<a id="preview"></a>
## Preview

<div align="center">

#### v2.2 Full Workspace Overview (Claude Warm-Gray + 3-Tab Sidecar + Live Activity)
<img src="assets/screenshots/studio-overview.png" alt="Claude Studio v2.2 Full Workspace Overview" width="880" />

<br/>

#### Gemini 4 Periodic Table Model Selector
<img src="assets/screenshots/periodic-selector.png" alt="Gemini 4 Periodic Table Model Selector" width="760" />

<br/>

#### 60fps Effort Slider & Minimalist Composer
<img src="assets/screenshots/effort-slider.png" alt="Effort Slider and Restyled Composer" width="760" />

<br/>

#### Native "Claude Studio" Tools Tab × "Usage Monitor" Synergy
<table>
  <tr>
    <td align="center" width="50%">
      <img src="assets/screenshots/studio-panel.png" alt="Claude Studio Control Panel" width="308" /><br/>
      <sub><b>Claude Studio Tools Tab (v2.2)</b>: 1-click apply, mobile push quick panel &amp; local script runner</sub>
    </td>
    <td align="center" width="50%">
      <img src="assets/screenshots/usage-monitor-pair.png" alt="Usage Monitor Companion" width="308" /><br/>
      <sub><b>Usage Monitor Companion</b>: selectable right-pane pinning (<code>Studio</code> / <code>Usage Monitor</code> / <code>Off</code>) with smart footer splitting</sub>
    </td>
  </tr>
</table>

</div>

---

<a id="features"></a>
## Features

| Module | Highlights |
| --- | --- |
| **3-Tab Sidecar (`Chat \| Tools \| Settings`)** | Clean minimalist flat UI with a **1-click header upgrade** (works for both Git clones and non-Git plugin installs while preserving `PLUGIN_DATA/`). The **Chat** tab shows live workspace, Git branch, billed-aligned context breakdown, connectors, and real-time activity (waiting, reasoning, commands, streaming previews, and expandable subagents). |
| **Mobile Push Alerts (Zero Tokens)** | Get pinged on your phone when long tasks finish or fail across **8 channels** — **ServerChan** (full Markdown up to ~28KB), **Bark (iOS)**, **ntfy**, **Feishu**, **DingTalk**, **WeCom**, **Telegram Bot**, and **custom Webhooks** — with duration filtering (default 3 min), idle/error/cancel rules, and isolated local credentials in `PLUGIN_DATA/notify.json`. |
| **Model, Reasoning & `/compact` UX** | **Gemini 4 Periodic Table** with direct AI Studio metadata sync; **Orchestrator quick switch** beside the model selector with persisted effort and running-turn locking; **60fps Effort Slider**; and smart **`/compact` presets** (auto-select, inline hint, 4 customizable presets defaulting to `clean`). |
| **Local Tools & 4 Native Skills** | **Tools** tab to manage and run local Node / Python / Shell scripts with live output, pre-seeded with the bundled **Antigravity changelog checker** (`scripts/fetch-agy-changelog.mjs`). Ships **4 native skills**: `studio-setup` (30s guided setup), `studio-doctor` (diagnostics & NL tuning), `studio-notify` (push wizard), and `studio-translation-protect` (manage i18n exclusions). |
| **Themes, Localization & i18n Protocol** | `claude`, `obsidian`, and `host` palettes; standalone frosted glass with subtle unfocused glow; `logoInk` top-left icon tinting; 5-language live localization across main window, **Swarm (`/swarm`)**, and Antigravity **v2.35.x** (plus an on-demand Marketplace Google Translate pill); standard opt-out attributes + cloud protection list + custom ignore selectors. |
| **Workspace & Pixel Mascot Clawd** | Compact Claude-style composer & sidebar, CJK IME-friendly smooth caret, Studio home dashboard & ASCII ripple canvas, and the 19-state pixel companion **Clawd** (poke, tickle, drag, nap, auto-dodge). |

---

<a id="companion-plugin"></a>
## Companion Plugin: `antigravity-usage-monitor`

`Claude Studio` focuses on **visual aesthetics, interaction craft, live workspace inspection, and localization**. For live token throughput (`tok/s`), TTFT latency, cost estimates, and multi-model quota pools, we recommend pairing it with the independent plugin **[yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor)**:

- **Zero-conflict coexistence**: Built-in lightweight HUD defaults to a clean top bar (`usageStatsEnabled: true`, `hudTopBar: true`, `hudBottomBar: false`, `hudRimProgress: false`) and can be toggled off anytime in Settings. The i18n engine permanently skips `#ag-usage-monitor-*` via the built-in `i18n-compat.json` protection list.
- **Smart footer splitting**: When `usage-monitor` is docked in the composer footer, its context progress ring is seamlessly mirrored to the far right without layout jitter or crowding.
- **3-way right-pane pinning (`pinRightPane`)**: Choose `Off`, `Studio Chat Pane` (default), or `Usage Monitor` in Settings — legacy `pinUsageMonitorPane` configs migrate automatically, and installs without `usage-monitor` fall back gracefully.
- **Clean license boundary**: This project is **MIT**-licensed while `antigravity-usage-monitor` is **GPLv3**-licensed — strictly decoupled and installed independently.

---

<a id="quick-install"></a>
## Quick Install

### Requirements
- **Google Antigravity Desktop `2.33.1+`** (fully tested through `2.35.x`; Windows / macOS) launched with `--remote-debugging-port=0`.
- **Node.js `>= 22`** (zero third-party npm dependencies; uses native `fetch`, `WebSocket`, and `node:test`).

### Fastest Way: Ask Gemini in Antigravity (Recommended)

No terminal needed — just paste this repository URL into any Antigravity chat and say:

> **Help me install this Antigravity plugin: `https://github.com/eosglyph/agy-claude-studio`**

Once installed, you can also ask Gemini to run the built-in **`studio-setup`** skill (*"Walk me through 30s Claude Studio setup"*) or **`studio-notify`** (*"Help me set up mobile push alerts"*).

> **Optional · Full Dual-Pane Setup**: Want the exact dual-pane experience with the standalone companion plugin (GPLv3)? Ask Gemini:
>
> **Help me install `https://github.com/eosglyph/agy-claude-studio` along with the companion plugin `https://github.com/yuhuan-dev/antigravity-usage-monitor`**

### Option 1: Antigravity Native Plugin (Manual)

1. Clone this repository into your Antigravity plugins directory:
   ```powershell
   # Windows (PowerShell)
   git clone https://github.com/eosglyph/agy-claude-studio.git "$env:USERPROFILE\.gemini\config\plugins\agy-claude-studio"
   ```
   ```bash
   # macOS / Linux
   git clone https://github.com/eosglyph/agy-claude-studio.git "$HOME/.gemini/config/plugins/agy-claude-studio"
   ```
2. Fully quit Antigravity (including the system tray icon) and relaunch with `--remote-debugging-port=0` (or run `launch.bat` / `./launch.sh` from the repo).
3. Verify **`Claude Studio`** is enabled under **Customizations → Plugins** — it auto-injects and adds the **Claude Studio** panel to your right Aux Pane.
   > Migrating from legacy `agy-claude-style`? On first launch, your existing `plugin_data/agy-claude-style/config.json` is automatically migrated. Disable or remove the legacy plugin folder to avoid duplicate watchers.

<details>
<summary><b>Option 2: Standalone Windows / macOS Installers (No Node.js Required) & Companion Launcher</b></summary>

- **Pre-built Releases**: Grab `Claude-Studio-v<version>-Windows-x64.exe` or `Claude-Studio-v<version>-macOS-universal.dmg` directly from [GitHub Releases](https://github.com/eosglyph/agy-claude-studio/releases).
  > **macOS note**: The Universal `.dmg` passes GitHub Actions CI builds and the automated test suite, and currently awaits real-hardware Mac verification — feedback from macOS users is very welcome.

- **Build Windows standalone installer locally**:
  ```bash
  npm run build:installer
  ```
  Produces a single-file `Claude-Studio-v<version>-Windows-x64.exe` with native C# watcher (`agy-claude-studio-watcher.exe`), supporting both **Managed Mode (0 background processes after host closes)** and **Autostart Daemon Mode**, plus standard uninstall via Windows Settings → Apps.

- **Windows companion launcher pack (with custom Gemini × Clawd icon)**:
  ```powershell
  npm run build:release
  powershell -NoProfile -ExecutionPolicy Bypass -File .\companion\setup-companion.ps1
  ```
  Automatically yields to the native plugin when installed and simply launches Antigravity with `--remote-debugging-port=0` and the custom icon.

- **Build macOS Universal `.app` / `.dmg` locally**:
  ```bash
  npm run build:macos
  ```
  Produces a Universal (`arm64` + `x86_64`) `Claude Studio.app` and `Claude-Studio-v<version>-macOS-universal.dmg`. On first launch, right-click → **Open** or run `xattr -cr "/Applications/Claude Studio.app"` if Gatekeeper prompts for ad-hoc signed binaries.

</details>

<details>
<summary><b>Option 3: Node.js CLI / Local Development</b></summary>

```bash
cp config.example.json config.json   # Optional; built-in defaults work out of the box
npm run inject                        # One-shot injection into current windows
npm run watch                         # Hot-reload watcher (auto-applies code/config edits)
npm run remove                        # Stop watcher and restore native UI cleanly
```

</details>

---

## Meet Clawd

<div align="center">
  <img src="assets/clawd-moods.svg" alt="Clawd Pixel Moods" width="840" />
</div>

| Interaction | Gesture | Reaction |
| --- | --- | --- |
| Poke | Click left or right side | Shy head turn (`poke-left` / `poke-right`) |
| Tickle | 4 rapid clicks within `450ms` | Laughing leg-kick (`tickle`) |
| Pick up | Click & drag | Dangling wiggle, drops softly on release (`drag`) |
| Nap | Idle for 60s+ | Falls asleep (`sleeping`), stretches awake on click or new message (`waking`) |
| Live state | Thinking / typing / error / done | Mirrors agent activity and automatically dodges Q&A cards and queue bars |

---

<a id="configuration"></a>
## Configuration

All settings can be toggled live in the right-side **Claude Studio** panel and persist automatically (full schema in [config.example.json](config.example.json)). Mobile push settings and credentials are stored separately in local `PLUGIN_DATA/notify.json` and are never written to `config.json` or injected into renderer pages.

<details>
<summary><b>View all configuration keys</b></summary>

| Group | Key | Values / Type | Default | Description |
| --- | --- | --- | --- | --- |
| Basic | `language` | `'zh-CN'` \| `'zh-TW'` \| `'yue'` \| `'en'` \| `'ja'` | `'zh-CN'` | UI & Studio panel language |
| Basic | `homeLayout` | `'studio'` \| `'classic'` \| `'off'` | `'studio'` | New conversation home screen layout |
| Basic | `palette` | `'claude'` \| `'obsidian'` \| `'host'` | `'claude'` | Solid color theme palette |
| UI Polish | `glassEffect` | `boolean` | `true` | Frosted glassmorphism borders, image viewer pills & subtle ambient glow |
| UI Polish | `sidebarRestyle` / `sidebarCompact` | `boolean` | `true` | Claude-style sidebar density & hover polish |
| UI Polish | `composerRestyle` / `placeholderStyle` | `boolean` / `'studio'` \| `'host'` | `true` / `'studio'` | Minimalist composer & prompt placeholder copy |
| UI Polish | `logoInk` | `'accent'` \| `'foreground'` | `'accent'` | Home & top-left app logo tint mode |
| Interaction | `periodicSelector` / `orchestratorSwitch` | `boolean` | `true` | Gemini 4 Periodic Table selector & Orchestrator quick switch |
| Interaction | `effortSliderStyle` / `effortAccent` | `'chatgpt'` \| `'claude'` / `boolean` | `'chatgpt'` / `true` | 60fps effort slider style & color scale |
| Interaction | `compactPreset` / `compactCustomText` | `'empty'` \| `'clean'` \| `'dev'` \| `'custom'` / `string` | `'clean'` / `''` | `/compact` preset & custom prompt text |
| Interaction | `smoothCaret` / `mascot` / `homeRipple` | `boolean` / `'crab'` \| `'off'` / `boolean` | `true` / `'crab'` / `true` | Smooth caret, Clawd mascot & home ripple field |
| Localization | `pluginPageTranslate` / `i18nIgnoreSelectors` | `boolean` / `string[]` | `true` / `[]` | Marketplace on-demand Google Translate pill & custom protected CSS selectors |
| Usage & Pane | `pinRightPane` | `'off'` \| `'studio'` \| `'usage-monitor'` | `'studio'` | Auto-open right Aux Pane per conversation (migrates legacy `pinUsageMonitorPane`) |
| Usage & Pane | `usageStatsEnabled` | `boolean` | `true` | Master toggle for built-in HUD (preserves child prefs when off) |
| Usage & Pane | `inlineStats` / `ringMode` / `turnBadges` | `boolean` / `'context'` \| `'quota'` / `boolean` | `true` / `'context'` / `true` | *(Requires `usageStatsEnabled`)* Inline stats, context/quota ring & turn `#T` badges |
| Usage & Pane | `hudTopBar` / `hudBottomBar` / `hudRimProgress` | `boolean` | `true` / `false` / `false` | *(Requires `usageStatsEnabled`)* Top HUD bar, bottom bar & rim progress bar |
| Runtime | `autoRelaunchWithCdp` / `exitOnHostClose` / `pollIntervalMs` | `boolean` / `boolean` / `number` | `true` / `false` / `2500` | CDP relaunch behavior, host-exit lifecycle & polling interval |

</details>

---

<a id="faq"></a>
## FAQ

<details>
<summary><b>1. Not auto-injecting after updating to Antigravity 2.33.0+?</b></summary>

Starting in `2.33.0`, Antigravity disables the CDP port by default. Fully quit Antigravity (including the system tray) and launch it with `--remote-debugging-port=0`, or use the one-click relaunch button in the Studio panel / `launch.bat` / `./launch.sh` — or simply ask Gemini *"Diagnose Claude Studio"* to run the `studio-doctor` skill.

</details>

<details>
<summary><b>2. Why is the "Usage Monitor" option unavailable in Right Pane Pinning?</b></summary>

That option pairs with the independent companion plugin [yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor). Once installed, refresh status in the Studio panel to activate it — or keep `pinRightPane` on **Studio Chat Pane** with the built-in lightweight HUD enabled.

</details>

<details>
<summary><b>3. Why are sidebar right-click context menus still in English?</b></summary>

Native context menus are rendered by Electron via OS APIs (Win32 / NSMenu) outside the web DOM, so non-destructive CDP injection cannot rewrite OS menu strings. All in-app DOM views, settings, dialogs, and the Swarm sidecar support full 5-language localization.

</details>

<details>
<summary><b>4. How do I completely restore the native Antigravity UI?</b></summary>

Click **Restore Native** in the **Claude Studio** panel, disable `Claude Studio` in Antigravity Plugins, or run `npm run remove`. Zero host files are ever modified.

</details>

---

## Development & Testing

```bash
npm test                 # Run full unit & integration test suite (Node.js >= 22, zero deps)
npm run build:installer  # Build Windows single-file x64 installer
npm run build:release    # Build Windows companion launcher release pack
npm run build:macos      # Build macOS Universal .app & .dmg (macOS only)
```

<details>
<summary><b>Project Structure</b></summary>

```text
agy-claude-studio/
├── plugin.json / mcp_config.json / hooks.json  # Native plugin manifest, 0-token MCP host & Stop hook
├── plugin/mcp-host.js                          # Native lifecycle host (PID-reuse check & hot takeover)
├── sidecars/studio/                            # 3-Tab right Aux Pane (Chat | Tools | Settings)
├── skills/                                     # 4 native skills (setup, doctor, notify, translation-protect)
├── cdp.js / lifecycle.js                       # CDP client, config migration, lockfile & host watchdog
├── watcher-core.js / inject.js                 # Multi-window hot-reload controller & CLI entry
├── style.css / ui-runtime.js                   # Core theme styles & UI runtime (home, periodic, slider, /compact)
├── sidecar-core.js                             # Lightweight reversible i18n runtime for Swarm sidecar (/swarm)
├── periodic-core.js / periodic-sync.js         # Gemini 4 Periodic Table catalog & direct AI Studio sync
├── effort-core.js                              # Dual-style 60fps reasoning effort slider model
├── notify-core.js / scripts/notify-stop.mjs    # 0-token 8-channel mobile push engine & Stop hook runner
├── scripts-core.js / scripts/fetch-agy-changelog.mjs # Local scripts toolbox & Antigravity changelog fetcher
├── i18n-core.js / i18n-locales.js / i18n-compat.json # 5-language i18n engine, dicts & opt-out protection list
├── usage-core.js                               # Built-in trajectory parser, token breakdown & heatmap engine
├── mascot-core.js / crab-assets.js             # Clawd state machine & 19 dual-layer pixel sprite sets
├── ripple-core.js                              # Home ASCII noise field & 2D wave solver
├── installer/ & companion/                     # Windows (C#) / macOS (Swift) installers & companion scripts
├── scripts/ & test/                            # Build pipelines & node:test automated test suite
└── assets/                                     # Icons, animated banners & UI screenshots
```

</details>

---

<a id="credits--license"></a>
## Credits & License

Released under the [MIT License](LICENSE). Heartfelt thanks to the upstream authors and community contributors:

- **Upstream Repository**: [0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style) (MIT License)
- **Original Inspiration & Early Source**: [Nwflower/dsh-claude-style](https://github.com/Nwflower/dsh-claude-style)
- **macOS Daemon Memory Pool & CDP Connection Reuse**: [SeredenFei/agy-claude-style](https://github.com/SeredenFei/agy-claude-style)
- **Native Plugin Hosting, Aux Pane & 2.33.1 Compat**: [Gruu6y/agy-claude-style](https://github.com/Gruu6y/agy-claude-style)
- **Glassmorphism & Floating Image Viewer Inspiration**: [MCRYII/antigravity-custom-themes](https://github.com/MCRYII/antigravity-custom-themes)
- **Codex Effort Slider Visual Design**: [Microqian2th/dsh-codex-effort-slider](https://github.com/Microqian2th/dsh-codex-effort-slider)
- **Recommended Companion Usage Monitor (GPLv3, standalone)**: [yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor)
