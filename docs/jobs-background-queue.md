# Background job queue (M12.1, SKY-10730 / SKY-10768)

Execution substrate for whole-corpus scan/extraction passes over
multi-million-word vaults. Consumed by the fact ledger (M12.2, SKY-10731) and
scan-scope UI (M12.3). Spec source: SKY-10666 mechanism #9.

## Non-blocking budget (binding)

> No scan/extraction/agent pass may ever block typing, navigation, or saving.

Concretely: **while a job runs, main-process event-loop tick gaps must stay
well under half of what the identical load stalls the loop synchronously with
no queue** (the host loop only relays small worker messages and does batched
SQLite writes; observed gaps are ~10 ms). The renderer thread is never
involved. `src/jobs/jobNonBlocking.integration.test.ts` and
`src/jobQueue.acceptance.test.ts` enforce this with the required negative
control: each first proves an identical synchronous, no-queue run stalls the
loop ≥ 400 ms (so the probe demonstrably detects blocking), then proves the
queue path stays under half of that same-run baseline
(`RESPONSIVE_VS_BLOCKED_RATIO`). This is a ratio, not a fixed ms ceiling
(SKY-10889) — a fixed 250 ms threshold flaked under shared CI-runner
scheduling/GC jitter with no code change.

## Architecture

```
renderer ── IPC (jobs:enqueue/list/progress/cancel, jobs:event push)
   │
main ── jobs/jobsIpc.ts        typed handlers, renderer job-type allowlist
        jobs/jobService.ts     per-vault singleton, init after openDb()
        jobs/jobQueue.ts       FIFO orchestrator; owns ALL SQLite writes
        jobs/jobsDb.ts         background_jobs + scan_coverage (db.ts v31)
   │
worker thread (electron-vite ?nodeWorker chunk; asarUnpack'd out/main)
        jobs/jobWorker.ts      thread entry — no Electron, no DB
        jobs/jobWorkerCore.ts  message loop
        jobs/handlers/*        job handlers: compute + fs reads only
```

Rules the split encodes:

- **Single writer.** Workers never open `state.db`; they post
  `total/progress/checkpoint/done/error` messages and the queue persists them.
- **Checkpoint = resume point.** The queue persists `checkpoint_json` +
  counters together as messages arrive. A crash/quit leaves the row at
  `running`; `resumeInterrupted()` requeues it at boot and the worker receives
  the checkpoint in `workerData`. App quit (`shutdown()`) intentionally writes
  no terminal status for the same reason.
- **Coverage manifest.** `scan_coverage` records (job_type, scope_kind,
  scope_path) → content_hash. Handlers get the map at spawn and skip unchanged
  units. Coverage batches ride on checkpoint messages — never persisted ahead
  of the checkpoint that claims them.
- **Checkpoint staleness.** vault-scan checkpoints carry a hash of the
  enumerated file list; if the list changed, the cursor is discarded and the
  coverage manifest alone prevents rework (costs re-hashing only).
- **ETA.** Computed from the current run's processed-units rate
  (resume-aware baseline), withheld for the first second of a run.
- **Security.** Renderer-enqueueable types are allowlisted
  (`RENDERER_ENQUEUEABLE_JOB_TYPES`); vault-scan is pinned to the open vault
  root — renderer payloads are dropped.
- **Dedup.** `JobQueue.enqueue()` collapses a duplicate submission for the
  same type + payload ("scope") into whichever job for that scope is already
  `queued` or `running`, returning its id instead of creating a second row
  (`jobsDb.findActiveJobByScope`). A scope with no active job — including one
  whose prior job already finished — always starts fresh. See
  `jobQueue.test.ts`'s "duplicate-scope collapsing" suite.

## Adding a job type

1. Write a handler in `src/jobs/handlers/` (pure: fs reads + compute; emit
   checkpoints at a sensible batch size; poll `isCancelled()` between units).
2. Register it in `jobWorker.ts` `HANDLERS` and add the type to `JobType`.
3. Renderer-triggerable? Add it to `RENDERER_ENQUEUEABLE_JOB_TYPES` and pin
   any filesystem scope in `jobsIpc.ts` — never trust renderer paths.
4. Cover checkpoint/resume for the handler (see `vaultScanJob.test.ts`).

## Idle catch-up (PLAN-IDLE-CATCH-UP)

The Continuity panel's background manuscript scan (`manuscript-scan`) can wait
for a pause in typing before it is handed to the queue. The renderer owns this;
main and the queue above are unchanged.

- **What it does.** `frontend/src/idleCatchUp/idleCatchUpGate.ts` keeps a
  renderer-side staging buffer (at most 8 items). Requests with the same type +
  scope coalesce, so only the newest one is kept. Once the writer has not typed
  for the idle time, staged items are submitted one per animation frame through
  the existing `jobs.enqueue`. The default is 2 minutes, clamped to 1–30
  (Settings → Editor → Idle catch-up). With the feature off, or in a window
  with no editor shell (floating panels), scans are submitted immediately, as
  before. Turning the feature off also submits anything still waiting. Before
  the writer has typed in the shell, the session counts as idle.
- **Typing.** Typing stops further submissions. Anything not yet submitted
  stays staged until the next pause. If a background scan already started, it
  may finish after you start typing again.
- **Vault switch.** Switching projects clears staged work. An item staged for
  one vault is never submitted to another. A failed vault read is not a
  switch: the item stays staged and the gate tries again after the next full
  idle window.
- **Errors.** The panel's call settles only when the request reaches a final
  outcome. A submit that fails, right away or after the wait, still shows
  "Background scan didn’t start — …" in the Continuity panel. A full buffer
  asks the writer to pause typing and try again. The panel shows a "queued"
  line while its scan is waiting. If the panel is closed before the outcome
  arrives, that outcome is dropped — the panel never updates after it closes.
- **No new IPC, no AI calls.** The gate only delays an existing
  `jobs:enqueue` call. It behaves the same in AI Off, Local Only and Full AI.
- **E2E seam.** `window.__E2E_IDLE_CATCHUP__` is test-only and production never
  sets it. When set, the gate exposes a hold-only controller on
  `window.__E2E_IDLE_CATCHUP_GATE__`, which parks a flush just before a submit
  so a spec can type in that window.

## Known limits (v1, deliberate)

- One job runs at a time (FIFO). Parallel lanes are a later concern.
- No per-job watchdog timeout; cancel is cooperative.
- On vault switch mid-job the worker is terminated; the job resumes when that
  vault is next opened (per-vault state.db).
