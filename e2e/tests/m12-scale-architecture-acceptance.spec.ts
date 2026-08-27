import path from 'path';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { test, expect, type Page } from '@playwright/test';
import {
  launchApp,
  firstWindow,
  openSeededScene,
  seedUserData,
  seedVault,
  makeScratch,
  rmScratch,
} from '../perf/ui-runtime/launch';
import { measureKeystrokeToPaint } from '../perf/ui-runtime/keystrokePaint';

/**
 * SKY-10764 — independent acceptance-test verifier (QA, non-author) for
 * M12 wave 1 (M12.1 background job/queue infra — SKY-10730; M12.2
 * fact-ledger + persistent index cache — SKY-10731), part of the M12
 * scale-architecture epic (SKY-10729 / SKY-10666).
 *
 * Real E2E path per COMPANY-STANDARDS §4a: UI -> IPC -> main process ->
 * disk -> back. Written from the epic's locked spec + each slice's
 * acceptance criteria only, NOT from any implementation. Neither M12.1 nor
 * M12.2 has landed a PR as of this run (no job/queue infra, no fact-ledger
 * table exist in the repo yet), so every case below is a named `test.fixme`
 * skeleton. Finalize the real interaction (launch app, drive UI, assert on
 * disk/IPC state) the moment the relevant slice's PR merges.
 *
 * Do not patch product code from this file. Route failures to the owning
 * slice's builder and report on the epic (SKY-10729), never self-fix here.
 * Un-skip owner: whoever merges M12.1 (SKY-10730) / M12.2 (SKY-10731) —
 * flip the matching `test.fixme` to a real interaction in that same PR's
 * verification pass, or file a fast-follow if the merging engineer can't.
 *
 * SKY-10768 (M12.1 re-issue, AC4/AC5) un-skipped the first M12.1 case below
 * with a real interaction: real vault-scan job through the production
 * `window.api.jobs` IPC surface, real keystrokes into the real ProseMirror
 * editor via `measureKeystrokeToPaint` (CDP-traced main-thread time, not a
 * mocked signal). The other M12.1 cases are untouched — they verify
 * different acceptance criteria and stay with their named owner.
 *
 * SKY-10839 (M12.2 finalization, 2026-08-26) un-skipped the persistent-cache
 * M12.2 case below with a real interaction, once PR #1283 (SKY-10731)
 * merged. The other two M12.2 cases stay `test.fixme` — per the SKY-11035
 * owner ruling the notes-side fact-ledger extractor was cut, and no IPC/UI
 * surface exists anywhere in electron-main/src/ipc.ts or frontend/src for
 * fact_decisions (dismiss / "don't ask again" is unreachable from the UI).
 * COMPANY-STANDARDS §4c: features must be REACHABLE, never pre-seed the
 * thing under test — there is nothing to drive yet, so these stay fixme
 * with the blocker named. Un-skip owner: whoever wires a dismiss UI/IPC
 * handler to fact_decisions, or SKY-11035 if it supersedes this scope.
 */

/** Continuity Peek is the only shipped surface that calls loadEntityIndex()
 *  (electron-main/src/continuityPeekHandlers.ts) — it is the real UI path
 *  onto the M12.2 persistent vault_index_cache. Mirrors
 *  e2e/continuity-peek.spec.ts's shortcut-trigger pattern. */
async function ensureFocusMode(page: Page): Promise<void> {
  const shell = page.locator('.desktop-shell');
  const cls = await shell.getAttribute('class');
  if (!cls?.includes('writing-mode-focus')) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+F' : 'Control+Shift+F');
    await expect(shell).toHaveClass(/writing-mode-focus/, { timeout: 4_000 });
  }
}

async function selectWholeEditor(page: Page): Promise<void> {
  const editor = page.locator('.ProseMirror');
  // Retry the click+select — after closing the Continuity Peek modal
  // overlay, the first click can land before its close transition has
  // released pointer events / focus (SKY-8242 saw the same race in
  // e2e/continuity-peek.spec.ts's replaceSceneText).
  await expect
    .poll(async () => {
      await editor.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      return page.evaluate(() => window.getSelection()?.toString().trim() ?? '');
    }, { timeout: 10_000 })
    .not.toBe('');
}

