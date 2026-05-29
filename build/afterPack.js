// Flips Electron Fuses to permanently disable powerful features we don't use.
// Runs at package time, BEFORE code-signing, so electron-builder re-signs the
// modified binary afterward. See Electron security checklist #19.
//
// Only the four fuses below are safe while the app still loads from file://.
// Do NOT add GrantFileProtocolExtraPrivileges / OnlyLoadAppFromAsar / asar
// integrity here — those depend on migrating off file:// first (out of scope).
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const ext = { darwin: '.app', win32: '.exe', linux: '' }[electronPlatformName];
  const binary = path.join(appOutDir, `${packager.appInfo.productFilename}${ext}`);

  await flipFuses(binary, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
  });
};
