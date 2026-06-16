# Safety, Versioning, Sync, and Obsidian Compatibility

Mythos Writer is built to keep your story safe, your notes organized, and your data fully under your control. Everything is designed to be non-destructive, local-first, and easy to restore.

## Non-destructive by default

Mythos Writer never overwrites your work without your permission.

- AI suggestions are **proposals**, not changes.
- Accepting a suggestion always creates a **snapshot** you can restore later.
- Your **Story Vault** is protected — agents never edit your story files directly.
- Only your **Notes Vault** is editable by agents, and even then, fixes require confirmation.

This means you can experiment freely without fear of losing anything.

## Per-scene and per-block version history

Every chapter, scene, and block has its own history.

You can:

1. Right-click a scene or block.
2. Open **History**.
3. See all past versions.
4. Compare differences.
5. Restore any version with one click.

This makes revisions safe, simple, and reversible.

## Local-first — sync via your existing cloud folder

Your vaults live on your computer. You own the files; you can open them in any editor; you can back them up however you like.

**MVP sync approach:** To keep your vault in sync across multiple machines, place the vault folder inside your existing cloud-storage folder (Dropbox, iCloud Drive, Google Drive, or OneDrive) and let the OS desktop client handle sync. No account or Mythos configuration required — it works because the vault is plain markdown files. See the setup guide at `plans/help/sync-vault-between-devices.md`.

**Caveat:** Do not open Mythos Writer and the OS sync client at the same time when the sync client is mid-conflict. Close Mythos before resolving sync conflicts in the cloud client, then reopen Mythos.

**Future — Mythos-hosted cloud sync (Monetization Phase 3):** A paid cloud-storage subscription tier that adds seamless in-app sync and the mobile companion app (where folder-level OS sync isn't viable). This is post-MVP and post-Phase 2 (in-app AI subscription). See `plans/ProjectGoalOverView/10-releases-and-roadmap.md` → Monetization plan.

## Full Obsidian compatibility

Both your Story Vault and Notes Vault use standard markdown files and frontmatter, so:

- You can open your vaults in Obsidian.
- You can open Obsidian vaults in Mythos Writer.
- Nothing is locked behind a proprietary format.
- Your data stays future-proof.

Mythos Writer also includes a **graph view** similar to Obsidian's, so you can visualize how your characters, locations, items, and scenes connect.

## Privacy and cost controls

You decide how much AI you want to use and how much it costs.

You can:

- Choose local models or cloud models.
- Set per-agent compute budgets.
- See when cloud actions will cost money.
- Disable cloud AI entirely if you prefer.

Your data stays private, and you stay in control.

## Example

You accept a suggestion from the Writing Assistant to improve a sentence.

Mythos Writer:

1. Saves a snapshot of the scene before the change.
2. Applies the suggestion.
3. Lets you continue writing.

Later, if you decide you liked the original version better, you open the scene's history and restore the previous snapshot with one click.

Your story stays safe, clean, and fully reversible.
