# Mythos Writer — Smoke Test Plan
## Phase 2 + Phase 3 Critical User Flows

**Document:** MYT-255  
**Date:** 2026-05-23  
**Scope:** Phase 2 (Core Writing Experience) + Phase 3 (AI-Augmented Authoring) flows  
**Automated coverage:** `e2e/smoke.spec.ts` — TC-01, TC-02, TC-03 (open vault → write → save)  
**Manual coverage:** TC-04 through TC-08 — see issue checklist below

---

## Prerequisites

| Requirement | Value |
|---|---|
| Build | `npm run build:electron` (produces `out/main/main.js`) |
| Node | ≥ 18 |
| Platform | Windows 10/11 or macOS 13+ or Ubuntu 22.04 (AppImage) |
| API key | Valid `sk-ant-*` key required for TC-06, TC-07, TC-08 |
| Playwright | `npx playwright install` (for TC-01–03 automated run) |

---

## TC-01 — Open Vault

**Phase:** 2  
**Type:** Automated (e2e/smoke.spec.ts) + Manual verification

### Steps

1. Launch the app for the first time (fresh `userData`).
2. Onboarding wizard appears at step 1 (Welcome).
3. Click **Next** to advance to step 2 (Vault choice).
4. Select **"Open existing vault"** then click **Select folder**.
5. In the OS folder-picker dialog, choose a directory that contains at least one `.md` file.
6. Click **Next** to advance to step 3 (API Key).
7. Click **Skip for now**.
8. App shows step 4 (Done). Click **Start writing**.

### Expected Results

- `onboardingComplete: true` is written to `app-settings.json`.
- `vaultRoot` in `vault-settings.json` points to the selected folder.
- DesktopShell is rendered: `AppMenuBar` visible, left-rail stories tab active.
- No crash, no blank screen, no error banner.

---

## TC-02 — Write a Scene

**Phase:** 2  
**Type:** Automated (e2e/smoke.spec.ts) + Manual verification

### Steps

1. Starting from DesktopShell (TC-01 completed or pre-seeded settings).
2. In the left rail **Stories** tab, click **+** (New story).
3. Accept the default name or type `Smoke Test Story`.
4. Expand the story row and click **+** (New chapter).
5. Expand the chapter row and click **+** (New scene).
6. Click the scene name to open it in the editor.
7. In the TipTap block editor, click the content area and type:
   ```
   The dragon soared over the Foundry as dawn broke.
   ```
8. Observe the editor content updates immediately.

### Expected Results

- Scene is selected and shown in the BlockEditor (`scene-name` label matches the scene title).
- Typed text appears in the `.tiptap-content` element.
- No IPC error in the console.
- Word count in the right sidebar properties panel increments.

---

## TC-03 — Save Snapshot

**Phase:** 2  
**Type:** Automated (e2e/smoke.spec.ts) + Manual verification

### Steps

1. Continuing from TC-02 (text typed in editor).
2. Click **Save snapshot now** button in the scene editor toolbar.
3. Wait for the `Snapshot saved HH:MM:SS` indicator to appear.

### Expected Results

- The `snapshot:save` IPC call succeeds (check DevTools network tab or absence of error toast).
- The `.scene-autosave` span reads `Snapshot saved <time>`.
- Clicking **History** opens the `SceneHistory` panel, which lists at least one snapshot entry.
- Each snapshot row shows a word count and relative timestamp.

---

## TC-04 — Rollback to Previous Snapshot

**Phase:** 2  
**Type:** Manual

### Steps

1. Continuing from TC-03 (at least one snapshot saved).
2. Modify the scene: delete the sentence and replace with `The dragon was gone.`
3. Click **Save snapshot now** (a second snapshot is created).
4. Click **History** to open the SceneHistory panel.
5. Select the first (oldest) snapshot in the list.
6. Review the diff — removed lines are shown in red, added in green.
7. Click **Restore this version**.
8. Confirm the restore prompt if shown.

### Expected Results

- Editor content reverts to `The dragon soared over the Foundry as dawn broke.`
- A new snapshot is auto-saved immediately after restore (preserves rollback trail).
- The `.scene-autosave` indicator updates timestamp.
- SceneHistory panel closes after restore.
- No data loss: the newer text was captured in snapshot history before rollback.

---

## TC-05 — Change Settings

**Phase:** 2 + 3  
**Type:** Manual

### Steps

1. Click the **⚙** (gear icon) button in the AppMenuBar.
2. Settings panel opens.
3. In the **API Key** field, enter a valid `sk-ant-*` key.
4. Change **Theme** to `light`.
5. In the **Writing Assistant** section, set scan interval to `60` seconds.
6. Toggle **Brainstorm Agent** to disabled.
7. Click **Save**.

### Expected Results

