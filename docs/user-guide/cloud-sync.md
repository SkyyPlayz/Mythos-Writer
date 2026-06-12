# Cloud Sync — User Guide

Mythos Writer can place your Story Vault inside a folder managed by Dropbox,
iCloud Drive, OneDrive, or Google Drive. Once the vault is there, your cloud
provider syncs it to every machine where you write — automatically, in the
background, using the same client you already use for everything else.

---

## Contents

1. [What Cloud Sync does — and doesn't](#what-cloud-sync-does--and-doesnt)
2. [Picking a provider](#picking-a-provider)
3. [Move Vault wizard](#move-vault-wizard)
4. [Conflict handling](#conflict-handling)
5. [Troubleshooting](#troubleshooting)
6. [FAQ](#faq)

---

## What Cloud Sync does — and doesn't

**Does:**

- Moves your Story Vault folder into a local directory that your cloud provider
  already manages (for example `~/Dropbox/My Vault`).
- Verifies the target folder is writable before touching any of your files.
- Detects conflict files left by your cloud provider (the `filename (conflicted copy …)` pattern) and resolves them using a **last-modified-wins** rule, archiving the older copy under `.mythos/.archive/` so you can recover it if needed.
- Shows a warning if another Mythos Writer session on a different machine has the vault open at the same time, reducing the chance of two-machine edit collisions.

**Does not:**

- Replace your cloud client — Dropbox, iCloud Drive, OneDrive, or Google Drive for Desktop must already be installed, signed in, and syncing on your machine before you run the wizard.
- Perform real-time collaboration or locking between two machines. If you and your writing partner (or you and your laptop) edit the same scene at the same time, the provider produces a conflict file that Mythos resolves automatically — review the archive if you think content was lost.
- Sync Notes Vault files, app settings, or backups — only the Story Vault moves.
- Work with provider websites or browser-only cloud drives. A local sync folder (visible in Finder or File Explorer) is required.

---

## Picking a provider

Install and sign in to your provider's desktop client **before** opening the wizard. Each provider creates a local folder on your machine that looks like any other folder; the wizard places your vault inside it.

| Provider | Client name | Default local folder | Platforms |
|----------|-------------|---------------------|-----------|
| **Dropbox** | Dropbox | `~/Dropbox` | macOS, Windows, Linux |
| **iCloud Drive** | Built in (macOS) | `~/Library/Mobile Documents/com~apple~CloudDocs` | macOS only |
| **OneDrive** | Microsoft OneDrive | `~/OneDrive` | macOS, Windows |
| **Google Drive** | Google Drive for Desktop | `~/Google Drive` | macOS, Windows |

### Installation pointers

**Dropbox** — Download the Dropbox desktop app and sign in. Once the status bar icon shows a green tick, the local folder is ready.

**iCloud Drive** — On macOS, open **System Settings → Apple ID → iCloud** and enable iCloud Drive. Let it finish its initial sync before placing a vault inside it.

**OneDrive** — Install the OneDrive app (already present on Windows; available on the Microsoft website for macOS). Sign in and wait for the first sync to complete.

**Google Drive** — Install **Google Drive for Desktop** (not the browser app). After sign-in, the local folder appears in Finder/File Explorer under your home directory.

> **Linux note:** Dropbox is the only officially supported client with a native Linux app. For OneDrive or Google Drive on Linux, a compatible third-party sync client such as Syncthing can work with no official support.

---

## Move Vault wizard

Open **Settings → Vault paths → Cloud sync**, then click **Move vault to cloud sync…**.

The wizard has five steps.

### Step 1 — Choose a provider

![Choose provider](../assets/cloud-sync/step-1-provider.svg)

Select the cloud service your files will live in. Mythos uses this choice only to
populate path hints in the next step — it does not communicate with the provider
directly.

### Step 2 — Locate the folder

![Locate folder](../assets/cloud-sync/step-2-folder.svg)

Click **Browse…** and select the folder inside your provider's local sync
directory. The path hint below the label shows the most common location for your
chosen provider; you can navigate to any subfolder within the synced tree.

> **Tip:** Create a dedicated subfolder first (e.g. `Dropbox/Mythos Story Vault`) so
> your vault files don't mix with other Dropbox content.

### Step 3 — Confirm the move

![Confirm move](../assets/cloud-sync/step-3-confirm.svg)

Review the **From** and **To** paths. When you are satisfied:

1. Confirm that your sync client is running and the target folder shows as
   synced — not a placeholder or offline-only file.
2. Check the confirmation box.
3. Click **Proceed**.

Mythos Writer will not start syncing. Your cloud provider handles that entirely.

### Step 4 — Verify access

![Verify access](../assets/cloud-sync/step-4-verify.svg)

Mythos runs a write test on the target folder. If it passes, click **Move vault**
to begin the migration. If the test fails, see [Folder unwritable](#folder-unwritable) below.

The migration copies your vault files to the new location, updates the vault
path in Settings, and removes the original folder. Do not quit the app or move
files manually while this step is in progress.

### Step 5 — Done

![Done](../assets/cloud-sync/step-5-done.svg)

The success screen shows your new vault path and confirms the provider. Click
**Done**. The Story Vault path in Settings now points to the synced folder.

---

## Conflict handling

### Pre-existing conflict files

When Dropbox, iCloud, or Syncthing cannot merge two versions of the same file,
they create a copy with a name like:

```
scene-abc (John's conflicted copy 2026-05-14).md
```

The next time Mythos Writer opens the vault, it scans for files matching this
pattern. For each conflict pair it finds:

1. Compares the last-modified timestamp of the original and the conflict copy.
2. Keeps the **more recently modified** file at the original path.
3. Moves the older file to `.mythos/.archive/<timestamp>-<filename>` so you can
   recover it if needed.

Mythos reports how many conflicts it resolved in the notification area. If you
believe the wrong version was kept, open `.mythos/.archive/` in Finder or File
Explorer to retrieve the archived copy.

### Cross-host lockfile warning

Mythos Writer places a `vault.lock` file inside the vault folder while the app
is running. If you open the same vault on a second machine before closing it on
the first, Mythos detects the existing lockfile and shows a warning:

> **Another session may be open** — Mythos Writer detected a session started by
> *hostname* on *date*. If that session is still active, edits on both machines
> will conflict. Proceed only if the other session is closed.

You can dismiss this warning if you are certain the other session has been
closed (for example, if the machine crashed without cleanly exiting). Dismissal
is **per-vault** — dismissing the warning for one vault does not suppress it for
other vaults you have open.

If you frequently see this warning even when no other session is open, see
[vault.lock is orphaned](#vaultlock-is-orphaned) below.

---

## Troubleshooting

### Provider not detected

The wizard does not directly connect to your provider's servers; it detects the
local sync folder by the path you choose.

1. Make sure the desktop client is installed, signed in, and showing a
   **synced** status (not paused, not offline, not "sign-in required").
2. Open Finder or File Explorer and confirm the provider's local folder exists
   at the expected path (e.g. `~/Dropbox`). If it's missing, let the client
   finish setup before retrying.
3. Re-open the wizard and browse to the correct local folder.

### Folder unwritable

The permission check in Step 4 failed, which means Mythos cannot save files in
the chosen folder.

1. In Finder or File Explorer, right-click the target folder → **Get Info**
   (macOS) or **Properties** (Windows) and confirm your user account has write
   permission.
2. **macOS only:** Go to **System Settings → Privacy & Security → Files and
   Folders** and verify Mythos Writer is allowed to access your cloud provider's
   folder. If the entry is absent, grant Full Disk Access as a fallback.
3. If the folder is flagged as "cloud-only" or "online-only" by iCloud or
   OneDrive, download it locally first (right-click → **Always Keep on This
   Device** on Windows, **Download Now** on macOS).
4. After fixing permissions, click **Retry** in the wizard.

### vault.lock is orphaned

If Mythos Writer crashes or is force-quit, it may not clean up `vault.lock`
inside the vault folder. The next time you open that vault, Mythos sees the
stale lockfile and shows the cross-host warning even though no other session is
active.

1. Confirm no other Mythos Writer instance has the vault open (check all your
   devices).
2. In the warning dialog, click **Dismiss** — this clears the warning for this
   vault only and lets you continue.
3. If the warning reappears on every launch, manually delete `vault.lock` from
   inside the vault folder using Finder or File Explorer. Mythos recreates it
   automatically on next open.

---

## FAQ

**Does Cloud Sync work with Syncthing or other self-hosted tools?**

Syncthing and similar tools that use a local sync folder on disk work in the
same way as the big-four providers: place your vault inside the synced folder
and Mythos Writer uses it normally. Syncthing is not listed in the wizard's
provider picker, but you can browse to any local folder at Step 2. Conflict
files that Syncthing creates (`.sync-conflict-…`) are not automatically resolved
in v1 — rename or delete them manually.

**Will Notes Vault sync too?**

The wizard moves only your Story Vault. If you also want to sync Notes Vault,
move it manually using **Settings → Vault paths → Notes Vault → Change path…**
and point it at a folder inside your provider's local sync directory.

**Can two people write to the same vault at the same time?**

No. Mythos Writer is a single-author tool. If two users open the same vault
simultaneously, the cloud provider will create conflict copies when it tries to
merge their changes. The last-modified-wins resolver keeps the most recent
version and archives the other, but concurrent editing is not a supported
workflow.

**What happens if the sync client is offline during a writing session?**

Mythos Writer reads and writes files locally — it does not need the sync client
to be connected. Your changes are saved to disk as you write. When the client
comes back online, it syncs those files to the cloud normally. No data is lost
from working offline.

**Can I move the vault back to a local (non-synced) folder?**

Yes. Open **Settings → Vault paths → Cloud sync** and click **Move vault to
cloud sync…** again. At Step 2, browse to any local folder that is outside your
cloud provider's sync tree. The wizard moves the vault there the same way it
moved it in. You can repeat this process as many times as needed.

**The wizard won't start — the button is greyed out.**

The button is disabled if no Story Vault path is configured, or if the current
vault path is not accessible. Open **Settings → Vault paths** and confirm the
Story Vault path is set and readable before retrying.
