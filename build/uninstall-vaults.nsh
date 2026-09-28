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

!macro customUnInstall
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
  ${EndIf}
  ; Unchecked / not selected — leave vault data in place (default KEEP).
!macroend
