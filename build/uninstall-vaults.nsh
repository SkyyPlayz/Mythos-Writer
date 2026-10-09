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
  !insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\Mythos Writer\vault-index-cache" idx
  !insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\Mythos Writer\note-thumb-cache" thumb
!macroend

; Remove all — user settings/content (sidecar deleted after FileClose, not here).
!macro mythos_delete_remove_all_user_data
  Delete "$APPDATA\Mythos Writer\app-settings.json"
  Delete "$APPDATA\Mythos Writer\vault-settings.json"
  Delete "$APPDATA\Mythos Writer\brainstorm-settings.json"
  Delete "$APPDATA\Mythos Writer\secrets.json"
  !insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\Mythos Writer\templates" tmpl
  !insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\Mythos Writer\agent-personas" pers
!macroend

!macro customUnInstall
  SetShellVarContext current
  ${IfNot} ${isUpdated}
    ${If} ${SectionIsSelected} ${SEC_DELETE_MYTHOS_VAULTS}
      ClearErrors
      FileOpen $0 "$APPDATA\Mythos Writer\uninstall-delete-paths.txt" r
      IfErrors uninstall_vault_fallback
        uninstall_vault_read: ClearErrors
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
        System::Alloc 80
        Pop $6
        System::Call "*$6(&i2 1,&i2 2,&i2 3,&i2 4,&i2 5,&i2 6,&i2 7,&i2 8,&i2 9,&i2 10,&i2 11,&i2 12,&i2 13,&i2 14,&i2 15,&i2 16,&i2 17,&i2 18,&i2 19,&i2 20,&i2 21,&i2 22,&i2 23,&i2 24,&i2 25,&i2 26,&i2 27,&i2 28,&i2 29,&i2 30,&i2 31,&i2 42,&i2 63,&i2 60,&i2 62,&i2 34,&i2 124,&i2 0)"
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
        System::Call "kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        System::Call "kernel32::GetLongPathNameW(w r3, w .r2, i ${NSIS_MAX_STRLEN}) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        StrCpy $3 $2
        StrCmp $3 "" uninstall_vault_read
        StrCpy $2 "ct1"
        Goto mythos_comp_tail_scan
        mythos_comp_tail_ret1:
        StrCpy $5 "$WINDIR"
        System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        System::Call "kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        StrCpy $5 $2
        StrCmp $5 "" uninstall_vault_read
        StrCpy $2 "5w"
        Goto mythos_comp_tail_scan
        mythos_comp_tail_ret5w:
        StrLen $8 $5
        StrCpy $4 $3 $8
        StrCmp $4 $5 uninstall_vault_read 0
        StrCpy $5 "$PROGRAMFILES"
        System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        System::Call "kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        StrCpy $5 $2
        StrCmp $5 "" uninstall_vault_read
        StrCpy $2 "5p"
        Goto mythos_comp_tail_scan
        mythos_comp_tail_ret5p:
        StrLen $8 $5
        StrCpy $4 $3 $8
        StrCmp $4 $5 uninstall_vault_read 0
        StrCpy $5 "$PROGRAMFILES64"
        System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        System::Call "kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        StrCpy $5 $2
        StrCmp $5 "" uninstall_vault_read
        StrCpy $2 "5x"
        Goto mythos_comp_tail_scan
        mythos_comp_tail_ret5x:
        StrLen $8 $5
        StrCpy $4 $3 $8
        StrCmp $4 $5 uninstall_vault_read 0
        StrCpy $5 "$APPDATA\Mythos Writer"
        System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        System::Call "kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e"
        Pop $8
        IntCmp $4 0 +5 0 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        StrCpy $5 $2
        StrCmp $5 "" mythos_al_not_appdata
        Goto mythos_glp_h3_5a
        IntCmp $8 2 +3 0 0
        IntCmp $8 3 +2 0 0
        Goto mythos_al_not_appdata
        StrCmp $5 "" mythos_al_not_appdata
        mythos_glp_h3_5a:
        StrCpy $2 "5a"
        Goto mythos_comp_tail_scan
        mythos_comp_tail_ret5a:
        StrLen $8 $5
        StrCpy $4 $3 $8
        StrCmp $4 $5 0 mythos_al_not_appdata
          StrCmp $3 $5 uninstall_vault_read
          StrCpy $4 $3 1 $8
          StrCmp $4 "\" 0 mythos_al_not_appdata
          StrCpy $6 $3 "" $8
          StrCpy $6 $6 "" 1
          StrCmp $6 "" uninstall_vault_read
          Goto mythos_canon_gate
        mythos_al_not_appdata:
        StrCpy $5 "$DOCUMENTS"
        System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        System::Call "kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e"
        Pop $8
        IntCmp $4 0 +5 0 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        StrCpy $5 $2
        StrCmp $5 "" mythos_al_not_documents
        Goto mythos_glp_h3_5d
        IntCmp $8 2 +3 0 0
        IntCmp $8 3 +2 0 0
        Goto mythos_al_not_documents
        StrCmp $5 "" mythos_al_not_documents
        mythos_glp_h3_5d:
        StrCpy $2 "5d"
        Goto mythos_comp_tail_scan
        mythos_comp_tail_ret5d:
        StrLen $8 $5
        StrCpy $4 $3 $8
        StrCmp $4 $5 0 mythos_al_not_documents
          StrCmp $3 $5 uninstall_vault_read
          StrCpy $4 $3 1 $8
          StrCmp $4 "\" 0 mythos_al_not_documents
          StrCpy $6 $3 "" $8
          StrCpy $6 $6 "" 1
          StrCmp $6 "" uninstall_vault_read
          Goto mythos_canon_gate
        mythos_al_not_documents:
        StrCpy $5 "$DESKTOP"
        System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        System::Call "kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e"
        Pop $8
        IntCmp $4 0 +5 0 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        StrCpy $5 $2
        StrCmp $5 "" mythos_al_not_desktop
        Goto mythos_glp_h3_5k
        IntCmp $8 2 +3 0 0
        IntCmp $8 3 +2 0 0
        Goto mythos_al_not_desktop
        StrCmp $5 "" mythos_al_not_desktop
        mythos_glp_h3_5k:
        StrCpy $2 "5k"
        Goto mythos_comp_tail_scan
        mythos_comp_tail_ret5k:
        StrLen $8 $5
        StrCpy $4 $3 $8
        StrCmp $4 $5 0 mythos_al_not_desktop
          StrCmp $3 $5 uninstall_vault_read
          StrCpy $4 $3 1 $8
          StrCmp $4 "\" 0 mythos_al_not_desktop
          StrCpy $6 $3 "" $8
          StrCpy $6 $6 "" 1
          StrCmp $6 "" uninstall_vault_read
          Goto mythos_canon_gate
        mythos_al_not_desktop:
        StrCpy $5 "$PROFILE\Downloads"
        System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4"
        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        System::Call "kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e"
        Pop $8
        IntCmp $4 0 +5 0 0
        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
        StrCpy $5 $2
        StrCmp $5 "" mythos_al_deny
        Goto mythos_glp_h3_5l
        IntCmp $8 2 +3 0 0
        IntCmp $8 3 +2 0 0
        Goto mythos_al_deny
        StrCmp $5 "" mythos_al_deny
        mythos_glp_h3_5l:
        StrCpy $2 "5l"
        Goto mythos_comp_tail_scan
        mythos_comp_tail_ret5l:
        StrLen $8 $5
        StrCpy $4 $3 $8
        StrCmp $4 $5 0 mythos_al_deny
          StrCmp $3 $5 uninstall_vault_read
          StrCpy $4 $3 1 $8
          StrCmp $4 "\" 0 mythos_al_deny
          StrCpy $6 $3 "" $8
          StrCpy $6 $6 "" 1
          StrCmp $6 "" uninstall_vault_read
          Goto mythos_canon_gate
        mythos_al_deny:
        Goto uninstall_vault_read
        mythos_canon_gate:
          System::Call "kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4"
          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
          System::Call "kernel32::GetLongPathNameW(w r3, w .r2, i ${NSIS_MAX_STRLEN}) i .r4"
          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
          StrCpy $3 $2
          StrCmp $3 "" uninstall_vault_read
          StrCpy $2 "ct2"
          Goto mythos_comp_tail_scan
          mythos_comp_tail_ret2:
          System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4"
          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
          System::Call "kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4"
          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
          StrCpy $9 $2
          StrCmp $9 "" uninstall_vault_read
          StrCpy $2 "9c"
          Goto mythos_comp_tail_scan
          mythos_comp_tail_ret9c:
          StrLen $8 $9
          StrCpy $6 $3 $8
          StrCmp $6 $9 0 uninstall_vault_read
          StrCpy $6 $3 1 $8
          StrCmp $6 "\" 0 uninstall_vault_read
          StrCpy $6 $3 "" $8
          StrCpy $6 $6 "" 1
          StrCmp $6 "" uninstall_vault_read
          Goto mythos_nested_root_guard
        mythos_nested_root_guard:
          StrCpy $7 $9
          mythos_nr_strip:
            StrCpy $6 $3 1 -1
            StrCmp $6 "\" 0 mythos_nr_appdata
            StrLen $8 $3
            IntCmp $8 3 mythos_nr_appdata mythos_nr_appdata 0
            StrCpy $3 $3 -1
            Goto mythos_nr_strip
          mythos_nr_appdata:
            StrCpy $5 "$APPDATA\Mythos Writer"
            System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4"
            IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
            System::Call "kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e"
            Pop $8
            IntCmp $4 0 +5 0 0
            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
            StrCpy $9 $2
            StrCmp $9 "" mythos_nr_documents
            Goto mythos_glp_h3_9a
            IntCmp $8 2 +3 0 0
            IntCmp $8 3 +2 0 0
            Goto uninstall_vault_read
            StrCmp $9 "" mythos_nr_documents
            mythos_glp_h3_9a:
            StrCpy $2 "9a"
            Goto mythos_comp_tail_scan
            mythos_comp_tail_ret9a:
            StrCmp $3 $9 uninstall_vault_read
            StrLen $8 $3
            StrCpy $6 $9 $8
            StrCmp $6 $3 0 mythos_nr_documents
            StrCpy $6 $9 1 $8
            StrCmp $6 "\" uninstall_vault_read
          mythos_nr_documents:
            StrCpy $5 "$DOCUMENTS"
            System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4"
            IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
            System::Call "kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e"
            Pop $8
            IntCmp $4 0 +5 0 0
            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
            StrCpy $9 $2
            StrCmp $9 "" mythos_nr_desktop
            Goto mythos_glp_h3_9d
            IntCmp $8 2 +3 0 0
            IntCmp $8 3 +2 0 0
            Goto uninstall_vault_read
            StrCmp $9 "" mythos_nr_desktop
            mythos_glp_h3_9d:
            StrCpy $2 "9d"
            Goto mythos_comp_tail_scan
            mythos_comp_tail_ret9d:
            StrCmp $3 $9 uninstall_vault_read
            StrLen $8 $3
            StrCpy $6 $9 $8
            StrCmp $6 $3 0 mythos_nr_desktop
            StrCpy $6 $9 1 $8
            StrCmp $6 "\" uninstall_vault_read
          mythos_nr_desktop:
            StrCpy $5 "$DESKTOP"
            System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4"
            IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
            System::Call "kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e"
            Pop $8
            IntCmp $4 0 +5 0 0
            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
            StrCpy $9 $2
            StrCmp $9 "" mythos_nr_downloads
            Goto mythos_glp_h3_9k
            IntCmp $8 2 +3 0 0
            IntCmp $8 3 +2 0 0
            Goto uninstall_vault_read
            StrCmp $9 "" mythos_nr_downloads
            mythos_glp_h3_9k:
            StrCpy $2 "9k"
            Goto mythos_comp_tail_scan
            mythos_comp_tail_ret9k:
            StrCmp $3 $9 uninstall_vault_read
            StrLen $8 $3
            StrCpy $6 $9 $8
            StrCmp $6 $3 0 mythos_nr_downloads
            StrCpy $6 $9 1 $8
            StrCmp $6 "\" uninstall_vault_read
          mythos_nr_downloads:
            StrCpy $5 "$PROFILE\Downloads"
            System::Call "kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4"
            IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0
            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
            System::Call "kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e"
            Pop $8
            IntCmp $4 0 +5 0 0
            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read
            StrCpy $9 $2
            StrCmp $9 "" mythos_nr_ok
            Goto mythos_glp_h3_9l
            IntCmp $8 2 +3 0 0
            IntCmp $8 3 +2 0 0
            Goto uninstall_vault_read
            StrCmp $9 "" mythos_nr_ok
            mythos_glp_h3_9l:
            StrCpy $2 "9l"
            Goto mythos_comp_tail_scan
            mythos_comp_tail_ret9l:
            StrCmp $3 $9 uninstall_vault_read
            StrLen $8 $3
            StrCpy $6 $9 $8
            StrCmp $6 $3 0 mythos_nr_ok
            StrCpy $6 $9 1 $8
            StrCmp $6 "\" uninstall_vault_read
          mythos_nr_ok: StrCpy $1 $9
            StrCpy $9 $7
            Goto mythos_reparse_walk
        mythos_reparse_walk:
          StrLen $8 $9
          IntOp $7 $8 + 1
        mythos_reparse_next:
          StrCpy $6 $3 1 $7
          StrCmp $6 "" mythos_reparse_leaf
          StrCmp $6 "\" mythos_reparse_hit
          IntOp $7 $7 + 1
          Goto mythos_reparse_next
        mythos_reparse_hit:
          StrCpy $6 $3 $7
          System::Call "kernel32::GetFileAttributesW(w r6) i .r4"
          StrCmp $4 "error" uninstall_vault_read
          IntOp $4 $4 & 0x400
          IntCmp $4 0 0 uninstall_vault_read uninstall_vault_read
          IntOp $7 $7 + 1
          Goto mythos_reparse_next
        mythos_reparse_leaf:
          System::Call "kernel32::GetFileAttributesW(w r3) i .r4"
          StrCmp $4 "error" uninstall_vault_read
          IntOp $4 $4 & 0x400
          IntCmp $4 0 0 uninstall_vault_read uninstall_vault_read
          Goto uninstall_vault_do_delete
        uninstall_vault_do_delete:
          StrCpy $7 0
        mythos_canon_slash:
          StrCpy $6 $3 1 $7
          StrCmp $6 "" mythos_canon_slash_ok
          StrCmp $6 "/" uninstall_vault_read
          IntOp $7 $7 + 1
          Goto mythos_canon_slash
        mythos_canon_slash_ok:
        IfFileExists "$3\*.*" 0 uninstall_vault_file
          RMDir /r "$3"
          Goto uninstall_vault_read
        uninstall_vault_file:
          Delete "$3"
          Goto uninstall_vault_read
        mythos_comp_tail_scan: StrCpy $4 $2 1
          StrCpy $6 $3
          StrCmp $4 "5" 0 +2
          StrCpy $6 $5
          StrCmp $4 "9" 0 +2
          StrCpy $6 $9
          StrCpy $7 0
        mythos_comp_tail_loop: StrCpy $4 $6 1 $7
          StrCmp $4 "" mythos_comp_tail_end
          StrCmp $4 "\" 0 mythos_comp_tail_inc
          IntCmp $7 0 mythos_comp_tail_inc
          IntOp $8 $7 - 1
          StrCpy $4 $6 1 $8
          StrCmp $4 " " uninstall_vault_read
          StrCmp $4 "." uninstall_vault_read
          StrCmp $4 "$\t" uninstall_vault_read
        mythos_comp_tail_inc: IntOp $7 $7 + 1
          Goto mythos_comp_tail_loop
        mythos_comp_tail_end: IntCmp $7 0 mythos_comp_tail_ret
          IntOp $8 $7 - 1
          StrCpy $4 $6 1 $8
          StrCmp $4 " " uninstall_vault_read
          StrCmp $4 "." uninstall_vault_read
          StrCmp $4 "$\t" uninstall_vault_read
        mythos_comp_tail_ret: StrCmp $2 "ct1" mythos_comp_tail_ret1
          StrCmp $2 "ct2" mythos_comp_tail_ret2
          StrCmp $2 "5w" mythos_comp_tail_ret5w
          StrCmp $2 "5p" mythos_comp_tail_ret5p
          StrCmp $2 "5x" mythos_comp_tail_ret5x
          StrCmp $2 "5a" mythos_comp_tail_ret5a
          StrCmp $2 "5d" mythos_comp_tail_ret5d
          StrCmp $2 "5k" mythos_comp_tail_ret5k
          StrCmp $2 "5l" mythos_comp_tail_ret5l
          StrCmp $2 "9c" mythos_comp_tail_ret9c
          StrCmp $2 "9a" mythos_comp_tail_ret9a
          StrCmp $2 "9d" mythos_comp_tail_ret9d
          StrCmp $2 "9k" mythos_comp_tail_ret9k
          Goto mythos_comp_tail_ret9l
      uninstall_vault_close:
        FileClose $0
        Delete "$APPDATA\Mythos Writer\uninstall-delete-paths.txt"
      uninstall_vault_fallback:
        !insertmacro mythos_delete_remove_all_user_data
        !insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\Mythos Writer\vaults" vaults
        !insertmacro mythos_rmdir_unless_reparse "$APPDATA" "$APPDATA\Mythos Writer" appdata
    ${Else}
      !insertmacro mythos_delete_app_caches
    ${EndIf}
  ${EndIf}
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
!macroend

