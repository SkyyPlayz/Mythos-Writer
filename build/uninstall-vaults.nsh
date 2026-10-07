; SKY-2969 / MW-delete-vault — Uninstaller: opt-in vault delete (owner UX lock)
;
; Included via electron-builder nsis.include (shared header, before installer.nsi).
;
; electron-builder calls customUnInstall on every uninstall, including --updated.
; Wrap all deletes in ${IfNot} ${isUpdated} so upgrades delete nothing.
;
; KEEP (checkbox off): mythos_delete_app_caches only (see appUserDataManifest.ts).
; Remove all: FileRead sidecar → FileClose → delete sidecar → user data → vaults → RMDir userData.

!ifdef BUILD_UNINSTALLER
  Section /o "un.Also delete my Mythos vaults / writing data" SEC_DELETE_MYTHOS_VAULTS
  SectionEnd
!endif

!macro customUnInstallSection
!macroend

; KEEP uninstall — caches only (sync APP_CACHE_* in appUserDataManifest.ts).
!macro mythos_delete_app_caches
  Delete "$APPDATA\Mythos Writer\window-state.json"
  RMDir /r "$APPDATA\Mythos Writer\vault-index-cache"
  RMDir /r "$APPDATA\Mythos Writer\note-thumb-cache"
!macroend

; Remove all — user settings/content (sidecar deleted after FileClose, not here).
!macro mythos_delete_remove_all_user_data
  Delete "$APPDATA\Mythos Writer\app-settings.json"
  Delete "$APPDATA\Mythos Writer\vault-settings.json"
  Delete "$APPDATA\Mythos Writer\brainstorm-settings.json"
  Delete "$APPDATA\Mythos Writer\secrets.json"
  RMDir /r "$APPDATA\Mythos Writer\templates"
  RMDir /r "$APPDATA\Mythos Writer\agent-personas"
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    ${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}
      ClearErrors
      FileOpen $0 "$APPDATA\Mythos Writer\uninstall-delete-paths.txt" r
      IfErrors uninstall_vault_fallback
      uninstall_vault_read:
        ClearErrors
        FileRead $0 $1
        IfErrors uninstall_vault_close
        StrCpy $2 $1 1 -1
        StrCmp $2 "$\n" 0 +2
          StrCpy $1 $1 -1
        StrCpy $2 $1 1 -1
        StrCmp $2 "$\r" 0 +2
          StrCpy $1 $1 -1
        StrCmp $1 "" uninstall_vault_read
        StrCpy $7 0
        mythos_trav_scan:
          StrCpy $4 $1 1 $7
          StrCmp $4 "" uninstall_vault_trav_ok
          StrCmp $4 "\" 0 mythos_trav_fwd
            StrCmp $7 "0" +5
            IntOp $8 $7 - 1
            StrCpy $4 $1 1 $8
            StrCmp $4 "." uninstall_vault_read
            StrCmp $4 " " uninstall_vault_read
            StrCmp $4 "$\t" uninstall_vault_read
            IntOp $8 $7 + 1
            StrCpy $4 $1 1 $8
            StrCmp $4 " " uninstall_vault_read
            StrCmp $4 "$\t" uninstall_vault_read
            StrCmp $4 "." 0 mythos_trav_inc
              IntOp $8 $8 + 1
              StrCpy $4 $1 1 $8
              StrCmp $4 "" uninstall_vault_read
              StrCmp $4 "\" uninstall_vault_read
              StrCmp $4 "/" uninstall_vault_read
              StrCmp $4 "." 0 mythos_trav_inc
                IntOp $8 $8 + 1
                StrCpy $4 $1 1 $8
                StrCmp $4 "" uninstall_vault_read
                StrCmp $4 "\" uninstall_vault_read
                StrCmp $4 "/" uninstall_vault_read
                Goto mythos_trav_inc
          mythos_trav_fwd:
          StrCmp $4 "/" 0 mythos_trav_inc
            StrCmp $7 "0" +5
            IntOp $8 $7 - 1
            StrCpy $4 $1 1 $8
            StrCmp $4 "." uninstall_vault_read
            StrCmp $4 " " uninstall_vault_read
            StrCmp $4 "$\t" uninstall_vault_read
            IntOp $8 $7 + 1
            StrCpy $4 $1 1 $8
            StrCmp $4 "/" uninstall_vault_read
            StrCmp $4 " " uninstall_vault_read
            StrCmp $4 "$\t" uninstall_vault_read
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
        StrCpy $2 $1 1 -1
        StrCmp $2 "." uninstall_vault_read
        StrCmp $2 " " uninstall_vault_read
        StrCmp $2 "$\t" uninstall_vault_read
        StrLen $3 "$WINDIR"
        StrCpy $4 $1 $3
        StrCmp $4 "$WINDIR" uninstall_vault_read 0
        StrLen $3 "$PROGRAMFILES"
        StrCpy $4 $1 $3
        StrCmp $4 "$PROGRAMFILES" uninstall_vault_read 0
        StrLen $3 "$PROGRAMFILES64"
        StrCpy $4 $1 $3
        StrCmp $4 "$PROGRAMFILES64" uninstall_vault_read 0
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
        Delete "$APPDATA\Mythos Writer\uninstall-delete-paths.txt"
      uninstall_vault_fallback:
        !insertmacro mythos_delete_remove_all_user_data
        RMDir /r "$APPDATA\Mythos Writer\vaults"
        RMDir /r "$APPDATA\Mythos Writer"
    ${Else}
      !insertmacro mythos_delete_app_caches
    ${EndIf}
  ${EndIf}
!macroend
