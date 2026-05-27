// afterSign hook — runs after electron-builder signs the app.
// Notarization activates automatically when APPLE_CERT_P12_BASE64 is present
// (set by board action in MYT-642). Unsigned dev/CI builds skip silently.
const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // Gate on the signing cert secret — if absent, signing was skipped upstream
  // and notarization cannot succeed. Log clearly and exit.
  if (!process.env.APPLE_CERT_P12_BASE64) {
    console.log('Skipping notarization — APPLE_CERT_P12_BASE64 is not set. ' +
      'Add Apple Developer ID secrets (MYT-642) to enable signing + notarization.');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleAppPassword = process.env.APPLE_APP_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  // API-key path (preferred when APPLE_API_KEY_PATH is set)
  const apiKeyPath = process.env.APPLE_API_KEY_PATH;
  const apiKeyId = process.env.APPLE_API_KEY_ID;
  const apiIssuerId = process.env.APPLE_API_ISSUER_ID;

  const appBundleId = context.packager.appInfo.id;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appBundleId} at ${appPath} …`);

  if (apiKeyPath && apiKeyId && apiIssuerId) {
    // API-key auth (no app-specific password needed)
    await notarize({
      tool: 'notarytool',
      appBundleId,
      appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuerId,
    });
  } else {
    // App-specific password auth
    await notarize({
      tool: 'notarytool',
      appBundleId,
      appPath,
      appleId,
      appleIdPassword: appleAppPassword,
      teamId,
    });
  }

  console.log('Notarization complete.');
};
