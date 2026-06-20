; SKY-2969 — Uninstaller: keep-vaults vs delete-all choice
;
; Included into the NSIS installer script via electron-builder's nsis.include.
; The `customUnInstall` macro runs at the end of the uninstall section, after
; the app binary and shortcuts have been removed.
;
; Logic:
;   1. Ask the user whether to keep vault data or delete it.
;   2. On "delete": remove %APPDATA%\Mythos Writer\vaults\ (default bundle)
;      and the two settings files in %APPDATA%\Mythos Writer\.
;   3. On "keep" (default): leave all files in place.
;
; Note: vaults stored outside the default location (%APPDATA%\Mythos Writer\vaults\)
; are not removed here — users must delete those manually.

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 \
    "Keep your Mythos Writer vaults on disk?$\r$\n$\r$\n\
Your Story Vault and Notes Vault contain your manuscript, notes, and entities.$\r$\n$\r$\n\
Click Yes to keep your vault files.$\r$\n\
Click No to permanently delete vault data from the default location.$\r$\n$\r$\n\
(Vaults stored in custom locations will not be removed automatically.)" \
    IDYES uninstall_vault_keep IDNO uninstall_vault_delete

  uninstall_vault_delete:
    RMDir /r "$APPDATA\Mythos Writer\vaults"
    Delete "$APPDATA\Mythos Writer\vault-settings.json"
    Delete "$APPDATA\Mythos Writer\app-settings.json"
    Goto uninstall_vault_done

  uninstall_vault_keep:
    ; Leave vault data in place — intentional no-op.

  uninstall_vault_done:
!macroend
