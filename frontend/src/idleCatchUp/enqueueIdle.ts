/**
 * PLAN-IDLE-CATCH-UP — the one entry point renderer consumers call.
 *
 * Purpose: thin ContinuityPanel-facing wrap to the idle gate; never owns
 * timers. The returned promise settles only on a terminal outcome (submitted,
 * enqueue error, rejected, coalesced, cleared) — never on "staged".
 */

import {
  idleCatchUpGate,
  type IdleEnqueueHooks,
  type IdleEnqueueOpts,
  type IdleEnqueueResult,
  type IdleJobType,
} from './idleCatchUpGate';

export type { IdleEnqueueHooks, IdleEnqueueOpts, IdleEnqueueResult, IdleJobType };

export function enqueueIdle(
  type: IdleJobType,
  opts?: IdleEnqueueOpts,
  hooks?: IdleEnqueueHooks,
): Promise<IdleEnqueueResult> {
  return idleCatchUpGate.enqueueWhenIdle(type, opts, hooks);
}