async function openContinuityWithShortcut(page: Page): Promise<void> {
  await ensureFocusMode(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K');
  await expect(page.locator('.continuity-focus-overlay[role="dialog"]')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('.continuity-panel').first()).toBeVisible({ timeout: 6_000 });
}

async function closeContinuityOverlay(page: Page): Promise<void> {
  const overlay = page.locator('.continuity-focus-overlay[role="dialog"]');
  if (await overlay.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible({ timeout: 4_000 });
  }
}

function seedNotesEntity(notesVaultDir: string): void {
  const noteAbs = path.join(notesVaultDir, 'Universes', 'Marcus.md');
  fs.mkdirSync(path.dirname(noteAbs), { recursive: true });
  fs.writeFileSync(
    noteAbs,
    ['---', 'name: Marcus', 'type: character', '---', '', 'Marcus commands the eastern garrison.', ''].join('\n')
  );
}

function readVaultIndexCacheRow(
  vaultDir: string,
  filePath: string
): { content_hash: string; needs_rescan: number; indexed_at: string } | undefined {
  const db = new DatabaseSync(path.join(vaultDir, '.mythos', 'state.db'));
  try {
    return db
      .prepare('SELECT content_hash, needs_rescan, indexed_at FROM vault_index_cache WHERE file_path = ?')
      .get(filePath) as { content_hash: string; needs_rescan: number; indexed_at: string } | undefined;
  } finally {
    db.close();
  }
}

test.describe('M12.1 — background job/queue infrastructure (real E2E)', () => {
  test('starting a large vault scan keeps the scene editor responsive to typing ' +
    '(negative control: a synchronous stand-in scan measurably blocks input first)', async () => {
    const scratch = makeScratch('jobs-responsiveness');
    try {
      seedUserData(scratch.userData, scratch.vaultDir, scratch.notesVaultDir);
      seedVault(scratch.vaultDir);
      // Enough notes that a real vault-scan job is real work, not a no-op.
      const universesDir = path.join(scratch.vaultDir, 'Universes');
      fs.mkdirSync(universesDir, { recursive: true });
      for (let i = 0; i < 300; i++) {
        fs.writeFileSync(
          path.join(universesDir, `entity-${i}.md`),
          `# Entity ${i}\n\nSome prose about entity ${i}, for scan load.`
        );
      }

      const app = await launchApp(scratch.userData, { reducedMotion: true });
      try {
        const page = await firstWindow(app);
        await openSeededScene(page);

        // NEGATIVE CONTROL: jam the renderer's own JS thread with a repeating
        // busy-loop while measuring — proves measureKeystrokeToPaint's pipeline
        // can actually detect main-thread jank, not just report a placid
        // signal regardless of what's happening. This is the renderer-side
        // analogue of jobNonBlocking.integration.test.ts's synchronous
        // stand-in (same "prove the probe can fail" requirement, applied to
        // the metric this test actually reads).
        await page.evaluate(() => {
          (window as unknown as { __sky10768Block: number }).__sky10768Block = window.setInterval(() => {
            const end = performance.now() + 30;
            let sink = 0;
            while (performance.now() < end) sink = (sink + 1) % 997;
            void sink;
          }, 50);
        });
        const blocked = await measureKeystrokeToPaint(page, 20);
        await page.evaluate(() => {
          window.clearInterval((window as unknown as { __sky10768Block: number }).__sky10768Block);
        });
        // eslint-disable-next-line no-console
        console.log(`[SKY-10768] negative control keystroke p95=${blocked.p95.toFixed(2)}ms`);
        expect(blocked.p95).toBeGreaterThan(50); // the probe demonstrably caught the jam

        // POSITIVE PATH: the real production surface — window.api.jobs — with
        // a real vault-scan job running off the main thread, while typing.
        const jobId = await page.evaluate(async () => {
          const res = (await (window as unknown as {
            api: { jobs: { enqueue: (type: string) => Promise<{ jobId?: string; error?: string }> } };
          }).api.jobs.enqueue('vault-scan')) as { jobId?: string; error?: string };
          if (!res.jobId) throw new Error(`enqueue failed: ${res.error}`);
          return res.jobId;
        });
        expect(jobId).toBeTruthy();

        const responsive = await measureKeystrokeToPaint(page, 20);
        // eslint-disable-next-line no-console
        console.log(
          `[SKY-10768] vault-scan running keystroke p50=${responsive.p50.toFixed(2)}ms ` +
            `p95=${responsive.p95.toFixed(2)}ms (negative control p95=${blocked.p95.toFixed(2)}ms)`
        );
        // Real job running off-thread must not reproduce the jam the negative
        // control proved this harness can detect. A ratio (not a fixed ms
        // ceiling) so this stays meaningful across CI hosts of very different
        // speed — headless Xvfb keystroke-to-paint is noisier than a real
        // display (see ui-runtime.spec.ts), but the queue path staying well
        // under half of the deliberately-jammed run is not noise.
        expect(responsive.p95).toBeLessThan(blocked.p95 * 0.5);
      } finally {
        await app.close().catch(() => undefined);
      }
    } finally {
      rmScratch(scratch);
    }
  });

  test.fixme(
    'killing the app mid-scan (force quit) and relaunching resumes the job from its last checkpoint, not from scratch',
    async () => {}
  );

  test.fixme(
    'the UI surfaces live progress/ETA for an in-flight background scan',
    async () => {}
  );
});

test.describe('M12.2 — fact-ledger schema + persistent vault index cache (real E2E)', () => {
  test(
    'reopening the Continuity Peek panel on an unchanged vault reads from the persistent index cache instead of ' +
      "rebuilding (negative control: an actual content edit DOES trigger a re-parse, proving the cache-hit check can fail)",
    async () => {
      const scratch = makeScratch('factledger-cache');
      try {
        seedUserData(scratch.userData, scratch.vaultDir, scratch.notesVaultDir);
        seedVault(scratch.vaultDir);
        seedNotesEntity(scratch.notesVaultDir);
        const marcusPath = path.join(scratch.notesVaultDir, 'Universes', 'Marcus.md');

        const app = await launchApp(scratch.userData, { reducedMotion: true });
        try {
          const page = await firstWindow(app);
          await openSeededScene(page);

          // Real UI -> IPC -> main -> disk path: type "Marcus" into the real
          // ProseMirror editor, select it, and open Continuity Peek — this is
          // the only shipped surface that calls loadEntityIndex()
          // (electron-main/src/continuityPeekHandlers.ts).
          const editor = page.locator('.ProseMirror');
          await editor.click();
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
          await page.keyboard.press('Delete');
          await page.keyboard.type('Marcus');
          await expect(editor).toHaveText('Marcus', { timeout: 5_000 });
          await selectWholeEditor(page);

          await openContinuityWithShortcut(page);
          await expect(page.locator('.entity-card', { hasText: 'Marcus' }).first()).toBeVisible({ timeout: 8_000 });

          const afterFirstOpen = readVaultIndexCacheRow(scratch.vaultDir, marcusPath);
          expect(afterFirstOpen).toBeDefined();

          // Second open, unchanged note content on disk.
          await closeContinuityOverlay(page);
          await selectWholeEditor(page);
          await openContinuityWithShortcut(page);
          await expect(page.locator('.entity-card', { hasText: 'Marcus' }).first()).toBeVisible({ timeout: 8_000 });

          const afterSecondOpen = readVaultIndexCacheRow(scratch.vaultDir, marcusPath);
          expect(afterSecondOpen).toBeDefined();
          expect(afterSecondOpen!.content_hash).toBe(afterFirstOpen!.content_hash);
          // The cache-hit assertion: an unchanged-content re-open must not
          // re-write the cache row (loadEntityIndex only upserts on a hash
          // miss — see electron-main/src/vault/entityIndex.ts).
          expect(afterSecondOpen!.indexed_at).toBe(afterFirstOpen!.indexed_at);

          // NEGATIVE CONTROL: edit the note on disk, then re-open. This must
          // change indexed_at — proving the above equality check is capable
          // of failing, not just trivially passing every run.
          await closeContinuityOverlay(page);
          fs.writeFileSync(
            marcusPath,
            ['---', 'name: Marcus', 'type: character', '---', '', 'Marcus now commands the western fleet.', ''].join(
              '\n'
            )
          );
          await selectWholeEditor(page);
          await openContinuityWithShortcut(page);
          await expect(page.locator('.entity-card', { hasText: 'Marcus' }).first()).toBeVisible({ timeout: 8_000 });

          const afterEdit = readVaultIndexCacheRow(scratch.vaultDir, marcusPath);
          expect(afterEdit).toBeDefined();
          expect(afterEdit!.content_hash).not.toBe(afterSecondOpen!.content_hash);
          expect(afterEdit!.indexed_at).not.toBe(afterSecondOpen!.indexed_at);
        } finally {
          await app.close().catch(() => undefined);
        }
      } finally {
        rmScratch(scratch);
      }
    }
  );

  // SKY-10839: left as `test.fixme` — no IPC/UI surface anywhere in
  // electron-main/src/ipc.ts or frontend/src calls recordFactDecision() /
  // revokeFactDecision() / isFactSuppressed() (electron-main/src/db.ts).
  // Unit-level coverage of the tombstone-survives-rebuild contract itself is
  // in electron-main/src/factLedger.acceptance.test.ts (AC3) and
  // electron-main/src/factDecisions.test.ts. Per COMPANY-STANDARDS §4c,
  // features must be REACHABLE before a real E2E can drive them — un-skip
  // owner: whoever wires a dismiss/"don't ask again" UI+IPC handler to
  // fact_decisions.
  test.fixme(
    'dismissing a suggested fact ("don\'t ask again"), then forcing a full index rebuild, leaves the fact dismissed ' +
      '(negative control: a hard-deleted dismissal reappears after rebuild first)',
    async () => {}
  );

  // SKY-10839: left as `test.fixme`. The notes-side fact-ledger extractor
  // this case was written against was cut entirely by the SKY-11035 owner
  // ruling (2026-08-26) — see electron-main/src/db.ts's "Fact decisions"
  // section comment and electron-main/src/factLedger.acceptance.test.ts's
  // AC4. No extractor produces a "ledger-only fact" anywhere in this repo,
  // so there is nothing to drive; the assertion would be vacuous, not a real
  // check. Un-skip owner: SKY-11035 (manuscript-side fact ledger, CTO-owned)
  // if/when it introduces a comparable notes-rendering surface to guard.
  test.fixme(
    'the fact ledger never renders as vault content — a ledger-only extracted fact does not appear as a note in the Notes Vault',
    async () => {}
  );
});
