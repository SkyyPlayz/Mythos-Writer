import path from 'path';
import fs from 'fs';
import { test, expect } from '@playwright/test';
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
 * mocked signal). The remaining M12.1 cases are untouched — they verify
 * different acceptance criteria and stay with their named owners.
 *
 * SKY-10839 (2026-08-26) closed out the M12.2 block below: owner ruling
 * SKY-11035 dropped the notes-sourced fact ledger before it had a UI, so
 * the fixmes that targeted that UI were removed rather than faked. See the
 * comment on the M12.2 describe block for what still covers AC2.
 */

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

// M12.2 (SKY-10731) closeout, 2026-08-26: owner ruling SKY-11035 (applied by
// SKY-11037) dropped the notes-sourced fact ledger and its extractor before
// any UI shipped for it. There is no "suggested fact" surface and no
// dismiss/tombstone UI to drive, so the two fixmes below that targeted that
// surface are removed rather than faked — per COMPANY-STANDARDS §4c a test
// must drive a reachable feature, never pre-seed the thing under test.
//
// The remaining M12.2 fixme ("reopening the entity panel reads the
// persistent cache") is covered without a new test here:
//   - functionally, at the real UI->IPC->disk->back layer, by
//     e2e/continuity-peek.spec.ts TC-CP-11 ("re-triggered lookup reads
//     updated note content from disk") — that test edits a note on disk and
//     asserts the re-lookup reflects it, which only works because
//     loadEntityIndex()'s content-hash staleness check is real;
//   - at the DB layer (cache row present / indexed_at unchanged on an
//     unchanged-content repeat load, spy-verified zero re-parses), by
//     electron-main/src/entityIndexCache.acceptance.test.ts.
// A third, UI-level test asserting the same DB row directly would duplicate
// both without adding coverage.
