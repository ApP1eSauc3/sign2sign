// Dynamic Expo config. Expo loads this in preference to app.json and passes
// app.json's already-resolved contents in as `config`, so app.json stays the
// single source of truth and is never edited.
//
// Sole job: let an EAS build profile swap the iOS bundle identifier via an env
// var. The `preview` profile sets PREVIEW_IOS_BUNDLE_ID so internal test builds
// run under a THROWAWAY id (com.sign2sign.app.dev) on the developer's personal
// Apple team. That keeps the real production id (com.sign2sign.app) unclaimed
// until the client's Apple Developer account exists — bundle ids are globally
// unique, so claiming it now would block the client from registering it.
//
// No env var set (local dev, production builds) => app.json is returned as-is.
module.exports = ({ config }) => {
  const previewBundleId = process.env.PREVIEW_IOS_BUNDLE_ID;
  if (previewBundleId) {
    config.ios = { ...config.ios, bundleIdentifier: previewBundleId };
  }
  return config;
};
