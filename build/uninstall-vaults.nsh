; SKY-2969 / MW-delete-vault — Uninstaller: opt-in vault delete (owner UX lock)
;
; Included via electron-builder nsis.include (shared header, before installer.nsi).
;
; electron-builder calls customUnInstall on every uninstall, including --updated.
; Wrap all deletes in ${IfNot} ${isUpdated} so upgrades delete nothing.
;
; KEEP (checkbox off): mythos_delete_app_caches only (see appUserDataManifest.ts).
; Remove all: FileRead sidecar → FileClose → delete sidecar → user data → vaults → RMDir userData.
; S-5: a vault folder name that begins with a space or TAB is skipped on purpose (fail-safe: the user keeps that data).
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
        mythos_trim_loop:
          StrCmp $1 "" uninstall_vault_read
          StrCpy $2 $1 1 -1
          StrCmp $2 "$\n" mythos_trim_chop
          StrCmp $2 "$\r" mythos_trim_chop
          Goto mythos_trim_done
          mythos_trim_chop:
          StrCpy $1 $1 -1
          Goto mythos_trim_loop
        mythos_trim_done:
        StrCmp $1 "" uninstall_vault_read
        System::Alloc 64
        Pop $6
        System::Call "*$6(&i2 1,&i2 2,&i2 3,&i2 4,&i2 5,&i2 6,&i2 7,&i2 8,&i2 9,&i2 10,&i2 11,&i2 12,&i2 13,&i2 14,&i2 15,&i2 16,&i2 17,&i2 18,&i2 19,&i2 20,&i2 21,&i2 22,&i2 23,&i2 24,&i2 25,&i2 26,&i2 27,&i2 28,&i2 29,&i2 30,&i2 31,&i2 0)"
        System::Call "shlwapi::StrPBrkW(w r1, p r6) p .r4"
        System::Free $6
        StrCmp $4 0 mythos_ctrl_ok
          Goto uninstall_vault_read
        mythos_ctrl_ok:
        StrCpy $7 0
        mythos_trav_scan:
          StrCpy $4 $1 1 $7
          StrCmp $4 "" uninstall_vault_trav_ok
          StrCmp $4 ":" 0 mythos_trav_notcolon
          StrCmp $7 "1" mythos_trav_notcolon
          Goto uninstall_vault_read
          mythos_trav_notcolon:
          StrCmp $4 "\" mythos_trav_sepcheck
          StrCmp $4 "/" mythos_trav_sepcheck
          Goto mythos_trav_classify
          mythos_trav_sepcheck:
          IntOp $8 $7 + 1
          StrCpy $4 $1 1 $8
          StrCmp $4 "\" uninstall_vault_read
          StrCmp $4 "/" uninstall_vault_read
          StrCpy $4 $1 1 $7
          mythos_trav_classify:
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
          Goto mythos_canon_gate
        mythos_al_not_appdata:
        StrCpy $5 "$DOCUMENTS"
        StrLen $3 $5
        StrCpy $4 $1 $3
        StrCmp $4 $5 0 mythos_al_not_documents
          StrCmp $1 $5 uninstall_vault_read
          StrCpy $4 $1 1 $3
          StrCmp $4 "\" 0 mythos_al_not_documents
          StrCpy $6 $1 "" $3
          StrCpy $6 $6 "" 1
          StrCmp $6 "" uninstall_vault_read
          Goto mythos_canon_gate
        mythos_al_not_documents:
        StrCpy $5 "$DESKTOP"
        StrLen $3 $5
        StrCpy $4 $1 $3
        StrCmp $4 $5 0 mythos_al_not_desktop
          StrCmp $1 $5 uninstall_vault_read
          StrCpy $4 $1 1 $3
          StrCmp $4 "\" 0 mythos_al_not_desktop
          StrCpy $6 $1 "" $3
          StrCpy $6 $6 "" 1
          StrCmp $6 "" uninstall_vault_read
          Goto mythos_canon_gate
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
          Goto mythos_canon_gate
        mythos_al_deny:
        Goto uninstall_vault_read
        mythos_canon_gate:
          System::Call "kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4"
          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
          System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4"
          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
          StrLen $8 $9
          StrCpy $6 $3 $8
          StrCmp $6 $9 0 uninstall_vault_read
          StrCpy $6 $3 1 $8
          StrCmp $6 "\" 0 uninstall_vault_read
          StrCpy $6 $3 "" $8
          StrCpy $6 $6 "" 1
          StrCmp $6 "" uninstall_vault_read
          Goto uninstall_vault_do_delete
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
