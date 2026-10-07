/**
 * Vitest-only NSIS contract helpers for build/uninstall-vaults.nsh.
 * Imported only by uninstallVaultsNsh.test.ts — not used by electron-main runtime.
 */

/** Exact shipped checkbox line (MW-delete-vault UX lock). */
export const MYTHOS_DELETE_VAULTS_SECTION_O_LINE =
  'Section /o "un.Also delete my Mythos vaults / writing data" SEC_DELETE_MYTHOS_VAULTS';

export const DELETE_APP_SETTINGS_JSON =
  'Delete "$APPDATA\\Mythos Writer\\app-settings.json"';
export const DELETE_VAULT_SETTINGS_JSON =
  'Delete "$APPDATA\\Mythos Writer\\vault-settings.json"';

export function nshMacroBody(source: string, macroName: string): string {
  const needle = `!macro ${macroName}`;
  let pos = 0;
  while (pos < source.length) {
    const start = source.indexOf(needle, pos);
    if (start < 0) return '';
    const after = start + needle.length;
    const next = source[after];
    if (next === ' ' || next === '\n' || next === '\r' || after === source.length) {
      const end = source.indexOf('!macroend', start);
      return end < 0 ? source.slice(start) : source.slice(start, end + '!macroend'.length);
    }
    pos = start + 1;
  }
  return '';
}

export function nshExecutableLines(source: string): string {
  return source.replace(/;[^\n]*/g, '');
}

export function assertUninstallerCheckboxSectionTokens(nsh: string): void {
  if (!nsh.includes('!macro customUnInstallSection')) {
    throw new Error('customUnInstallSection macro required for pre-uninstall checkbox page');
  }
  if (!nsh.includes('!ifdef BUILD_UNINSTALLER')) {
    throw new Error('delete-vaults checkbox must be guarded by !ifdef BUILD_UNINSTALLER');
  }
  if (!nsh.includes(MYTHOS_DELETE_VAULTS_SECTION_O_LINE)) {
    throw new Error(`delete-vaults section must use exact line: ${MYTHOS_DELETE_VAULTS_SECTION_O_LINE}`);
  }
  const ifdefAt = nsh.indexOf('!ifdef BUILD_UNINSTALLER');
  const endifAt = nsh.indexOf('!endif', ifdefAt);
  if (ifdefAt < 0 || endifAt <= ifdefAt) {
    throw new Error('BUILD_UNINSTALLER guard must close with !endif');
  }
  const guarded = nsh.slice(ifdefAt, endifAt);
  if (!guarded.includes(MYTHOS_DELETE_VAULTS_SECTION_O_LINE)) {
    throw new Error('Section /o line must appear inside !ifdef BUILD_UNINSTALLER');
  }
}

export function assertDeleteVaultsSectionOffByDefault(nsh: string): void {
  assertUninstallerCheckboxSectionTokens(nsh);
  if (!/Section\s+\/o\s+"un\.Also delete my Mythos vaults \/ writing data"/.test(nsh)) {
    throw new Error('delete-vaults section must be Section /o (unchecked by default)');
  }
  if (!nsh.includes('SEC_DELETE_MYTHOS_VAULTS')) {
    throw new Error('SEC_DELETE_MYTHOS_VAULTS section id required');
  }
}

export function assertNoExecutableMessageBox(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  if (/\bMessageBox\b/.test(executable)) {
    throw new Error('executable MessageBox must not appear in uninstall-vaults.nsh');
  }
  if (executable.includes('MB_DEFBUTTON1')) {
    throw new Error('MB_DEFBUTTON1 must not appear in uninstall-vaults.nsh');
  }
}

export function assertTraversalRejectedBeforeSidecarDelete(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const travAt = executable.indexOf('mythos_trav_scan');
  const travOkAt = executable.indexOf('uninstall_vault_trav_ok:');
  const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
  const sidecarRmAt = executable.indexOf('RMDir /r "$1"');
  if (travAt < 0 || travOkAt < 0 || doDeleteAt < 0 || sidecarRmAt < 0) {
    throw new Error('traversal scan / sidecar delete labels missing from uninstall nsh');
  }
  if (travOkAt <= travAt) {
    throw new Error('mythos_trav_scan must precede uninstall_vault_trav_ok');
  }
  if (doDeleteAt <= travOkAt) {
    throw new Error('traversal scan must complete before uninstall_vault_do_delete');
  }
  if (sidecarRmAt <= doDeleteAt) {
    throw new Error('allowlist gate must precede RMDir /r "$1" for sidecar paths');
  }
  if (!/StrCmp \$4 "\."/.test(executable)) {
    throw new Error('traversal scan must StrCmp path segments against literal "."');
  }
  const travRegion = executable.slice(travAt, travOkAt);
  if (!travRegion.includes(String.raw`StrCmp $4 "\" uninstall_vault_read`)) {
    throw new Error('traversal scan must reject .. via backslash-dot segment (uninstall_vault_read)');
  }
  if (!travRegion.includes('StrCmp $4 "." 0 mythos_trav_inc')) {
    throw new Error('traversal scan must branch on dot segments (mythos_trav_inc)');
  }
}

