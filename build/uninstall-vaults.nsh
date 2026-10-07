; SKY-2969 / MW-delete-vault — Uninstaller: opt-in vault delete (owner UX lock)
;
; Included via electron-builder nsis.include (shared header, before installer.nsi).
;
; Owner UX lock (2026-09-28): delete MUST be opt-in. Default = KEEP.
; Primary UX: pre-Uninstall components page checkbox, unchecked by default
; ("Also delete my Mythos vaults / writing data").
;
; How the checkbox page appears:
;   - Defining !macro customUnInstallSection makes electron-builder insert
;     MUI_UNPAGE_COMPONENTS before INSTFILES when BUILD_UNINSTALLER is set
;     (installer.nsi). Section /o = unchecked = KEEP.
;   - The Section itself is declared at include-time under BUILD_UNINSTALLER
;     so ${SEC_DELETE_MYTHOS_VAULTS} exists before customUnInstall expands
;     inside the main uninstall section (customUnInstallSection is inserted
;     *after* that section — too late to define the ID).
;
; When checked: FileRead sidecar at
;   $APPDATA\Mythos Writer\uninstall-delete-paths.txt
; then always fall back to default AppData vaults + settings deletes.
;
; Shield allowlist: each sidecar line is re-checked (prefix + depth) before
; RMDir/Delete. Allowed = child of $APPDATA\Mythos Writer, $DOCUMENTS,
; $DESKTOP, or $PROFILE\Downloads. Denied = any `.` / `..` path segment
; (traversal), $WINDIR / $PROGRAMFILES / $PROGRAMFILES64 prefix, the folder
; roots themselves, and everything else.
;
; Post-start Yes/No dialog fallback is NOT used — checkbox page is cleanly
; available via electron-builder's customUnInstallSection hook.

!ifdef BUILD_UNINSTALLER
  ; /o = unchecked by default → KEEP vaults unless user opts in.
  Section /o "un.Also delete my Mythos vaults / writing data" SEC_DELETE_MYTHOS_VAULTS
  SectionEnd
!endif

; Empty body — presence alone triggers MUI_UNPAGE_COMPONENTS.
!macro customUnInstallSection
!macroend

; App-private machine state under $APPDATA\Mythos Writer (never user vault trees).
; Kept in sync with electron-main/src/appUserDataManifest.ts — uninstallVaultsNsh.test.ts pins both.
!macro mythos_delete_app_private
  Delete "$APPDATA\Mythos Writer\app-settings.json"
  Delete "$APPDATA\Mythos Writer\vault-settings.json"
  Delete "$APPDATA\Mythos Writer\brainstorm-settings.json"
  Delete "$APPDATA\Mythos Writer\window-state.json"
  Delete "$APPDATA\Mythos Writer\secrets.json"
  Delete "$APPDATA\Mythos Writer\uninstall-delete-paths.txt"
  RMDir /r "$APPDATA\Mythos Writer\vault-index-cache"
  RMDir /r "$APPDATA\Mythos Writer\note-thumb-cache"
  RMDir /r "$APPDATA\Mythos Writer\templates"
  RMDir /r "$APPDATA\Mythos Writer\agent-personas"
!macroend

