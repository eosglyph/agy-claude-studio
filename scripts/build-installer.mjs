#!/usr/bin/env node
// Build 1-click Windows Native Plugin Installer (.exe) and cross-platform Plugin ZIP for Claude Studio.
// Zero external npm dependencies: uses built-in Node zlib + Windows .NET Framework csc.exe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ROOT_DIR,
  cdp,
  VALIDATORS,
  normalizeVersion,
  getArtifactNames,
  createManifest,
  buildMultiResIco,
  buildZip,
} from './build-common.mjs';

const __filename = fileURLToPath(import.meta.url);

const PLUGIN_ROOT_FILES = [
  'plugin.json',
  'package.json',
  'mcp_config.json',
  'hooks.json',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'config.example.json',
  'i18n-compat.json',
  'style.css',
  'cdp.js',
  'inject.js',
  'remove.js',
  'lifecycle.js',
  'watcher-core.js',
  'notify-core.js',
  'scripts-core.js',
  'periodic-sync.js',
  'i18n-sync.js',
  'launch.bat',
  'launch.sh',
  'inject.bat',
  'inject.sh',
  'remove.bat',
  'remove.sh',
  'watch.bat',
  'watch.sh',
  'watch-hidden.vbs',
  'autostart-on.bat',
  'autostart-off.bat',
];

const PLUGIN_RUNTIME_SUBDIRS = [
  'plugin',
  'sidecars/studio',
  'skills',
];

// Built-in offline baseline packs only (zh-CN + zh-TW + manifest).
// Additional languages (yue, ja, etc.) are downloaded on demand from GitHub in Studio Settings.
const PLUGIN_BUNDLED_LOCALE_FILES = [
  'locales/manifest.json',
  'locales/zh-CN.json',
  'locales/zh-TW.json',
];

const PLUGIN_RUNTIME_SCRIPTS = [
  'scripts/WindowsFileAction.cs',
  'scripts/fetch-agy-changelog.mjs',
  'scripts/notify-stop.mjs',
  'scripts/ops/check-agy-update.mjs',
  'scripts/ops/check-repo-metrics.mjs',
  'scripts/ops/sync-periodic-elements.mjs',
];

const PLUGIN_ASSET_FILES = [
  'assets/clawd-banner.svg',
  'assets/clawd-moods.svg',
  'assets/logo.svg',
];

