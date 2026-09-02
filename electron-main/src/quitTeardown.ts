// SKY-10902: a hung teardown step (observed: a watcher whose fs.watch handle
// won't settle on Windows after a failed vault-move) must never block quit —
// an unkillable app is worse than a dirty exit. Every step gets its own
// timeout and try/catch so one hang or throw can't skip the rest.
export function runQuitTeardownStep(
  label: string,
  fn: () => void | Promise<void>,
  timeoutMs = 3000,
  onError: (message: string) => void = (msg) => console.error(msg),
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeoutId = setTimeout(() => {
      onError(`[quit] ${label} timed out after ${timeoutMs}ms — continuing teardown`);
      finish();
    }, timeoutMs);
    Promise.resolve()
      .then(fn)
      .catch((err) => {
        onError(`[quit] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        finish();
      });
  });
}