!macro customUnInstall
  !insertmacro mythos_delete_app_private

  ${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}
    ClearErrors
    FileOpen $0 "$APPDATA\Mythos Writer\uninstall-delete-paths.txt" r
    IfErrors uninstall_vault_fallback
    uninstall_vault_read:
      ClearErrors
      FileRead $0 $1
      IfErrors uninstall_vault_close
      ; FileRead keeps trailing CR/LF — strip before RMDir/Delete.
      StrCpy $2 $1 1 -1
      StrCmp $2 "$\n" 0 +2
        StrCpy $1 $1 -1
      StrCpy $2 $1 1 -1
      StrCmp $2 "$\r" 0 +2
        StrCpy $1 $1 -1
      StrCmp $1 "" uninstall_vault_read
      ; Reject `.` / `..` path segments before any allowlist / RMDir
      ; (Shield tip-3 — Documents\..\..\Windows must not elevate).
      StrCpy $7 0
      mythos_trav_scan:
        StrCpy $4 $1 1 $7
        StrCmp $4 "" uninstall_vault_trav_ok
        StrCmp $4 "\" 0 mythos_trav_fwd
          IntOp $8 $7 + 1
          StrCpy $4 $1 1 $8
          StrCmp $4 "." 0 mythos_trav_inc
            IntOp $8 $8 + 1
            StrCpy $4 $1 1 $8
            StrCmp $4 "" uninstall_vault_read
            StrCmp $4 "\" uninstall_vault_read
            StrCmp $4 "." 0 mythos_trav_inc
              IntOp $8 $8 + 1
              StrCpy $4 $1 1 $8
              StrCmp $4 "" uninstall_vault_read
              StrCmp $4 "\" uninstall_vault_read
              Goto mythos_trav_inc
        mythos_trav_fwd:
        ; Same scan for forward-slash form (belt).
        StrCmp $4 "/" 0 mythos_trav_inc
          IntOp $8 $7 + 1
          StrCpy $4 $1 1 $8
          StrCmp $4 "." 0 mythos_trav_inc
            IntOp $8 $8 + 1
            StrCpy $4 $1 1 $8
            StrCmp $4 "" uninstall_vault_read
            StrCmp $4 "/" uninstall_vault_read
            StrCmp $4 "\" uninstall_vault_read
            StrCmp $4 "." 0 mythos_trav_inc
              IntOp $8 $8 + 1
              StrCpy $4 $1 1 $8
              StrCmp $4 "" uninstall_vault_read
              StrCmp $4 "/" uninstall_vault_read
              StrCmp $4 "\" uninstall_vault_read
        mythos_trav_inc:
        IntOp $7 $7 + 1
        Goto mythos_trav_scan
      uninstall_vault_trav_ok:
      ; Positive allowlist (prefix + depth). Fail closed — planted sidecar
      ; lines outside these prefixes never RMDir/Delete.
      ; Deny: $WINDIR / $PROGRAMFILES / $PROGRAMFILES64 (exact or child).
      ; Soft: StrCmp is case-insensitive — mixed-case legitimate paths still match.
      StrLen $3 "$WINDIR"
      StrCpy $4 $1 $3
      StrCmp $4 "$WINDIR" uninstall_vault_read 0
      StrLen $3 "$PROGRAMFILES"
      StrCpy $4 $1 $3
      StrCmp $4 "$PROGRAMFILES" uninstall_vault_read 0
      StrLen $3 "$PROGRAMFILES64"
      StrCpy $4 $1 $3
      StrCmp $4 "$PROGRAMFILES64" uninstall_vault_read 0
      ; Allow: $APPDATA\Mythos Writer\<child> (not userData root).
      StrCpy $5 "$APPDATA\Mythos Writer"
      StrLen $3 $5
      StrCpy $4 $1 $3
      StrCmp $4 $5 0 mythos_al_not_appdata
        StrCmp $1 $5 uninstall_vault_read
        StrCpy $4 $1 1 $3
        StrCmp $4 "\" 0 mythos_al_not_appdata
        StrCpy $6 $1 "" $3
        StrCpy $6 $6 "" 1
        StrCmp $6 "" uninstall_vault_read
        Goto uninstall_vault_do_delete
      mythos_al_not_appdata:
      ; Allow: $DOCUMENTS\<child> (never Documents itself).
      StrLen $3 "$DOCUMENTS"
      StrCpy $4 $1 $3
      StrCmp $4 "$DOCUMENTS" 0 mythos_al_not_documents
        StrCmp $1 "$DOCUMENTS" uninstall_vault_read
        StrCpy $4 $1 1 $3
        StrCmp $4 "\" 0 mythos_al_not_documents
        StrCpy $6 $1 "" $3
        StrCpy $6 $6 "" 1
        StrCmp $6 "" uninstall_vault_read
        Goto uninstall_vault_do_delete
      mythos_al_not_documents:
      ; Allow: $DESKTOP\<child> (never Desktop itself).
      StrLen $3 "$DESKTOP"
      StrCpy $4 $1 $3
      StrCmp $4 "$DESKTOP" 0 mythos_al_not_desktop
        StrCmp $1 "$DESKTOP" uninstall_vault_read
        StrCpy $4 $1 1 $3
        StrCmp $4 "\" 0 mythos_al_not_desktop
        StrCpy $6 $1 "" $3
        StrCpy $6 $6 "" 1
        StrCmp $6 "" uninstall_vault_read
        Goto uninstall_vault_do_delete
      mythos_al_not_desktop:
      ; Allow: $PROFILE\Downloads\<child>.
      StrCpy $5 "$PROFILE\Downloads"
      StrLen $3 $5
      StrCpy $4 $1 $3
      StrCmp $4 $5 0 mythos_al_deny
        StrCmp $1 $5 uninstall_vault_read
        StrCpy $4 $1 1 $3
        StrCmp $4 "\" 0 mythos_al_deny
        StrCpy $6 $1 "" $3
        StrCpy $6 $6 "" 1
        StrCmp $6 "" uninstall_vault_read
        Goto uninstall_vault_do_delete
      mythos_al_deny:
      Goto uninstall_vault_read
      uninstall_vault_do_delete:
      IfFileExists "$1\*.*" 0 uninstall_vault_file
        RMDir /r "$1"
        Goto uninstall_vault_read
      uninstall_vault_file:
        Delete "$1"
        Goto uninstall_vault_read
    uninstall_vault_close:
      FileClose $0
    uninstall_vault_fallback:
      RMDir /r "$APPDATA\Mythos Writer\vaults"
      Delete "$APPDATA\Mythos Writer\vault-settings.json"
      Delete "$APPDATA\Mythos Writer\app-settings.json"
      Delete "$APPDATA\Mythos Writer\uninstall-delete-paths.txt"
      ; PLAN-058 L8 / 00:46 — Remove all must not leave a Roaming Mythos folder.
      RMDir /r "$APPDATA\Mythos Writer"
  ${EndIf}
  ; Unchecked / not selected — leave vault data in place (default KEEP).
!macroend