; RF-7b: RMDir /r follows junctions (NSIS ≤3.13). Initialise $7 (leftover is the
; last sidecar-line length). Walk every prefix down to _path; skip on
; FILE_ATTRIBUTE_REPARSE_POINT (0x400) or a failed GetFileAttributesW.
; Defined after customUnInstall so the :43–:213 guard-region line numbers stay put;
; !insertmacro expands when customUnInstall is inserted, after this definition.
!macro mythos_rmdir_unless_reparse _root _path _uid
  Push $3
  Push $4
  Push $6
  Push $7
  Push $8
  Push $9
  StrCpy $3 "${_path}"
  StrCpy $9 "${_root}"
  System::Call "kernel32::GetFullPathNameW(w r3, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4"
  IntCmp $4 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid} 0
  IntCmp $4 ${NSIS_MAX_STRLEN} mythos_rpr_done_${_uid} 0 mythos_rpr_done_${_uid}
  System::Call "kernel32::GetFullPathNameW(w r9, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4"
  IntCmp $4 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid} 0
  IntCmp $4 ${NSIS_MAX_STRLEN} mythos_rpr_done_${_uid} 0 mythos_rpr_done_${_uid}
  StrLen $8 $9
  StrCpy $6 $3 $8
  StrCmp $6 $9 0 mythos_rpr_done_${_uid}
  StrCpy $6 $3 1 $8
  StrCmp $6 "\" 0 mythos_rpr_done_${_uid}
  IntOp $7 $8 + 1
  mythos_rpr_walk_${_uid}:
    StrCpy $6 $3 1 $7
    StrCmp $6 "" mythos_rpr_leaf_${_uid}
    StrCmp $6 "\" mythos_rpr_hit_${_uid}
    IntOp $7 $7 + 1
    Goto mythos_rpr_walk_${_uid}
  mythos_rpr_hit_${_uid}:
    StrCpy $6 $3 $7
    System::Call "kernel32::GetFileAttributesW(w r6) i .r4"
    StrCmp $4 "error" mythos_rpr_done_${_uid}
    IntOp $4 $4 & 0x400
    IntCmp $4 0 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid}
    IntOp $7 $7 + 1
    Goto mythos_rpr_walk_${_uid}
  mythos_rpr_leaf_${_uid}:
    System::Call "kernel32::GetFileAttributesW(w r3) i .r4"
    StrCmp $4 "error" mythos_rpr_done_${_uid}
    IntOp $4 $4 & 0x400
    IntCmp $4 0 0 mythos_rpr_done_${_uid} mythos_rpr_done_${_uid}
    RMDir /r "$3"
  mythos_rpr_done_${_uid}:
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $4
  Pop $3
!macroend
