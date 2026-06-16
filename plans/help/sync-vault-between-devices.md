# Sync your vault between devices

Mythos Writer stores your vaults as plain markdown files on your computer. Because they are ordinary files, you can sync them between devices using the cloud storage tool you already have — no Mythos account or special configuration needed.

## How it works

Place your Mythos vault folder inside the synced folder for your cloud provider. The OS desktop client (Dropbox, iCloud Drive, Google Drive, or OneDrive) watches for changes and copies them to your other machines automatically. When you open Mythos Writer on another device and point it at the same vault path, everything is there.

---

## Setup by provider

### Dropbox

1. Locate your Dropbox folder (usually `C:\Users\<you>\Dropbox` on Windows, `~/Dropbox` on macOS).
2. Move your Mythos vault into that folder — for example, `~/Dropbox/Mythos/Story Vault/` and `~/Dropbox/Mythos/Notes Vault/`.
3. In Mythos Writer → **Settings → Vault paths**, update the Story Vault and Notes Vault paths to point to the new locations.
4. Wait for the Dropbox desktop app to finish uploading (the icon in your taskbar turns to a green check mark).
5. On your second device, install Dropbox and wait for the vault folder to sync down. Open Mythos Writer and set the same vault paths.

### iCloud Drive

1. Locate your iCloud Drive folder (usually `~/Library/Mobile Documents/com~apple~CloudDocs/` on macOS, or `C:\Users\<you>\iCloudDrive` on Windows with iCloud for Windows installed).
2. Move your vault into a subfolder — for example, `iCloud Drive/Mythos/Story Vault/`.
3. Update **Settings → Vault paths** in Mythos Writer to the new location.
4. Let iCloud finish uploading (status bar shows no pending items).
5. On your second Mac, the folder appears automatically in iCloud Drive. Set the vault paths in Mythos Writer on that machine.

### Google Drive

1. Install the **Google Drive desktop app** (not just the browser) and sign in. It creates a `Google Drive` folder on your machine.
2. Move your vault into that folder — for example, `Google Drive/My Drive/Mythos/Story Vault/`.
3. Update **Settings → Vault paths** in Mythos Writer.
4. Wait for the Google Drive icon in your taskbar to show sync complete.
5. On your second device, install Google Drive desktop, sign in with the same account, and wait for the vault to sync down. Set the vault paths in Mythos Writer.

### OneDrive

1. Locate your OneDrive folder (usually `C:\Users\<you>\OneDrive` on Windows).
2. Move your vault inside it — for example, `OneDrive\Mythos\Story Vault\`.
3. Update **Settings → Vault paths** in Mythos Writer.
4. Wait for the OneDrive sync icon in the taskbar to show all files as uploaded (solid cloud with a check mark).
5. On your second Windows PC, sign into OneDrive and wait for the vault folder to sync down. Open Mythos Writer and set the vault paths.

---

## One important caveat

**Do not open Mythos Writer while your cloud client is actively resolving a sync conflict on the vault.**

If two machines edited the same file while offline and your cloud client needs to merge them, close Mythos Writer first. Let the cloud client finish creating its conflict copies (they usually appear as files with "conflicted copy" or "(1)" in the name). Then pick which version you want, rename it back to the original filename, and delete the other. After that, open Mythos Writer normally.

Opening Mythos while a conflict file is present is harmless but can confuse the vault manifest. If that happens, Mythos will rebuild the manifest automatically on the next launch.

---

## Looking ahead

In a future paid tier (**Mythos Cloud — Monetization Phase 3**), Mythos Writer will offer built-in sync that handles conflicts automatically and supports the Mythos mobile companion app on devices where folder-level OS sync is not available. Until then, the cloud-folder approach above is reliable, free, and requires no Mythos account.
