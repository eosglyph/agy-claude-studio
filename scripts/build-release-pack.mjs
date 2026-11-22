#!/usr/bin/env node
// Build standalone Windows installer.exe + shareable Gemini companion release pack under releases/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR, cdp, buildZip } from './build-common.mjs';
import { buildInstaller } from './build-installer.mjs';

const __filename = fileURLToPath(import.meta.url);

function buildReleasePack() {
  const version = cdp.PLUGIN_VERSION;
  const packName = `agy-claude-studio-pack-v${version}`;
  const releasesDir = path.join(ROOT_DIR, 'releases');
  const packDir = path.join(releasesDir, packName);
  const zipPath = path.join(releasesDir, `${packName}.zip`);
  const installerPath = path.join(ROOT_DIR, 'installer.exe');
  const companionDir = path.join(ROOT_DIR, 'companion');

  const installerInfo = buildInstaller({ outputPath: installerPath });
  console.log(
    `[✓] Built ${installerInfo.outputPath} (${(installerInfo.sizeBytes / 1024).toFixed(1)} KB; ` +
      `payload ${(installerInfo.payloadZipBytes / 1024).toFixed(1)} KB, ${installerInfo.fileCount} files)`
  );

  fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });

  const assets = [
    { name: 'installer.exe', src: installerPath },
    { name: 'agy-gemini-clawd.ico', src: path.join(companionDir, 'agy-gemini-clawd.ico') },
    { name: 'agy-gemini-clawd.png', src: path.join(companionDir, 'agy-gemini-clawd.png') },
    { name: 'setup-companion.ps1', src: path.join(companionDir, 'setup-companion.ps1') },
    { name: 'README-分享说明.md', src: path.join(companionDir, 'README-分享说明.md') },
  ];

  const zipEntries = [];
  for (const item of assets) {
    if (!fs.existsSync(item.src)) {
      throw new Error(`Missing release asset: ${item.src}`);
    }
    const data = fs.readFileSync(item.src);
    fs.writeFileSync(path.join(packDir, item.name), data);
    zipEntries.push({ name: item.name, data });
  }

  fs.writeFileSync(zipPath, buildZip(zipEntries));
  const zipStat = fs.statSync(zipPath);
  console.log(`[✓] Packaged ${packDir} (${assets.length} files)`);
  console.log(`[✓] Packaged ${zipPath} (${(zipStat.size / 1024).toFixed(1)} KB)`);

  return { version, packDir, zipPath, installerPath, fileCount: assets.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  buildReleasePack();
}

export { buildReleasePack };