- Settings panel shows "Saved!" confirmation without error.
- App theme switches to light immediately after save.
- `app-settings.json` on disk reflects all changes.
- With Brainstorm disabled, opening the Brainstorm view shows "Agent disabled" message.
- Re-opening Settings shows the previously saved values.

---

## TC-06 — Chat with Brainstorm and Confirm Note Creation

**Phase:** 3  
**Type:** Manual (requires live API key)

### Steps

1. Ensure Settings has a valid API key and Brainstorm agent is enabled (re-enable if disabled from TC-05).
2. Click **Brainstorm** in the AppMenuBar.
3. In the chat input, type:
   ```
   Tell me about Aria Voss, a young sorceress who discovered her powers at age 12.
   ```
4. Press **Enter** or click **Send**.
5. Wait for the streaming response to complete (tokens appear progressively).
6. Observe the **Detected facts** panel below the chat — a `character` fact card for `Aria Voss` should appear.
7. Verify the fact card shows `savedStatus: saved` (green indicator or "Saved to vault" label).

### Expected Results

- Streaming response renders token-by-token without freezing.
- At least one `[FACT:character|Aria Voss|...]` tag is parsed from the response.
- Fact is automatically saved to the Notes Vault (no confirmation required for new notes — per governance rule).
- A file `<vaultRoot>/Characters/Aria Voss.md` (or similar path) is created with provenance frontmatter.
- The fact card shows `savedStatus: saved`.
- No error toast or failed IPC in console.

---

## TC-07 — Scan with Writing Assistant

**Phase:** 3  
**Type:** Manual (requires live API key)

### Steps

1. Open a scene with text (TC-02 text or write new content).
2. Click the **Writing Assistant** tab in the right sidebar (or wherever it is surfaced).
3. In the Writing Assistant input, type:
   ```
   Review the pacing of the opening sentence.
   ```
4. Click **Send** and wait for streaming response.

### Expected Results

- Streaming response appears in the Writing Assistant panel token-by-token.
- Response contains advice, not a direct manuscript edit.
- A `WritingAssistantSuggestion` card appears with a confidence score.
- `suggestions:upsert` IPC call is made (verify via DevTools or absence of error).
- The suggestion status is `proposed`.
- Writing Assistant does NOT modify the TipTap editor content directly.

---

## TC-08 — Accept an Archive Wiki-Link Suggestion

**Phase:** 3  
**Type:** Manual (requires live API key or mock data)

### Steps

1. Open the Archive panel (right sidebar, "Archive" tab or separate surface).
2. If no real suggestions are visible, verify mock items appear (the mock includes `[[The Foundry]]`).
3. Locate a **Wiki-link suggestion** card in the "Wiki-link suggestions" section.
4. Read the suggestion: anchor text and proposed `[[wiki-link]]`.
5. Click **Accept wiki-link `[[The Foundry]]`** (aria-label).

### Expected Results

- The `suggestions:accept` IPC is called.
- The suggestion card is removed from the list (or marked accepted).
- If a scene is currently open, the archive panel's `onInsertWikiLink` callback triggers `ARCHIVE_INSERT_WIKI_LINK` in the editor, wrapping the anchor text as a live link.
- The suggestion appears in the audit log (`audit:list` IPC returns a row with `action: accepted`).
- One-click rollback is possible: clicking **Rollback** in the suggestion review panel restores the pre-link text.

---

## Issue Checklist (Manual Steps for MYT-255)

- [ ] TC-04: Rollback to previous snapshot — manual tester verifies two-snapshot diff and restore
- [ ] TC-05: Change settings — manual tester verifies theme, API key, per-agent toggles persist
- [ ] TC-06: Brainstorm note creation — manual tester confirms vault file created with provenance, streaming renders correctly
- [ ] TC-07: Writing Assistant scan — manual tester confirms suggestions appear, manuscript unchanged
- [ ] TC-08: Archive wiki-link accept — manual tester confirms IPC succeeds and link inserted in editor

---

## Automated Run Instructions

```bash
# 1. Build the Electron main process
npm run build:electron

# 2. Install Playwright browsers (first time only)
npx playwright install chromium

# 3. Run the smoke suite
npx playwright test e2e/smoke.spec.ts --reporter=list
```

**Expected output:** 3 passing tests (TC-01, TC-02, TC-03).

---

## Known Limitations

- TC-06, TC-07, TC-08 require a valid Anthropic API key and a live network connection; they cannot run in CI without a secret.
- The TipTap editor renders inside Electron's renderer process — Playwright selects it via `.ProseMirror` (the contenteditable root that TipTap mounts). If TipTap changes this class, update the selector.
- TC-04 rollback timing depends on the 5-second snapshot debounce in `SceneEditor.tsx:SNAPSHOT_DEBOUNCE_MS`. The automated test bypasses this by clicking "Save snapshot now" directly.
