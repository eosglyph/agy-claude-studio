<div align="center">

<img src="assets/clawd-banner.svg" alt="Claude Studio Banner" width="840" />

# Claude Studio

**`agy-claude-studio`** — Native UI Aesthetics & Productivity Plugin for **Google Antigravity 2.33.1+ (v2.35.x Ready)**

Claude Warm-Gray & Obsidian Palettes · 3-Tab Studio Sidecar (`Chat | Tools | Settings`) · Mobile Push Alerts · Gemini 4 Periodic Table & Direct Sync · 4 Native Skills · Pixel Clawd Mascot

<p>
  <img src="https://img.shields.io/badge/Antigravity-2.33.1%2B%20%7C%202.35.x-18181b?style=flat-square" alt="Antigravity 2.33.1+ / 2.35.x" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-18181b?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Zero_Deps-Node_22%2B-2f855a?style=flat-square" alt="Zero Dependencies (Node 22+)" />
  <img src="https://img.shields.io/badge/i18n-5_Languages-3b82f6?style=flat-square" alt="5 Languages" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-d97757?style=flat-square" alt="MIT License" /></a>
</p>

<p>
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

[Preview](#preview) · [Features](#features) · [Quick Install](#quick-install) · [Companion Plugin](#companion-plugin) · [Configuration](#configuration) · [FAQ](#faq) · [Credits](#credits--license)

</div>

---

> **About this project**: `Claude Studio` (`agy-claude-studio`) is a community-driven enhancement for Google Antigravity, evolved from [0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style). It connects seamlessly at runtime through Antigravity's built-in **Chrome DevTools Protocol (CDP)** — leaving host installation files completely untouched, adding no extra messages or prompt overhead to your conversations, and letting you return to the stock UI with a single click whenever you like.

---

<a id="preview"></a>
## Preview

<div align="center">

#### Full Workspace Overview (Claude Warm-Gray + 3-Tab Sidecar + Live Activity)
<img src="assets/screenshots/studio-overview.png" alt="Claude Studio Full Workspace Overview" width="880" />

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
      <sub><b>Claude Studio Tools Tab</b>: 1-click apply, mobile push quick panel &amp; local script runner with wide in-chat output card</sub>
    </td>
    <td align="center" width="50%">
      <img src="assets/screenshots/usage-monitor-pair.png" alt="Usage Monitor Companion" width="308" /><br/>
      <sub><b>Usage Monitor Companion</b>: selectable right-pane pinning (<code>Studio Chat Pane</code> / <code>Usage Monitor</code> / <code>Off</code>) with smart footer splitting</sub>
    </td>
  </tr>
</table>

</div>

---

<a id="features"></a>
## Features

Here is a quick tour of what Claude Studio adds on top of Antigravity—everything runs in memory over CDP, so your installation files stay untouched and you can switch back to the stock UI anytime.

### 3-Tab Studio Sidecar (`Chat | Tools | Settings`)
Docked in the right Aux Pane, the sidecar keeps things clean and flat with a full-width 3-column tab bar. The header stays on a single row even when you narrow the sidebar (secondary metadata tucks away automatically), and includes a 1-click button to check for and apply updates in place without touching your local configs.
- **Chat**: Shows your workspace path, active Git branch, connected tools, and a billing-aligned context breakdown by category (system prompt, MCP tools, skills, rules, and conversation). At the bottom, you get live task activity—waiting indicators, streaming previews, and an expandable list of running subagents.
- **Tools**: A local script runner for Node, Python, and Shell scripts, pre-seeded with an Antigravity changelog checker (`scripts/fetch-agy-changelog.mjs`). When you run a script, the output pops open in a **wide Markdown card right above the chat box** so it is comfortable to read—purely local, never triggering an AI turn. You can copy the output, collapse or expand it without losing logs, or re-open it anytime from the `Wide` button in the sidecar.
- **Settings**: Live toggles for themes, layout, effort slider style, language packs, and HUD options, all saved automatically.

### Chat File Link Right-Click Menu
When the assistant links a local file or drops an `@` mention pill in chat, you can right-click it to:
- **Open File** with your OS default app (restricted to safe document, code, and media file types).
- **Reveal in Folder** — on Windows, it uses `explorer.exe /select` directly for fast, flicker-free selection (falling back to the native helper only for edge cases like commas in paths); on macOS, it highlights the file in Finder.
- **Copy Full Path** straight to your clipboard.

Toggleable anytime via `fileLinkContextMenu` in Settings.

### Mobile Push Notifications
If you kick off a long refactor or batch run and step away from your desk, Claude Studio can ping your phone directly from your machine when the run finishes or hits an error.
- **8 supported channels**: ServerChan (supports full Markdown up to ~28KB), Bark (iOS), ntfy, Feishu, DingTalk, WeCom, Telegram Bot, and custom Webhooks.
- **Sensible defaults**: Filters out quick turns (default threshold is 3 minutes), alerts immediately on errors, and stays quiet if you cancel a run manually.
- Credentials and webhook URLs stay local in `PLUGIN_DATA/notify.json`—nothing is written to `config.json` or injected into web views.

### Model Picker, Reasoning Effort & `/compact`
- **Gemini 4 Periodic Table**: Organizes models into a clean periodic-table grid by tier and capability, with a direct sync option that pulls the latest model catalog and color accents from Google AI Studio.
- **Orchestrator Quick Switch**: Sits right next to the model picker so you can toggle multi-agent mode in one click. It remembers your choice across restarts and locks while a turn is running so you don't flip it mid-stream.
- **60fps Effort Slider**: A smooth reasoning-effort slider with both ChatGPT and Claude visual styles.
- **`/compact` Presets**: Four customizable context-compression presets — **Empty** (`empty`), **Clean Focus** (`clean`, default), **Dev Handoff** (`dev`), and **Custom** (`custom`). Picking one fills the composer without auto-sending, so you can tweak the prompt before hitting Enter.

### Localization & Marketplace Translation
- **Full Antigravity v2.35.2 Coverage**: Translates the main window, dialogs, and the `/swarm` multi-agent sidecar with a fast DOM observer engine.
- **On-Demand Language Packs**: English (`en`), Simplified Chinese (`zh-CN`), and Traditional Chinese (`zh-TW`) come bundled; Cantonese (`yue`) and Japanese (`ja`) download on demand with SHA-256 verification so the base install stays small.
- **Marketplace Translate Pill**: Adds an on-demand translate button on the Plugin Marketplace page. It makes no network requests until you click it, falls back automatically to a secondary provider if Google Translate rate-limits, and toggles cleanly back to the original text. Respects `translate="no"`, `.notranslate`, a cloud protection list, and your own custom CSS ignore selectors.

### Visual Polish, Loading Animation & Clawd
- **Themes & Craft**: Switch between warm `claude` paper gray, high-contrast `obsidian`, or your `host` theme, paired with optional frosted glass borders, `logoInk` top-left icon tinting, a CJK-friendly smooth typing caret, and a Studio home dashboard with an interactive ASCII wave ripple.
- **Loading Animation (`geminiLoader`)**: An optional toggle under Settings → UI Polish that swaps out Antigravity's large stock loading spinners for animated Gemini-chan with a crisp 12-tick overhead ring.
- **Pixel Companion Clawd**: A 19-state pixel crab that hangs out on your composer, reacts to pokes, tickles, drags, and assistant activity (thinking, typing, error, done), and automatically dodges Q&A cards or queue bars.

### 4 Native Skills
Built-in conversational workflows you can invoke right in chat:
- **`studio-setup`**: 30-second guided initial configuration.
- **`studio-doctor`**: Checks CDP connectivity, permissions, and running processes, and fixes common issues.
- **`studio-notify`**: Step-by-step wizard to set up and test mobile push notifications.
- **`studio-translation-protect`**: Helps you add custom CSS selectors to the translation exclusion list.

---

<a id="companion-plugin"></a>
## Companion Plugin: `antigravity-usage-monitor`

`Claude Studio` focuses on **visual aesthetics, interaction craft, live workspace inspection, and localization**. If you also want real-time generation speed (`tok/s`), time-to-first-token (TTFT) latency, cost estimates, and multi-model quota pools, we recommend pairing it with the independent companion plugin **[yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor)**:

- **Zero-Conflict Coexistence**: Claude Studio's built-in lightweight HUD defaults to a clean top bar (`usageStatsEnabled: true`, `hudTopBar: true`, `hudBottomBar: false`, `hudRimProgress: false`) and can be toggled off at any time in Settings. The localization engine permanently skips `#ag-usage-monitor-*` elements through the built-in `i18n-compat.json` protection list.
- **Smart Footer Splitting**: When `usage-monitor` docks into the composer footer, Claude Studio mirrors its context progress ring cleanly to the far right, eliminating layout collisions or visual clutter.
- **3-Way Right-Pane Pinning (`pinRightPane`)**: Choose `Off`, `Studio Chat Pane` (default), or `Usage Monitor` in Settings. Legacy `pinUsageMonitorPane` settings migrate automatically, and systems without `usage-monitor` fall back gracefully.
- **Clean License Boundary**: Claude Studio is licensed under **MIT**, while `antigravity-usage-monitor` is licensed under **GPLv3**. Both plugins are completely decoupled and install independently.

---

<a id="quick-install"></a>
## Quick Install

### Requirements
- **Google Antigravity Desktop `2.33.1+`** (tested through `2.35.x`; Windows / macOS / Linux) launched with `--remote-debugging-port=0`.
- **Node.js `>= 22`** (zero third-party npm dependencies; uses built-in `fetch`, `WebSocket`, and `node:test`).

### Fastest Way: Ask Gemini in Antigravity (Recommended)

No terminal commands needed. Simply paste this repository URL into any Antigravity conversation and ask:

> **Help me install this Antigravity plugin: `https://github.com/eosglyph/agy-claude-studio`**

Once installed, you can ask Gemini to run the built-in setup skills:
- *"Walk me through 30s Claude Studio setup"* (`studio-setup`)
- *"Help me set up mobile push alerts"* (`studio-notify`)
- *"Diagnose Claude Studio"* (`studio-doctor`)

#### Upgrading from an Older Version
If you already have Claude Studio installed and want to upgrade to the latest release, paste this prompt into Antigravity:

> **Please follow the Upgrade & Legacy Migration Checklist in README.md and the latest Release Notes at `https://github.com/eosglyph/agy-claude-studio` to upgrade/migrate my local Claude Studio to the latest version.**

*(Note: If you previously gave an upgrade instruction mentioning a specific older release like v2.2.1, this exact same checklist applies to upgrading to the latest version.)*

#### Optional Dual-Pane Setup
To install Claude Studio alongside the independent usage monitor companion in a single step, ask Gemini:

> **Help me install `https://github.com/eosglyph/agy-claude-studio` along with the companion plugin `https://github.com/yuhuan-dev/antigravity-usage-monitor`**

---

### Upgrade & Legacy Migration Checklist

Whether upgrading manually, running the installer, or delegating the upgrade to an AI coding assistant, follow this checklist:

1. **Preserve User Data**:
   All user preferences, webhook credentials, script definitions, and downloaded language packs reside in `~/.gemini/antigravity/plugin_data/agy-claude-studio/` (`config.json`, `notify.json`, `notify-state.json`, `scripts.json`, `i18n-packs/`) and custom operational scripts in `scripts/ops/`. These files must be preserved across updates. First-time launches automatically migrate legacy configurations from `plugin_data/agy-claude-style/config.json`.
2. **Legacy Windows Watcher Migration (`agy-claude-style-watcher.exe`)**:
   - Simply updating plugin files or extracting into a new `agy-claude-studio` directory does **not** stop or replace an older standalone `agy-claude-style-watcher.exe` running from a previous installation directory (such as `%LOCALAPPDATA%\agy-claude-style`).
   - If running the Windows 1-Click Installer (`Claude-Studio-v<version>-Windows-x64.exe`), legacy cleanup and migration are handled completely automatically.
   - If upgrading manually or via an AI coding assistant from `v2.1` / `v2.2` / `agy-claude-style`: perform a read-only check first for any running `agy-claude-style-watcher.exe` process or legacy Startup / Add-or-Remove-Programs entries. Ask the user for confirmation before stopping or uninstalling the legacy watcher. Once the legacy watcher has exited, enable the new native plugin (which cleanly unloads and stops injecting whenever toggled off in Plugins).
3. **Hot-Refresh & Verify**:
   If Antigravity is already running with `--remote-debugging-port=0`, run `npm run inject` (or `node src/inject.js`) from the plugin directory to hot-refresh active windows without restarting. **Never force-kill a running Antigravity process without explicit user confirmation.** After enabling the plugin, run `studio-setup` or `studio-doctor` to confirm everything is operational.

---

### Installation Options

#### Option 1: Windows 1-Click Native Plugin Installer (Recommended for Windows)

Download `Claude-Studio-v<version>-Windows-x64.exe` from [GitHub Releases](https://github.com/eosglyph/agy-claude-studio/releases) and double-click to run:
- Automatically detects and cleans up legacy `v2.1.0 / v2.2.0 / v2.2.1` standalone watchers and older `agy-claude-style` plugins while preserving all configuration files and custom scripts.
- Installs and enables the complete native plugin into `%USERPROFILE%\.gemini\config\plugins\agy-claude-studio`.
- Creates Desktop and Start Menu shortcuts featuring the custom **Gemini × Clawd** icon pointing directly to your local `Antigravity.exe --remote-debugging-port=0`.
- Supports clean uninstallation via Windows Settings → Installed Apps.

#### Option 2: Cross-Platform Universal Plugin ZIP & Manual Clone

Download `Claude-Studio-v<version>-plugin.zip` from [GitHub Releases](https://github.com/eosglyph/agy-claude-studio/releases):
- Extract the archive into `~/.gemini/config/plugins/` (creating `~/.gemini/config/plugins/agy-claude-studio`).
- Fully quit Antigravity (including the system tray icon) and relaunch with `--remote-debugging-port=0` (or run `npm run launch` / `node src/inject.js --launch`).
- Confirm **`Claude Studio`** is enabled under **Customizations → Plugins**.

> **Platform Note**: The maintainer does not currently have access to physical Mac hardware. macOS and Linux users are encouraged to install via the universal `plugin.zip` or by asking Gemini in Antigravity. Real-hardware feedback is warmly welcomed!

<details>
<summary><b>Manual Git Clone, Local Builds & Companion Scripts</b></summary>

- **Manual Git Clone**:
  ```powershell
  # Windows (PowerShell)
  git clone https://github.com/eosglyph/agy-claude-studio.git "$env:USERPROFILE\.gemini\config\plugins\agy-claude-studio"
  ```
  ```bash
  # macOS / Linux
  git clone https://github.com/eosglyph/agy-claude-studio.git "$HOME/.gemini/config/plugins/agy-claude-studio"
  ```

- **Build Windows Native Plugin Installer / Universal Plugin ZIP Locally**:
  ```bash
  npm run build:installer
  # Or build the universal plugin ZIP alongside
  node scripts/build-installer.mjs --plugin-zip dist/Claude-Studio-plugin.zip
  ```

- **Windows Companion Launcher Pack (with Gemini × Clawd Icon)**:
  ```powershell
  npm run build:release
  powershell -NoProfile -ExecutionPolicy Bypass -File .\companion\setup-companion.ps1
  ```
  When the native plugin is already installed, the companion launcher script automatically yields and simply launches Antigravity with `--remote-debugging-port=0` and the custom icon.

- **Build macOS Universal `.app` / `.dmg` Locally**:
  ```bash
  npm run build:macos
  ```
  Produces a universal (`arm64` + `x86_64`) `Claude Studio.app` and `Claude-Studio-v<version>-macOS-universal.dmg`. If macOS Gatekeeper flags an ad-hoc signed binary on first launch, right-click → **Open** or run `xattr -cr "/Applications/Claude Studio.app"`.

</details>

<details>
<summary><b>Option 3: Node.js CLI & Local Development</b></summary>

```bash
cp config.example.json config.json   # Optional; default configuration works out of the box
npm run inject                        # One-shot injection into active windows
npm run watch                         # Live hot-reloading watcher for local development
npm run remove                        # Disconnect and cleanly restore native UI
```

</details>

---

## Meet Clawd

<div align="center">
  <img src="assets/clawd-moods.svg" alt="Clawd Pixel Moods" width="840" />
</div>

| Interaction | How to Trigger | What Happens |
| --- | --- | --- |
| Poke | Click on the left or right side of Clawd | Shy head-turn reaction (`poke-left` / `poke-right`) |
| Tickle | 4 rapid clicks within `450ms` | Laughing leg-kick celebration (`tickle`) |
| Pick up | Click & drag across the screen | Dangling wiggle, gently floats down on release (`drag`) |
| Nap | Leave the app idle for 60s+ | Dozes off to sleep (`sleeping`), stretches awake on click or new message (`waking`) |
| Live state | Thinking / typing / error / done | Mirrors your assistant's state in real time and automatically sidesteps Q&A cards and queue bars |

---

<a id="configuration"></a>
## Configuration

All settings can be adjusted in real time from the right-side **Claude Studio** sidecar panel (under the **Settings** tab) and persist automatically across restarts (see [config.example.json](config.example.json) for the complete reference schema). Mobile push notification settings and webhook tokens are stored privately on your local machine in `PLUGIN_DATA/notify.json` and are never written to `config.json` or injected into browser pages.

<details>
<summary><b>View all configuration keys</b></summary>

| Group | Key | Values / Type | Default | Description |
| --- | --- | --- | --- | --- |
| Basic | `language` | `'zh-CN'` \| `'zh-TW'` \| `'yue'` \| `'en'` \| `'ja'` | `'zh-CN'` | UI & Studio panel language |
| Basic | `homeLayout` | `'studio'` \| `'classic'` \| `'off'` | `'studio'` | New conversation home screen layout |
| Basic | `palette` | `'claude'` \| `'obsidian'` \| `'host'` | `'claude'` | Solid color theme palette |
| UI Polish | `glassEffect` | `boolean` | `true` | Frosted glassmorphism borders, floating image viewer pills & ambient glow |
| UI Polish | `sidebarRestyle` / `sidebarCompact` | `boolean` | `true` | Claude-style sidebar density & hover polish |
| UI Polish | `composerRestyle` / `placeholderStyle` | `boolean` / `'studio'` \| `'host'` | `true` / `'studio'` | Minimalist composer & prompt placeholder copy |
| UI Polish | `logoInk` | `'accent'` \| `'foreground'` | `'accent'` | Home & top-left app logo tint mode |
| UI Polish | `geminiLoader` | `boolean` | `true` | Swap default large loading spinner for Gemini-chan animation & 12-tick ring |
| Interaction | `periodicSelector` / `orchestratorSwitch` | `boolean` | `true` | Gemini 4 Periodic Table selector & Orchestrator quick switch |
| Interaction | `effortSliderStyle` / `effortAccent` | `'chatgpt'` \| `'claude'` \| `'off'` / `boolean` | `'chatgpt'` / `true` | 60fps effort slider style (`'off'` keeps native) & color scale |
| Interaction | `compactPreset` / `compactCustomText` | `'empty'` \| `'clean'` \| `'dev'` \| `'custom'` / `string` | `'clean'` / `''` | `/compact` preset & custom prompt text |
| Interaction | `fileLinkContextMenu` | `boolean` | `true` | Right-click chat file links & mentions to Open File, Reveal in Folder, or Copy Full Path |
| Interaction | `smoothCaret` / `mascot` / `homeRipple` | `boolean` / `'crab'` \| `'off'` / `boolean` | `true` / `'crab'` / `true` | Smooth caret, Clawd mascot & home ripple field |
| Localization | `pluginPageTranslate` / `i18nIgnoreSelectors` | `boolean` / `string[]` | `true` / `[]` | Marketplace on-demand Google Translate pill & custom protected CSS selectors |
| Usage & Pane | `pinRightPane` | `'off'` \| `'studio'` \| `'usage-monitor'` | `'studio'` | Auto-open right Aux Pane per conversation (migrates legacy `pinUsageMonitorPane`) |
| Usage & Pane | `usageStatsEnabled` | `boolean` | `true` | Master toggle for built-in HUD (preserves child preferences when turned off) |
| Usage & Pane | `inlineStats` / `ringMode` / `turnBadges` | `boolean` / `'context'` \| `'quota'` / `boolean` | `true` / `'context'` / `true` | *(Requires `usageStatsEnabled`)* Inline stats, context/quota ring & turn `#T` badges |
| Usage & Pane | `hudTopBar` / `hudBottomBar` / `hudRimProgress` | `boolean` | `true` / `false` / `false` | *(Requires `usageStatsEnabled`)* Top HUD bar, bottom bar & rim progress bar |
| Runtime | `autoRelaunchWithCdp` / `exitOnHostClose` / `pollIntervalMs` | `boolean` / `boolean` / `number` | `true` / `false` / `2500` | CDP relaunch behavior, host-exit lifecycle & polling interval |

</details>

---

<a id="faq"></a>
## FAQ

<details>
<summary><b>1. Not injecting automatically after updating to Antigravity 2.33.0+?</b></summary>

Starting in `2.33.0`, Antigravity disables the CDP remote debugging port by default. Fully quit Antigravity (including the background system tray icon) and relaunch it with `--remote-debugging-port=0`, or use the one-click relaunch button in the Studio panel / `npm run launch` (`node src/inject.js --launch`). You can also ask Gemini *"Diagnose Claude Studio"* to trigger the `studio-doctor` skill for automated troubleshooting.

</details>

<details>
<summary><b>2. Why is the "Usage Monitor" option unavailable under Right Pane Pinning?</b></summary>

That option is designed to pair with the independent companion plugin [yuhuan-dev/antigravity-usage-monitor](https://github.com/yuhuan-dev/antigravity-usage-monitor). Once that plugin is installed, refresh status in the Studio panel to activate the option. If you prefer not to install third-party plugins, keep `pinRightPane` set to **Studio Chat Pane** to enjoy the built-in lightweight HUD out of the box.

</details>

<details>
<summary><b>3. Why are sidebar right-click context menus still in English?</b></summary>

Sidebar item context menus are rendered directly by Electron via operating system APIs (Win32 / NSMenu) outside the browser DOM. Non-destructive CDP injection operates purely within the web environment and cannot modify OS-level menus. All application DOM views, settings pages, dialogs, and the Swarm sidecar support full 5-language localization.

</details>

<details>
<summary><b>4. How do I completely restore the native Antigravity UI?</b></summary>

Click **Restore Native** in the **Claude Studio** panel, toggle `Claude Studio` off in Antigravity Plugins, or run `npm run remove`. No host files are ever modified, and the stock UI is restored immediately.

</details>

---

## Development & Testing

```bash
npm test                 # Run automated test suite (Node.js >= 22, zero dependencies)
npm run build:installer  # Build Windows single-file x64 installer
npm run build:release    # Build Windows companion launcher release pack
npm run build:macos      # Build macOS Universal .app & .dmg (requires macOS environment)
```

<details>
<summary><b>Project Structure</b></summary>

```text
agy-claude-studio/
├── plugin.json / mcp_config.json / hooks.json  # Native plugin manifest, MCP host & Stop hook
├── plugin/mcp-host.js                          # Native lifecycle host (PID reuse check & hot takeover)
├── sidecars/studio/                            # 3-Tab right Aux Pane (Chat | Tools | Settings)
├── skills/                                     # 4 native skills (setup, doctor, notify, translation-protect)
├── src/                                        # Core runtime, CDP lifecycle, UI modules & localization engine
│   ├── cdp.js / lifecycle.js                   # CDP client, config migration, process guard & host watchdog
│   ├── watcher-core.js / inject.js / remove.js # Multi-window hot-reload controller & CLI inject/remove entries
│   ├── style.css / ui-runtime.js               # Core theme styles & UI runtime (home, periodic table, slider, /compact)
│   ├── sidecar-core.js                         # Lightweight reversible translation runtime for Swarm sidecar (/swarm)
│   ├── periodic-core.js / periodic-sync.js     # Gemini 4 Periodic Table catalog & direct AI Studio sync
│   ├── effort-core.js                          # Dual-style 60fps reasoning effort slider math model
│   ├── notify-core.js / scripts-core.js        # 8-channel mobile push engine & local scripts toolbox
│   ├── i18n-core.js / i18n-locales.js / i18n-sync.js # 5-language localization engine, locale pack loader & sync pipeline
│   ├── usage-core.js                           # Built-in trajectory parser, token breakdown & heatmap engine
│   ├── mascot-core.js / crab-assets.js         # Clawd state machine & 19 dual-layer pixel sprite sets
│   └── ripple-core.js                          # Home ASCII noise field & 2D wave solver
├── locales/                                    # Bundled and on-demand language pack dictionaries
├── i18n-compat.json                            # Built-in translation protection rules for companion plugins
├── installer/ & companion/                     # Windows (C#) / macOS (Swift) installers & companion scripts
├── scripts/                                    # Stop hook, changelog fetcher, Windows helper & build pipelines
│   ├── notify-stop.mjs / fetch-agy-changelog.mjs # Stop hook runner & Antigravity changelog fetcher
│   ├── WindowsFileAction.cs                    # Native Windows file action helper (flicker-free Explorer selection & open)
│   └── build-*.mjs                             # Installer, macOS, locale-pack & release build scripts
├── test/                                       # node:test automated test suite
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
