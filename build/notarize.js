// afterSign hook — runs after electron-builder signs the app.
// Notarization is gated on APPLE_NOTARIZE=1 so unsigned dev/CI builds succeed
// without credentials. Set that env var (and APPLE_ID / APPLE_ID_PASSWORD /
// APPLE_TEAM_ID) in GitHub repo secrets when the Apple Developer ID is ready.
const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;

  if (process.env.APPLE_NOTARIZE !== '1') {
    console.log('Skipping notarization — APPLE_NOTARIZE is not set to 1.');
    return;
  }

  const appBundleId = context.packager.appInfo.id;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appBundleId} at ${appPath} …`);

  await notarize({
    appBundleId,
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete.');
};
