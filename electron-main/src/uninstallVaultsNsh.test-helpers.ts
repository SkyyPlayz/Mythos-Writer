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
  const sidecarRmAt = executable.indexOf('RMDir /r "$3"');
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
    throw new Error('allowlist gate must precede RMDir /r "$3" for sidecar paths');
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

/** Critic H4: traversal scan completes, then allowlist, then per-line delete / RMDir "$3". */
export function assertTraversalThenAllowlistThenSidecarDelete(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const travOkAt = executable.indexOf('uninstall_vault_trav_ok:');
  const allowlistAt = executable.indexOf('StrCpy $5 "$WINDIR"');
  const denyAt = executable.indexOf('mythos_al_deny');
  const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
  const sidecarRmAt = executable.indexOf('RMDir /r "$3"');
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
    throw new Error('RMDir /r "$3" must follow uninstall_vault_do_delete');
  }
}

export const MYTHOS_RMDIR_UNLESS_REPARSE_VAULTS =
  '!insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\\Mythos Writer\\vaults" vaults';
export const MYTHOS_RMDIR_UNLESS_REPARSE_APPDATA =
  '!insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\\Mythos Writer" appdata';

export function assertDefaultVaultsFallbackRmdir(customUnInstallMacroBody: string): void {
  if (!customUnInstallMacroBody.includes(MYTHOS_RMDIR_UNLESS_REPARSE_VAULTS)) {
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
    MYTHOS_RMDIR_UNLESS_REPARSE_VAULTS,
    MYTHOS_RMDIR_UNLESS_REPARSE_APPDATA,
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
/** Critic S8 / Probe S5 — exact APPDATA Mythos Writer root self-match deny (M5). */
export const APPDATA_MYTHOS_WRITER_ROOT_SELF_MATCH_LINE =
  '          StrCmp $3 $5 uninstall_vault_read';

export function assertAppDataMythosWriterRootSelfMatchGuard(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const anchor = 'StrCpy $5 "$APPDATA\\Mythos Writer"';
  const anchorAt = executable.indexOf(anchor);
  const notAppdataAt = executable.indexOf('mythos_al_not_appdata:', anchorAt);
  if (anchorAt < 0 || notAppdataAt <= anchorAt) {
    throw new Error('APPDATA Mythos Writer allowlist anchor missing');
  }
  const region = executable.slice(anchorAt, notAppdataAt);
  const prefixMatch = 'StrCmp $4 $5 0 mythos_al_not_appdata';
  if (!region.includes(prefixMatch)) {
    throw new Error('APPDATA prefix match must branch to mythos_al_not_appdata');
  }
  if (!region.includes('StrCmp $3 $5 uninstall_vault_read')) {
    throw new Error(
      'APPDATA Mythos Writer root must StrCmp $3 $5 uninstall_vault_read (M5 / S8 / S5)',
    );
  }
  const lines = nsh.split(/\r?\n/);
  const anchorLine = lines.findIndex((l) => l.includes(anchor));
  if (anchorLine < 0) {
    throw new Error('APPDATA anchor line missing in nsh file');
  }
  const selfMatchAt = lines.findIndex(
    (l, i) => i > anchorLine && i < anchorLine + 16 && l === APPDATA_MYTHOS_WRITER_ROOT_SELF_MATCH_LINE,
  );
  if (selfMatchAt < 0) {
    throw new Error(
      `APPDATA root self-match line must be exact: ${JSON.stringify(APPDATA_MYTHOS_WRITER_ROOT_SELF_MATCH_LINE)}`,
    );
  }
}

export function mutantM5_dropAppDataRootSelfMatch(nsh: string): string {
  const needle =
    '        StrCpy $5 "$APPDATA\\Mythos Writer"\n' +
    '        System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"\n' +
    '        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0\n' +
    '        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read\n' +
    '        System::Call "kernel32::GetLongPathNameW(w r5, w .r5, i ${NSIS_MAX_STRLEN}) i .r4"\n' +
    '        IntCmp $4 0 +2 0 0\n' +
    '        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read\n' +
    '        StrCpy $2 "5a"\n' +
    '        Goto mythos_comp_tail_scan\n' +
    '        mythos_comp_tail_ret5a:\n' +
    '        StrLen $8 $5\n' +
    '        StrCpy $4 $3 $8\n' +
    '        StrCmp $4 $5 0 mythos_al_not_appdata\n' +
    '          StrCmp $3 $5 uninstall_vault_read';
  const replacement =
    '        StrCpy $5 "$APPDATA\\Mythos Writer"\n' +
    '        System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"\n' +
    '        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0\n' +
    '        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read\n' +
    '        System::Call "kernel32::GetLongPathNameW(w r5, w .r5, i ${NSIS_MAX_STRLEN}) i .r4"\n' +
    '        IntCmp $4 0 +2 0 0\n' +
    '        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read\n' +
    '        StrCpy $2 "5a"\n' +
    '        Goto mythos_comp_tail_scan\n' +
    '        mythos_comp_tail_ret5a:\n' +
    '        StrLen $8 $5\n' +
    '        StrCpy $4 $3 $8\n' +
    '        StrCmp $4 $5 0 mythos_al_not_appdata';
  const at = nsh.indexOf(needle);
  if (at < 0) {
    throw new Error('M5 APPDATA guard block missing from nsh');
  }
  return nsh.slice(0, at) + replacement + nsh.slice(at + needle.length);
}

export function assertAllowlistDenySkipsSidecarLine(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const denyLabelAt = executable.indexOf('mythos_al_deny:');
  if (denyLabelAt < 0) {
    throw new Error('mythos_al_deny label missing from sidecar allowlist');
  }
  // The canonical gate (with its own `Goto uninstall_vault_do_delete`) sits between this label and
  // uninstall_vault_do_delete:, so the deny block ends at the next label.
  const canonGateAt = executable.indexOf('mythos_canon_gate:', denyLabelAt);
  const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:', denyLabelAt);
  const denyEnd = canonGateAt > denyLabelAt ? canonGateAt : doDeleteAt > denyLabelAt ? doDeleteAt : denyLabelAt + 200;
  const denyRegion = executable.slice(denyLabelAt, denyEnd);
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
  const sidecarRmAt = executable.indexOf('RMDir /r "$3"');
  if (denyAt < 0 || doDeleteAt < denyAt || sidecarRmAt < doDeleteAt) {
    throw new Error('mythos_al_deny must precede uninstall_vault_do_delete before RMDir "$3"');
  }
}

const SHELL_VAR_CONTEXT_CURRENT = 'SetShellVarContext current';
const SHELL_VAR_CONTEXT_ALL = 'SetShellVarContext all';
const INSTALL_MODE_ALL_IF = '${If} $installMode == "all"';

/** RF-7a: the whole include runs as `current` before any $APPDATA/$DOCUMENTS/$DESKTOP read. */
export function assertShellVarContextCurrentThenRestorePrevious(nsh: string): void {
  const body = nshMacroBody(nsh, 'customUnInstall');
  const isUpdated = '${IfNot} ${isUpdated}';
  const isUpdatedAt = body.indexOf(isUpdated);
  if (isUpdatedAt < 0) {
    throw new Error('RF-7a: ${IfNot} ${isUpdated} missing');
  }
  const afterMacro = body.replace(/^!macro customUnInstall\s*/, '');
  if (!afterMacro.replace(/^\s+/, '').startsWith(SHELL_VAR_CONTEXT_CURRENT)) {
    throw new Error(
      'RF-7a: SetShellVarContext current must be the first instruction of customUnInstall (before any shell var is read)',
    );
  }
  if (body.indexOf(SHELL_VAR_CONTEXT_CURRENT) > isUpdatedAt) {
    throw new Error('RF-7a: SetShellVarContext current must precede ${IfNot} ${isUpdated}');
  }
  const currentCount = body.split(SHELL_VAR_CONTEXT_CURRENT).length - 1;
  const allCount = body.split(SHELL_VAR_CONTEXT_ALL).length - 1;
  if (currentCount !== 1) {
    throw new Error(`RF-7a: expected exactly one SetShellVarContext current, got ${currentCount}`);
  }
  if (allCount !== 1) {
    throw new Error(`RF-7a: expected exactly one SetShellVarContext all, got ${allCount}`);
  }
  const sectionIf = '${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}';
  const sectionIfAt = body.indexOf(sectionIf);
  const elseAt = body.indexOf('${Else}', sectionIfAt);
  const sectionEndIfAt = body.indexOf('${EndIf}', elseAt);
  const restoreIfAt = body.indexOf(INSTALL_MODE_ALL_IF);
  if (sectionIfAt < 0 || elseAt < 0 || sectionEndIfAt < 0) {
    throw new Error('RF-7a: SectionIsSelected If/Else/EndIf missing');
  }
  if (restoreIfAt < 0 || restoreIfAt < sectionEndIfAt) {
    throw new Error('RF-7a: installMode restore must follow the SectionIsSelected ${EndIf}');
  }
  const isUpdatedEndIfAt = body.indexOf('${EndIf}', sectionEndIfAt + 1);
  if (isUpdatedEndIfAt < 0 || restoreIfAt < isUpdatedEndIfAt) {
    throw new Error(
      'RF-7a: installMode restore must follow ${IfNot} ${isUpdated} ${EndIf} (every exit, including --updated)',
    );
  }
  const restoreEndIfAt = body.indexOf('${EndIf}', restoreIfAt);
  const restoreRegion = body.slice(restoreIfAt, restoreEndIfAt);
  if (!restoreRegion.includes(SHELL_VAR_CONTEXT_ALL)) {
    throw new Error('RF-7a: installMode == "all" must SetShellVarContext all');
  }
  if (restoreRegion.includes('${Else}')) {
    throw new Error('RF-7a: installMode restore must have no ${Else} (stay current when not all)');
  }
  const deleteBlock = body.slice(body.indexOf(SHELL_VAR_CONTEXT_CURRENT), restoreIfAt);
  if (/\b(Abort|Quit)\b/.test(nshExecutableLines(deleteBlock))) {
    throw new Error('RF-7a: no Abort/Quit before context restore (every exit path must restore)');
  }
}

export const MYTHOS_RMDIR_UNLESS_REPARSE_INSERTS: readonly string[] = [
  '!insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\\Mythos Writer\\vault-index-cache" idx',
  '!insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\\Mythos Writer\\note-thumb-cache" thumb',
  '!insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\\Mythos Writer\\templates" tmpl',
  '!insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\\Mythos Writer\\agent-personas" pers',
  MYTHOS_RMDIR_UNLESS_REPARSE_VAULTS,
  MYTHOS_RMDIR_UNLESS_REPARSE_APPDATA,
];

/** RF-7b: every former fixed RMDir /r goes through the top-down reparse helper. */
export function assertMythosRmdirUnlessReparseHelper(nsh: string): void {
  const helper = nshMacroBody(nsh, 'mythos_rmdir_unless_reparse');
  if (!helper.includes('GetFileAttributesW')) {
    throw new Error('RF-7b: mythos_rmdir_unless_reparse must call GetFileAttributesW');
  }
  if (!helper.includes('0x400')) {
    throw new Error('RF-7b: mythos_rmdir_unless_reparse must mask FILE_ATTRIBUTE_REPARSE_POINT (0x400)');
  }
  if (!helper.includes('RMDir /r "$3"')) {
    throw new Error('RF-7b: helper must RMDir /r "$3" only after the walk');
  }
  if (helper.includes('RMDir /r "${_path}"')) {
    throw new Error('H2: helper must RMDir the checked $3, not ${_path}');
  }
  const customAt = nsh.indexOf('!macro customUnInstall\n');
  const helperAt = nsh.indexOf('!macro mythos_rmdir_unless_reparse');
  if (customAt < 0 || helperAt < 0 || helperAt < customAt) {
    throw new Error('RF-7b: helper must be defined after customUnInstall so :43–:213 stay put');
  }
  for (const token of MYTHOS_RMDIR_UNLESS_REPARSE_INSERTS) {
    if (!nsh.includes(token)) {
      throw new Error(`RF-7b: missing reparse-guarded RMDir insert: ${token}`);
    }
  }
  const bareFixed = [
    'RMDir /r "$APPDATA\\Mythos Writer\\vault-index-cache"',
    'RMDir /r "$APPDATA\\Mythos Writer\\note-thumb-cache"',
    'RMDir /r "$APPDATA\\Mythos Writer\\templates"',
    'RMDir /r "$APPDATA\\Mythos Writer\\agent-personas"',
    'RMDir /r "$APPDATA\\Mythos Writer\\vaults"',
    'RMDir /r "$APPDATA\\Mythos Writer"',
  ];
  for (const token of bareFixed) {
    if (nsh.includes(token)) {
      throw new Error(`RF-7b: bare RMDir /r must go through the helper: ${token}`);
    }
  }
}

export function assertSidecarReparseWalkBeforeDelete(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const walkAt = executable.indexOf('mythos_reparse_walk:');
  const leafAt = executable.indexOf('mythos_reparse_leaf:');
  const doDeleteAt = executable.indexOf('uninstall_vault_do_delete:');
  const slashAt = executable.indexOf('mythos_canon_slash:');
  const rmdirAt = executable.indexOf('RMDir /r "$3"');
  const deleteAt = executable.indexOf('Delete "$3"');
  if (walkAt < 0 || leafAt < 0 || doDeleteAt < 0 || slashAt < 0 || rmdirAt < 0 || deleteAt < 0) {
    throw new Error('RF-7b: reparse walk / leftover-/ scan / do_delete / RMDir / Delete markers missing');
  }
  if (!executable.includes('Goto mythos_nested_root_guard')) {
    throw new Error('RF-7b: gate must Goto mythos_nested_root_guard before the walk');
  }
  if (!executable.includes('Goto mythos_reparse_walk')) {
    throw new Error('RF-7b: nested-root guard must Goto mythos_reparse_walk (not skip the walk)');
  }
  if (
    !(
      walkAt < leafAt &&
      leafAt < doDeleteAt &&
      doDeleteAt < slashAt &&
      slashAt < rmdirAt &&
      rmdirAt < deleteAt
    )
  ) {
    throw new Error('RF-7b: walk must run top-down before leftover-/ on $3, RMDir /r "$3" and Delete "$3"');
  }
  if (!executable.includes('GetLongPathNameW')) {
    throw new Error('HARD-A: sidecar must GetLongPathNameW the line and every root before deny/allowlist');
  }
  if (!executable.includes('IfFileExists "$3\\*.*"')) {
    throw new Error('H1: IfFileExists must act on the checked $3, not $1');
  }
  if (!executable.includes('StrCmp $6 "/" uninstall_vault_read')) {
    throw new Error('H1: leftover / on $3 after canonicalisation must skip');
  }
  if (!executable.includes('IntOp $4 $4 & 0x400')) {
    throw new Error('RF-7b: walk must mask GetFileAttributesW with 0x400 (not a wider mask)');
  }
  if (!executable.includes('GetFileAttributesW(w r6)') || !executable.includes('GetFileAttributesW(w r3)')) {
    throw new Error('RF-7b: walk must GetFileAttributesW each ancestor (r6) and the leaf (r3)');
  }
  if (
    !executable.includes('mythos_nr_appdata:') ||
    !executable.includes('mythos_nr_documents:') ||
    !executable.includes('mythos_nr_desktop:') ||
    !executable.includes('mythos_nr_downloads:')
  ) {
    throw new Error('HARD-2: nested-root guard must GFPN every allowed root');
  }
}

/** HARD-1: StrPBrkW set includes controls 1–31 plus `*?<>"|` (42, 63, 60, 62, 34, 124). */
export function assertWildcardAndControlCharReject(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  for (const code of ['42', '63', '60', '62', '34', '124']) {
    if (!executable.includes(`&i2 ${code}`)) {
      throw new Error(`HARD-1: StrPBrkW set must include char ${code}`);
    }
  }
  if (!executable.includes('System::Alloc 80')) {
    throw new Error('HARD-1: charset alloc must fit controls plus *?<>"|');
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