/** Critic H4: traversal scan completes, then allowlist, then per-line delete / RMDir "$1". */
export function assertTraversalThenAllowlistThenSidecarDelete(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const travOkAt = executable.indexOf('uninstall_vault_trav_ok:');
  const allowlistAt = executable.indexOf('StrLen $3 "$WINDIR"');
  const denyAt = executable.indexOf('mythos_al_deny');
  const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
  const sidecarRmAt = executable.indexOf('RMDir /r "$1"');
  if (travOkAt < 0 || allowlistAt < 0 || denyAt < 0 || doDeleteAt < 0 || sidecarRmAt < 0) {
    throw new Error('traversal / allowlist / sidecar-delete chain incomplete in uninstall nsh');
  }
  if (allowlistAt <= travOkAt) {
    throw new Error('allowlist checks must follow traversal scan (uninstall_vault_trav_ok)');
  }
  if (denyAt <= allowlistAt) {
    throw new Error('mythos_al_deny must follow allowlist prefix checks');
  }
  if (doDeleteAt <= denyAt) {
    throw new Error('uninstall_vault_do_delete must follow mythos_al_deny');
  }
  if (sidecarRmAt <= doDeleteAt) {
    throw new Error('RMDir /r "$1" must follow uninstall_vault_do_delete');
  }
}

export function assertDefaultVaultsFallbackRmdir(customUnInstallMacroBody: string): void {
  const needle = 'RMDir /r "$APPDATA\\Mythos Writer\\vaults"';
  if (!customUnInstallMacroBody.includes(needle)) {
    throw new Error('Remove all must RMDir default AppData vaults/ fallback');
  }
}

export function assertSettingsJsonDeletesOnRemoveAllNotKeep(
  nsh: string,
  customUnInstallMacroBody: string,
): void {
  const ifMarker = '${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}';
  const elseMarker = '${Else}';
  const ifAt = customUnInstallMacroBody.indexOf(ifMarker);
  const elseAt = customUnInstallMacroBody.indexOf(elseMarker, ifAt);
  if (ifAt < 0 || elseAt <= ifAt) {
    throw new Error('SectionIsSelected gate required for *-settings.json delete pins');
  }
  const removeAllRegion = customUnInstallMacroBody.slice(ifAt, elseAt);
  if (!removeAllRegion.includes('!insertmacro mythos_delete_remove_all_user_data')) {
    throw new Error(
      'Remove-all gate must insert mythos_delete_remove_all_user_data (carries settings Deletes)',
    );
  }
  const removeAllMacro = nshMacroBody(nsh, 'mythos_delete_remove_all_user_data');
  if (!removeAllMacro.includes(DELETE_APP_SETTINGS_JSON)) {
    throw new Error('Remove-all macro must Delete app-settings.json');
  }
  if (!removeAllMacro.includes(DELETE_VAULT_SETTINGS_JSON)) {
    throw new Error('Remove-all macro must Delete vault-settings.json');
  }
  const keepRegion = customUnInstallMacroBody.slice(elseAt);
  const keepExec = nshExecutableLines(keepRegion);
  if (keepExec.includes(DELETE_APP_SETTINGS_JSON)) {
    throw new Error('KEEP branch must not Delete app-settings.json (Ivy)');
  }
  if (keepExec.includes(DELETE_VAULT_SETTINGS_JSON)) {
    throw new Error('KEEP branch must not Delete vault-settings.json (Ivy)');
  }
  const cacheMacro = nshMacroBody(nsh, 'mythos_delete_app_caches');
  const cacheExec = nshExecutableLines(cacheMacro);
  if (cacheExec.includes('app-settings.json') || cacheExec.includes('vault-settings.json')) {
    throw new Error('KEEP cache macro must not reference *-settings.json');
  }
}

export function assertRemoveAllDeletesStrictlyBetweenSectionIfAndElse(
  customUnInstallMacroBody: string,
  nsh?: string,
): void {
  const ifMarker = '${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}';
  const elseMarker = '${Else}';
  const ifAt = customUnInstallMacroBody.indexOf(ifMarker);
  const elseAt = customUnInstallMacroBody.indexOf(elseMarker, ifAt);
  if (ifAt < 0 || elseAt <= ifAt) {
    throw new Error('SEC_DELETE_MYTHOS_VAULTS SectionIsSelected gate must pair with ${Else}');
  }
  const removeAllRegion = customUnInstallMacroBody.slice(ifAt, elseAt);
  const keepRegion = customUnInstallMacroBody.slice(elseAt);
  const requiredInRemoveAll = [
    'FileOpen $0 "$APPDATA\\Mythos Writer\\uninstall-delete-paths.txt"',
    '!insertmacro mythos_delete_remove_all_user_data',
    'RMDir /r "$APPDATA\\Mythos Writer\\vaults"',
    'RMDir /r "$APPDATA\\Mythos Writer"',
  ];
  for (const token of requiredInRemoveAll) {
    if (!removeAllRegion.includes(token)) {
      throw new Error(`Remove-all token must live inside SectionIsSelected gate: ${token}`);
    }
  }
  if (keepRegion.includes('!insertmacro mythos_delete_remove_all_user_data')) {
    throw new Error('mythos_delete_remove_all_user_data must not appear in KEEP (${Else}) branch');
  }
  if (removeAllRegion.includes('!insertmacro mythos_delete_app_caches')) {
    throw new Error('mythos_delete_app_caches must not appear inside Remove-all gate');
  }
  if (nsh) {
    assertSettingsJsonDeletesOnRemoveAllNotKeep(nsh, customUnInstallMacroBody);
  }
}

