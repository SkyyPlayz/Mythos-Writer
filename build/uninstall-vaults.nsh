; SKY-2969 / MW-delete-vault — Uninstaller: keep-vaults vs delete-all choice
;
; Included into the NSIS installer script via electron-builder's nsis.include.
; The `customUnInstall` macro runs at the end of the uninstall section, after
; the app binary and shortcuts have been removed.
;
; Dialog polarity (LOCKED): MB_YESNO|MB_DEFBUTTON1 — Yes=keep (no-op), No=delete.
; On delete: FileRead the sidecar the app writes at
;   $APPDATA\Mythos Writer\uninstall-delete-paths.txt
; (UTF-8 no BOM, one absolute path per line — registered vault roots including
; custom paths + settings files), then always fall back to the default AppData
; vaults bundle + the two settings files.

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 \
    "Keep your Mythos Writer vaults on disk?$\r$\n$\r$\n\
Your Story Vault and Notes Vault contain your manuscript, notes, and entities.$\r$\n$\r$\n\
Click Yes to keep your vault files (default).$\r$\n\
Click No to permanently delete every registered vault — including custom paths the app recorded — plus settings.$\r$\n$\r$\n\
Keep leaves everything on disk." \
    IDYES uninstall_vault_keep IDNO uninstall_vault_delete

  uninstall_vault_delete:
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
      Goto uninstall_vault_done

  uninstall_vault_keep:
    ; Leave vault data in place — intentional no-op.

  uninstall_vault_done:
!macroend
