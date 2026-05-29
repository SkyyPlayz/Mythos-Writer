# Onboarding — Mythos Writer

The first-run wizard appears when Mythos Writer boots without a configured vault.
It guides you through one of four setup paths, then hands off to the main editor.
The wizard does not appear again unless you use the **Reset onboarding** debug action
(see below) or move/delete both configured vault directories.

---

## Wizard flow overview

```
Boot (no vault configured)
  └─ Welcome screen — four picker cards
       ├─ A. Use the default layout  → default-path screen → Create vaults
       ├─ B. Start blank             → blank-path screen   → Create blank vaults
       ├─ C. Import Obsidian vault   → import-source → dry-run → import-progress
       │                                → import-success → Continue
       └─ D. Open sample project     → sample-path screen  → Open sample
                                           ↓
                                     DesktopShell (editor)
```

All four paths end with `onboarding:complete` IPC being called, which persists
`onboardingComplete: true` in `app-settings.json`. On next boot, the app skips
the wizard and opens the editor directly.

---

## Path A — Use the default layout

Creates a two-vault layout with the full SKY-15 scaffold:

- `<parent>/Story Vault/` — manuscript vault
  - `My First Story/Manuscript/01 - Opening/01 - Scene One.md`
  - `My First Story/Outline.md`, `Synopsis.md`
- `<parent>/Notes Vault/` — notes vault
  - Six top-level folders: `Universes/`, `Stories/`, `Inbox/`, `Research/`,
    `Daily Notes/`, `Archive/`
  - `Universes/My First Universe/` with six category sub-folders
  - `Stories/My First Story/`

**When to choose:** Starting fresh and want a ready-to-use structure.

---

## Path B — Start blank

Creates empty vault roots only:

- `<parent>/Story Vault/manifest.json` (schema only, no scaffold files)
- `<parent>/Notes Vault/` (empty — no scaffold directories)

The Brainstorm Agent learns your organization pattern as you work.

**When to choose:** You prefer to build your own folder structure from scratch.

### Path B rollback

If you later decide you want the default scaffold, you can re-run the wizard:

1. Open **Settings** (`⚙` in the menu bar).
2. In the **Debug** section (only visible when `MYTHOS_DEV=1`), click
   **Reset onboarding**.
3. Quit and relaunch Mythos Writer.

The wizard re-appears with a fresh welcome screen. Your existing vault data is
not deleted — the vault paths are only cleared from `vault-settings.json`.

---

## Path C — Import Obsidian vault

Imports an existing Obsidian vault into the Mythos Notes Vault layout.

**Steps:**

1. Click **Pick folder** (or drag-and-drop the vault folder) on the
   import-source screen.
2. Mythos scans the vault and shows a **dry-run report**:
   - Notes count, restructured paths, broken `[[links]]`, name collisions,
     notes missing frontmatter.
   - No changes are written until you confirm.
3. Click **Import →** to start the actual import.
4. A progress bar shows note-by-note restructuring.
5. On success, click **Continue →** to open the editor.

### Rollback after import

Before writing any notes, the importer takes a snapshot of the original vault.
The snapshot directory is shown on the import-success screen and can be found at
`<userData>/obsidian-import-snapshots/<timestamp>/` where `<userData>` is
Electron's user-data directory (e.g. `~/Library/Application Support/Mythos Writer/` on macOS).

To undo the last import:

1. Open **Settings → Vault**.
2. Click **Undo last Obsidian import**.
3. The vault is restored from the snapshot directory.

---

## Path D — Open sample project

Copies the bundled sample project into a two-vault layout:

- `<parent>/Story Vault/The Glass Library/` — one story with two chapters
- `<parent>/Notes Vault/Universes/Argent/` — Characters, Locations, Systems
- `<parent>/Notes Vault/Stories/The Glass Library/` — Beats, Notes, Themes

**When to choose:** Exploring the app for the first time; you can keep working
in the sample or start your own vault via **File → New project** at any time.

---

## Reset onboarding (debug action)

Available only when `MYTHOS_DEV=1` is set in the environment.

1. Launch Mythos Writer with `MYTHOS_DEV=1 npm run dev`.
2. Open **Settings** and scroll to the **Debug** section.
3. Click **Reset onboarding**.

This clears `storyVaultPath`, `notesVaultPath`, and `onboardingComplete` from
settings. The vault data on disk is untouched. On next boot, the wizard
re-appears.

---

## CI / automated testing

The four onboarding paths have Playwright end-to-end coverage under `e2e/tests/`:

| Spec file                         | Path tested       |
|-----------------------------------|-------------------|
| `onboarding-default.spec.ts`      | Path A — Default  |
| `onboarding-blank.spec.ts`        | Path B — Blank    |
| `onboarding-import.spec.ts`       | Path C — Import   |
| `onboarding-sample.spec.ts`       | Path D — Sample   |

Run locally after `npm run build:electron`:

```bash
npx playwright test e2e/tests/onboarding-default.spec.ts  --reporter=list
npx playwright test e2e/tests/onboarding-blank.spec.ts    --reporter=list
npx playwright test e2e/tests/onboarding-import.spec.ts   --reporter=list
npx playwright test e2e/tests/onboarding-sample.spec.ts   --reporter=list
```
