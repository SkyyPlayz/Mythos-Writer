import { test } from '@playwright/test';

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
 */

test.describe('M12.1 — background job/queue infrastructure (real E2E)', () => {
  test.fixme(
    'starting a large vault scan keeps the scene editor responsive to typing ' +
      '(negative control: a synchronous stand-in scan measurably blocks input first)',
    async () => {}
  );

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
  test.fixme(
    'reopening the entity panel on an unchanged vault reads from the persistent index cache instead of rebuilding ' +
      '(negative control: today\'s rebuild-on-open path measurably re-executes first)',
    async () => {}
  );

  test.fixme(
    'dismissing a suggested fact ("don\'t ask again"), then forcing a full index rebuild, leaves the fact dismissed ' +
      '(negative control: a hard-deleted dismissal reappears after rebuild first)',
    async () => {}
  );

  test.fixme(
    'the fact ledger never renders as vault content — a ledger-only extracted fact does not appear as a note in the Notes Vault',
    async () => {}
  );
});
