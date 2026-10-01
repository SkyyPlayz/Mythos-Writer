/**
 * C7(b): serialize Settings panel flush writes with create-flow
 * onboardingStartMode writes so a full-replace settings:set cannot
 * clobber a concurrent C7 write (get+set must stay back-to-back on
 * this chain — no other await between them inside a flush op).
 */
let settingsWriteChain: Promise<unknown> = Promise.resolve();

export function enqueueSettingsWrite<T>(op: () => Promise<T>): Promise<T> {
  const run = settingsWriteChain.then(op, op) as Promise<T>;
  settingsWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Test-only: reset the chain between cases. */
export function __resetSettingsWriteSerialForTests(): void {
  settingsWriteChain = Promise.resolve();
}
