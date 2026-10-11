// Writes `minimumSystemVersion` into release/latest-mac.yml after a mac build.
//
// Why: Electron 44 dropped macOS 12, and electron-builder.yml sets
// LSMinimumSystemVersion 13.0 so the app refuses to launch on older macOS.
// But electron-builder 25 does not copy that into the update feed, so an
// installed copy on macOS 12 would auto-update to a build that cannot start.
// electron-updater skips any update whose `minimumSystemVersion` is above the
// running OS (AppUpdater.checkIfUpdateSupported, present since 6.x).
//
// The trap: electron-updater compares against `os.release()`, which on macOS
// is the DARWIN kernel version, not the marketing version. macOS 13 Ventura is
// Darwin 22, so the feed must say 22.0.0. Writing "13.0.0" would block nobody:
// macOS 12 is Darwin 21, which is already above 13, so the guard would pass
// every Mac and the mistake would be silent.
//
// Runs as the last step of `npm run electron:build:mac`; must run before the
// release assets are uploaded.
'use strict';

const fs = require('fs');
const path = require('path');

// Keep in step with electron-builder.yml → mac.minimumSystemVersion.
// macOS 12 = Darwin 21, 13 = 22, 14 = 23, 15 = 24, 26 = 25.
const MACOS_MINIMUM = '13.0';
const DARWIN_MINIMUM = '22.0.0';

const feed = path.join(__dirname, '..', 'release', 'latest-mac.yml');
const builderConfig = path.join(__dirname, '..', 'electron-builder.yml');

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const config = fs.readFileSync(builderConfig, 'utf8');
const configured = config.match(/^\s+minimumSystemVersion:\s*["']?([\d.]+)["']?\s*$/m);
if (!configured || configured[1] !== MACOS_MINIMUM) {
  fail(
    `electron-builder.yml mac.minimumSystemVersion is ${configured ? configured[1] : 'missing'}, ` +
    `but this script maps ${MACOS_MINIMUM} → Darwin ${DARWIN_MINIMUM}. Update both together.`
  );
}

if (!fs.existsSync(feed)) fail(`No ${path.relative(process.cwd(), feed)} — did the mac build run?`);

const original = fs.readFileSync(feed, 'utf8');
const line = `minimumSystemVersion: ${DARWIN_MINIMUM}`;
const updated = /^minimumSystemVersion:.*$/m.test(original)
  ? original.replace(/^minimumSystemVersion:.*$/m, line)
  : original.replace(/\n*$/, `\n${line}\n`);

fs.writeFileSync(feed, updated);
console.log(`✓ latest-mac.yml: ${line} (macOS ${MACOS_MINIMUM}+)`);