/** Probe H-A: paths failing the allowlist must skip delete at mythos_al_deny (not do_delete). */
export function assertAllowlistDenySkipsSidecarLine(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const denyLabelAt = executable.indexOf('mythos_al_deny:');
  if (denyLabelAt < 0) {
    throw new Error('mythos_al_deny label missing from sidecar allowlist');
  }
  const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
  const denyRegion = executable.slice(denyLabelAt, doDeleteAt > denyLabelAt ? doDeleteAt : denyLabelAt + 200);
  if (!denyRegion.includes('Goto uninstall_vault_read')) {
    throw new Error('mythos_al_deny must Goto uninstall_vault_read (deny non-allowlisted paths)');
  }
  if (/Goto\s+uninstall_vault_do_delete/.test(denyRegion)) {
    throw new Error('mythos_al_deny must not Goto uninstall_vault_do_delete (allowlist deny)');
  }
}

/**
 * M13 / R-5: KEEP `${Else}`…`${EndIf}` must contain only `!insertmacro mythos_delete_app_caches`
 * (no other insertmacros, Delete, RMDir, or FileOpen).
 */
export function assertKeepElseEndIfInsertsOnlyAppCachesMacro(customUnInstallMacroBody: string): void {
  const elseAt = customUnInstallMacroBody.indexOf('${Else}');
  const endIfAt = customUnInstallMacroBody.indexOf('${EndIf}', elseAt);
  if (elseAt < 0 || endIfAt <= elseAt) {
    throw new Error('customUnInstall must pair ${Else} with ${EndIf} for KEEP branch');
  }
  const keepRegion = customUnInstallMacroBody.slice(elseAt, endIfAt);
  const insertMacros = keepRegion.match(/!insertmacro\s+\S+/g) ?? [];
  if (
    insertMacros.length !== 1 ||
    insertMacros[0] !== '!insertmacro mythos_delete_app_caches'
  ) {
    throw new Error(
      'KEEP ${Else}..${EndIf} must insert only mythos_delete_app_caches (M13 / R-5)',
    );
  }
  const executable = nshExecutableLines(keepRegion);
  if (/\b(RMDir|Delete|FileOpen|FileRead)\b/.test(executable)) {
    throw new Error('KEEP ${Else}..${EndIf} must not run Delete/RMDir/FileOpen/FileRead');
  }
}

/** R-5 / Probe H-A: KEEP (${Else}) runs cache macro only — never Remove-all user macro. */
export function assertKeepBranchInsertsCacheMacroOnly(customUnInstallMacroBody: string): void {
  assertKeepElseEndIfInsertsOnlyAppCachesMacro(customUnInstallMacroBody);
  const elseAt = customUnInstallMacroBody.indexOf('${Else}');
  const endIfAt = customUnInstallMacroBody.indexOf('${EndIf}', elseAt);
  if (elseAt < 0 || endIfAt <= elseAt) {
    throw new Error('customUnInstall must pair ${Else} with ${EndIf} for KEEP branch');
  }
  const keepRegion = customUnInstallMacroBody.slice(elseAt, endIfAt);
  if (!keepRegion.includes('!insertmacro mythos_delete_app_caches')) {
    throw new Error('KEEP branch must insert mythos_delete_app_caches');
  }
  if (keepRegion.includes('!insertmacro mythos_delete_remove_all_user_data')) {
    throw new Error('KEEP branch must not insert mythos_delete_remove_all_user_data (R-5)');
  }
}

export function assertSidecarAllowlistBeforeDelete(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  for (const token of [
    '$WINDIR',
    '$PROGRAMFILES',
    '$PROGRAMFILES64',
    '$DOCUMENTS',
    '$DESKTOP',
    '$PROFILE\\Downloads',
    '$APPDATA\\Mythos Writer',
    'mythos_al_deny',
  ]) {
    if (!executable.includes(token)) {
      throw new Error(`sidecar allowlist missing token: ${token}`);
    }
  }
  const denyAt = executable.indexOf('mythos_al_deny');
  const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
  const sidecarRmAt = executable.indexOf('RMDir /r "$1"');
  if (denyAt < 0 || doDeleteAt < denyAt || sidecarRmAt < doDeleteAt) {
    throw new Error('mythos_al_deny must precede uninstall_vault_do_delete before RMDir "$1"');
  }
}

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