function findCsc() {
  const winDir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(winDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('csc.exe (.NET Framework 4.x) not found');
}

function resolveGeminiIconBuffer() {
  const companionIco = path.join(ROOT_DIR, 'companion', 'agy-gemini-clawd.ico');
  if (fs.existsSync(companionIco)) {
    const buf = fs.readFileSync(companionIco);
    if (buf.length > 64) {
      return { buffer: buf, source: companionIco };
    }
  }
  return { buffer: buildMultiResIco(), source: 'generated-crab-ico' };
}

function collectFilesRecursive(relDir, entries, seen) {
  const absDir = path.join(ROOT_DIR, relDir);
  if (!fs.existsSync(absDir)) return;
  for (const item of fs.readdirSync(absDir, { withFileTypes: true })) {
    const childRel = `${relDir}/${item.name}`.replace(/\\/g, '/');
    if (item.isDirectory()) {
      collectFilesRecursive(childRel, entries, seen);
    } else if (item.isFile()) {
      if (seen.has(childRel)) continue;
      seen.add(childRel);
      entries.push({
        name: childRel,
        data: fs.readFileSync(path.join(ROOT_DIR, childRel)),
      });
    }
  }
}

function collectPluginPayloadFiles(version = cdp.PLUGIN_VERSION) {
  const cleanVersion = normalizeVersion(version);
  const manifest = createManifest(cleanVersion);
  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  const entries = [];
  const seen = new Set();

  const addFile = (relPath, optional = false) => {
    const normalized = relPath.replace(/\\/g, '/');
    if (seen.has(normalized)) return;
    const absPath = path.join(ROOT_DIR, normalized);
    if (!fs.existsSync(absPath)) {
      if (optional) return;
      throw new Error(`Missing required plugin file: ${normalized}`);
    }
    seen.add(normalized);
    entries.push({ name: normalized, data: fs.readFileSync(absPath) });
  };

  for (const f of PLUGIN_ROOT_FILES) {
    addFile(f, f.endsWith('.bat') || f.endsWith('.sh') || f.endsWith('.vbs'));
  }
  for (const part of cdp.RUNTIME_PARTS) {
    addFile(part);
  }
  for (const relDir of PLUGIN_RUNTIME_SUBDIRS) {
    collectFilesRecursive(relDir, entries, seen);
  }
  for (const localeFile of PLUGIN_BUNDLED_LOCALE_FILES) {
    addFile(localeFile, false);
  }
  for (const scriptFile of PLUGIN_RUNTIME_SCRIPTS) {
    addFile(scriptFile, scriptFile.startsWith('scripts/ops/'));
  }
  for (const assetFile of PLUGIN_ASSET_FILES) {
    addFile(assetFile, true);
  }

  // Bundle Gemini x Clawd shortcut icon inside assets/ for Windows .lnk shortcuts.
  const icon = resolveGeminiIconBuffer();
  if (!seen.has('assets/agy-gemini-clawd.ico')) {
    seen.add('assets/agy-gemini-clawd.ico');
    entries.push({ name: 'assets/agy-gemini-clawd.ico', data: icon.buffer });
  }

  if (!seen.has('manifest.json')) {
    seen.add('manifest.json');
    entries.push({ name: 'manifest.json', data: Buffer.from(manifestJson, 'utf8') });
  }

  return { entries, icon, version: cleanVersion };
}

function buildPluginZip({ outputPath, version = cdp.PLUGIN_VERSION, prefix = 'agy-claude-studio/' } = {}) {
  const cleanVersion = normalizeVersion(version);
  const resolvedOut = outputPath || path.join(ROOT_DIR, getArtifactNames(cleanVersion).pluginZip);
  const { entries } = collectPluginPayloadFiles(cleanVersion);
  const normalizedPrefix = prefix ? prefix.replace(/\\/g, '/').replace(/\/?$/, '/') : '';
  const zipEntries = entries.map((e) => ({
    name: `${normalizedPrefix}${e.name}`,
    data: e.data,
  }));
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  const zipBuf = buildZip(zipEntries);
  fs.writeFileSync(resolvedOut, zipBuf);
  return {
    outputPath: resolvedOut,
    sizeBytes: zipBuf.length,
    fileCount: zipEntries.length,
    version: cleanVersion,
  };
}

function buildInstaller({ outputPath, version = cdp.PLUGIN_VERSION } = {}) {
  const cleanVersion = normalizeVersion(version);
  const resolvedOut = outputPath || path.join(ROOT_DIR, getArtifactNames(cleanVersion).windowsInstaller);
  const csc = findCsc();
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cs-build-'));

  try {
    const { entries: payloadFiles, icon } = collectPluginPayloadFiles(cleanVersion);
    const icoPath = path.join(stageDir, 'app.ico');
    fs.writeFileSync(icoPath, icon.buffer);

    const payloadZip = path.join(stageDir, 'payload.zip');
    fs.writeFileSync(payloadZip, buildZip(payloadFiles));

    const commonMiniJson = path.join(ROOT_DIR, 'installer', 'common', 'MiniJson.cs');
    const commonCdpClient = path.join(ROOT_DIR, 'installer', 'common', 'CdpClient.cs');
    const setupManifest = path.join(ROOT_DIR, 'installer', 'setup', 'app.manifest');
    const setupMain = path.join(ROOT_DIR, 'installer', 'setup', 'Program.cs');
    const tempOut = path.join(stageDir, 'installer.exe');

    execFileSync(csc, [
      '/nologo',
      '/utf8output',
      '/codepage:65001',
      '/target:winexe',
      '/optimize+',
      `/win32icon:${icoPath}`,
      `/win32manifest:${setupManifest}`,
      `/resource:${payloadZip},AGY_PAYLOAD.zip`,
      `/out:${tempOut}`,
      '/r:System.dll',
      '/r:System.Core.dll',
      '/r:System.Drawing.dll',
      '/r:System.IO.Compression.dll',
      '/r:System.IO.Compression.FileSystem.dll',
      '/r:System.Management.dll',
      '/r:System.Net.Http.dll',
      '/r:System.Windows.Forms.dll',
      commonMiniJson,
      commonCdpClient,
      setupMain,
    ], { stdio: 'inherit' });

    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.copyFileSync(tempOut, resolvedOut);
    const stat = fs.statSync(resolvedOut);
    return {
      outputPath: resolvedOut,
      sizeBytes: stat.size,
      payloadZipBytes: fs.statSync(payloadZip).size,
      fileCount: payloadFiles.length,
      iconSource: icon.source,
    };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  let outputPath;
  let pluginZipOut;
  let pluginZipOnly = false;
  let version = cdp.PLUGIN_VERSION;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--out' || args[i] === '-o') && i + 1 < args.length) {
      outputPath = path.resolve(args[++i]);
    } else if (args[i] === '--plugin-zip' && i + 1 < args.length) {
      pluginZipOut = path.resolve(args[++i]);
    } else if (args[i] === '--plugin-zip-only') {
      pluginZipOnly = true;
    } else if (args[i] === '--version' && i + 1 < args.length) {
      version = args[++i];
    }
  }
  if (pluginZipOnly || pluginZipOut) {
    const zipRes = buildPluginZip({ outputPath: pluginZipOut, version });
    console.log(
      `[✓] Packaged ${zipRes.outputPath} (${(zipRes.sizeBytes / 1024).toFixed(1)} KB, ${zipRes.fileCount} files)`
    );
  }
  if (!pluginZipOnly) {
    const res = buildInstaller({ outputPath, version });
    console.log(
      `[✓] Built ${res.outputPath} (${(res.sizeBytes / 1024).toFixed(1)} KB; ` +
      `payload ${(res.payloadZipBytes / 1024).toFixed(1)} KB, ${res.fileCount} files)`
    );
  }
}

export {
  VALIDATORS,
  getArtifactNames,
  collectPluginPayloadFiles,
  buildPluginZip,
  buildInstaller,
  buildZip,
  buildMultiResIco,
};
