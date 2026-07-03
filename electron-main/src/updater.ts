// Auto-update gating (MYT-245 / Beta 2 Part I).
//
// History: the updater used to require the runtime env MYTHOS_AUTO_UPDATE=1.
// The release workflow only set that variable in the CI *build* shell (no vite
// define bake), so the packaged binary never saw it at runtime and every
// shipped build had auto-update silently disabled. The default is therefore
// flipped: packaged builds auto-update unless MYTHOS_AUTO_UPDATE=0 is set as
// an explicit kill switch. Unpackaged runs (dev, unit tests, headless E2E)
// are always inert regardless of the env flag.

/**
 * Truth table:
 * - unpackaged (dev/test/E2E)      → false, whatever the flag says
 * - packaged + flag unset          → true  (the shipped default)
 * - packaged + MYTHOS_AUTO_UPDATE=0 → false (kill switch)
 * - packaged + any other value     → true  (incl. legacy '1')
 */
export function isAutoUpdateEnabled(isPackaged: boolean, envFlag: string | undefined): boolean {
  if (!isPackaged) return false;
  return envFlag !== '0';
}
