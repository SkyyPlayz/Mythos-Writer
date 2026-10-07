/** Pure ordering checks for build/uninstall-vaults.nsh (unit-tested, including mutants). */

export function assertSidecarDeleteAfterFileOpenAndClose(customUnInstallMacroBody: string): void {
  const fileOpenAt = customUnInstallMacroBody.indexOf(
    'FileOpen $0 "$APPDATA\\Mythos Writer\\uninstall-delete-paths.txt"',
  );
  const fileCloseAt = customUnInstallMacroBody.indexOf('FileClose $0');
  const sidecarDeleteAt = customUnInstallMacroBody.indexOf(
    'Delete "$APPDATA\\Mythos Writer\\uninstall-delete-paths.txt"',
  );
  if (fileOpenAt < 0 || fileCloseAt < 0 || sidecarDeleteAt < 0) {
    throw new Error('NSIS contract missing FileOpen, FileClose, or sidecar Delete');
  }
  if (sidecarDeleteAt < fileOpenAt) {
    throw new Error('sidecar Delete must not run before FileOpen');
  }
  if (sidecarDeleteAt < fileCloseAt) {
    throw new Error('sidecar Delete must run after FileClose');
  }
}
