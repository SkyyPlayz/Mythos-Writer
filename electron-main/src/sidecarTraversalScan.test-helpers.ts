/**
 * Vitest-only: behavioural model of mythos_trav_scan + WINDIR/PROGRAMFILES denies in uninstall-vaults.nsh.
 */

import { createHash } from 'node:crypto';

import {
  assertSidecarFcfbOracleRows,
  assertSidecarLinearStepCapSelfCheck,
  assertSidecarUnifiedVmStepLimitIsFatal,
  FILE_ATTRIBUTE_DIRECTORY,
  FILE_ATTRIBUTE_HIDDEN,
  FILE_ATTRIBUTE_READONLY,
  FILE_ATTRIBUTE_SYSTEM,
  runSidecarNsisProgram,
  SIDECAR_LINE_STEP_LIMIT_ERROR,
  SIDECAR_NSIS_ENV_E1,
  type SidecarNsisRunOptions,
} from './sidecarNsisVm.test-helpers.js';

export const TRAVERSAL_SCAN_BLOCK_END_MARKER = 'uninstall_vault_trav_ok:';
export const TRAVERSAL_SCAN_BLOCK_PREP_LINE = '        StrCpy $7 0';
export const TRAVERSAL_SCAN_BLOCK_SCAN_LABEL = 'mythos_trav_scan:';

/**
 * Exact sidecar guard region, file :43 (`uninstall_vault_read: ClearErrors`) .. the unique
 * `Goto uninstall_vault_read` end marker: RF-6 read-trim + control-char / wildcard reject,
 * traversal, deny prefixes, root guards, GetFullPathNameW gate, HARD-2 nested-root guard,
 * RF-7b top-down reparse walk, leftover-`/` scan on `$3`, do_delete, and the H3 component-tail
 * scan. Generated from build/uninstall-vaults.nsh; the pin is exact.
 */
export const CANONICAL_SIDECAR_GUARD_REGION: readonly string[] = [
  "        uninstall_vault_read: ClearErrors",
  "        FileRead $0 $1",
  "        IfErrors uninstall_vault_close",
  "        mythos_trim_loop:",
  "          StrCmp $1 \"\" uninstall_vault_read",
  "          StrCpy $2 $1 1 -1",
  "          StrCmp $2 \"$\\n\" mythos_trim_chop",
  "          StrCmp $2 \"$\\r\" mythos_trim_chop",
  "          Goto mythos_trim_done",
  "          mythos_trim_chop:",
  "          StrCpy $1 $1 -1",
  "          Goto mythos_trim_loop",
  "        mythos_trim_done:",
  "        StrCmp $1 \"\" uninstall_vault_read",
  "        System::Alloc 80",
  "        Pop $6",
  "        System::Call \"*$6(&i2 1,&i2 2,&i2 3,&i2 4,&i2 5,&i2 6,&i2 7,&i2 8,&i2 9,&i2 10,&i2 11,&i2 12,&i2 13,&i2 14,&i2 15,&i2 16,&i2 17,&i2 18,&i2 19,&i2 20,&i2 21,&i2 22,&i2 23,&i2 24,&i2 25,&i2 26,&i2 27,&i2 28,&i2 29,&i2 30,&i2 31,&i2 42,&i2 63,&i2 60,&i2 62,&i2 34,&i2 124,&i2 0)\"",
  "        System::Call \"shlwapi::StrPBrkW(w r1, p r6) p .r4\"",
  "        System::Free $6",
  "        StrCmp $4 0 mythos_ctrl_ok",
  "          Goto uninstall_vault_read",
  "        mythos_ctrl_ok:",
  "        StrCpy $7 0",
  "        mythos_trav_scan:",
  "          StrCpy $4 $1 1 $7",
  "          StrCmp $4 \"\" uninstall_vault_trav_ok",
  "          StrCmp $4 \":\" 0 mythos_trav_notcolon",
  "          StrCmp $7 \"1\" mythos_trav_notcolon",
  "          Goto uninstall_vault_read",
  "          mythos_trav_notcolon:",
  "          StrCmp $4 \"\\\" mythos_trav_sepcheck",
  "          StrCmp $4 \"/\" mythos_trav_sepcheck",
  "          Goto mythos_trav_classify",
  "          mythos_trav_sepcheck:",
  "          IntOp $8 $7 + 1",
  "          StrCpy $4 $1 1 $8",
  "          StrCmp $4 \"\\\" uninstall_vault_read",
  "          StrCmp $4 \"/\" uninstall_vault_read",
  "          StrCpy $4 $1 1 $7",
  "          mythos_trav_classify:",
  "          StrCmp $4 \"\\\" 0 mythos_trav_fwd",
  "            StrCmp $7 \"0\" +5",
  "            IntOp $8 $7 - 1",
  "            StrCpy $4 $1 1 $8",
  "            StrCmp $4 \".\" uninstall_vault_read",
  "            StrCmp $4 \" \" uninstall_vault_read",
  "            StrCmp $4 \"$\\t\" uninstall_vault_read",
  "            IntOp $8 $7 + 1",
  "            StrCpy $4 $1 1 $8",
  "            StrCmp $4 \" \" uninstall_vault_read",
  "            StrCmp $4 \"$\\t\" uninstall_vault_read",
  "            StrCmp $4 \".\" 0 mythos_trav_inc",
  "              IntOp $8 $8 + 1",
  "              StrCpy $4 $1 1 $8",
  "              StrCmp $4 \"\" uninstall_vault_read",
  "              StrCmp $4 \"\\\" uninstall_vault_read",
  "              StrCmp $4 \"/\" uninstall_vault_read",
  "              StrCmp $4 \".\" 0 mythos_trav_inc",
  "                IntOp $8 $8 + 1",
  "                StrCpy $4 $1 1 $8",
  "                StrCmp $4 \"\" uninstall_vault_read",
  "                StrCmp $4 \"\\\" uninstall_vault_read",
  "                StrCmp $4 \"/\" uninstall_vault_read",
  "                Goto mythos_trav_inc",
  "          mythos_trav_fwd:",
  "          StrCmp $4 \"/\" 0 mythos_trav_inc",
  "            StrCmp $7 \"0\" +5",
  "            IntOp $8 $7 - 1",
  "            StrCpy $4 $1 1 $8",
  "            StrCmp $4 \".\" uninstall_vault_read",
  "            StrCmp $4 \" \" uninstall_vault_read",
  "            StrCmp $4 \"$\\t\" uninstall_vault_read",
  "            IntOp $8 $7 + 1",
  "            StrCpy $4 $1 1 $8",
  "            StrCmp $4 \"/\" uninstall_vault_read",
  "            StrCmp $4 \" \" uninstall_vault_read",
  "            StrCmp $4 \"$\\t\" uninstall_vault_read",
  "            StrCmp $4 \".\" 0 mythos_trav_inc",
  "              IntOp $8 $8 + 1",
  "              StrCpy $4 $1 1 $8",
  "              StrCmp $4 \"\" uninstall_vault_read",
  "              StrCmp $4 \"/\" uninstall_vault_read",
  "              StrCmp $4 \"\\\" uninstall_vault_read",
  "              StrCmp $4 \".\" 0 mythos_trav_inc",
  "                IntOp $8 $8 + 1",
  "                StrCpy $4 $1 1 $8",
  "                StrCmp $4 \"\" uninstall_vault_read",
  "                StrCmp $4 \"/\" uninstall_vault_read",
  "                StrCmp $4 \"\\\" uninstall_vault_read",
  "          mythos_trav_inc:",
  "          IntOp $7 $7 + 1",
  "          Goto mythos_trav_scan",
  "        uninstall_vault_trav_ok:",
  "        StrCpy $2 $1 1 -1",
  "        StrCmp $2 \".\" uninstall_vault_read",
  "        StrCmp $2 \" \" uninstall_vault_read",
  "        StrCmp $2 \"$\\t\" uninstall_vault_read",
  "        System::Call \"kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r3, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $3 $2",
  "        StrCmp $3 \"\" uninstall_vault_read",
  "        StrCpy $2 \"ct1\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret1:",
  "        StrCpy $5 \"$WINDIR\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" uninstall_vault_read",
  "        StrCpy $2 \"5w\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5w:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 uninstall_vault_read 0",
  "        StrCpy $5 \"$PROGRAMFILES\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" uninstall_vault_read",
  "        StrCpy $2 \"5p\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5p:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 uninstall_vault_read 0",
  "        StrCpy $5 \"$PROGRAMFILES64\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" uninstall_vault_read",
  "        StrCpy $2 \"5x\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5x:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 uninstall_vault_read 0",
  "        StrCpy $5 \"$APPDATA\\Mythos Writer\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e\"",
  "        Pop $8",
  "        IntCmp $4 0 +5 0 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" mythos_al_not_appdata",
  "        Goto mythos_glp_h3_5a",
  "        IntCmp $8 2 +3 0 0",
  "        IntCmp $8 3 +2 0 0",
  "        Goto mythos_al_not_appdata",
  "        Goto mythos_glp_fb_5a",
  "        mythos_glp_h3_5a:",
  "        StrCpy $2 \"5a\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5a:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 0 mythos_al_not_appdata",
  "          StrCmp $3 $5 uninstall_vault_read",
  "          StrCpy $4 $3 1 $8",
  "          StrCmp $4 \"\\\" 0 mythos_al_not_appdata",
  "          StrCpy $6 $3 \"\" $8",
  "          StrCpy $6 $6 \"\" 1",
  "          StrCmp $6 \"\" uninstall_vault_read",
  "          Goto mythos_canon_gate",
  "        mythos_al_not_appdata:",
  "        StrCpy $5 \"$DOCUMENTS\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e\"",
  "        Pop $8",
  "        IntCmp $4 0 +5 0 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" mythos_al_not_documents",
  "        Goto mythos_glp_h3_5d",
  "        IntCmp $8 2 +3 0 0",
  "        IntCmp $8 3 +2 0 0",
  "        Goto mythos_al_not_documents",
  "        Goto mythos_glp_fb_5d",
  "        mythos_glp_h3_5d:",
  "        StrCpy $2 \"5d\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5d:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 0 mythos_al_not_documents",
  "          StrCmp $3 $5 uninstall_vault_read",
  "          StrCpy $4 $3 1 $8",
  "          StrCmp $4 \"\\\" 0 mythos_al_not_documents",
  "          StrCpy $6 $3 \"\" $8",
  "          StrCpy $6 $6 \"\" 1",
  "          StrCmp $6 \"\" uninstall_vault_read",
  "          Goto mythos_canon_gate",
  "        mythos_al_not_documents:",
  "        StrCpy $5 \"$DESKTOP\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e\"",
  "        Pop $8",
  "        IntCmp $4 0 +5 0 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" mythos_al_not_desktop",
  "        Goto mythos_glp_h3_5k",
  "        IntCmp $8 2 +3 0 0",
  "        IntCmp $8 3 +2 0 0",
  "        Goto mythos_al_not_desktop",
  "        Goto mythos_glp_fb_5k",
  "        mythos_glp_h3_5k:",
  "        StrCpy $2 \"5k\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5k:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 0 mythos_al_not_desktop",
  "          StrCmp $3 $5 uninstall_vault_read",
  "          StrCpy $4 $3 1 $8",
  "          StrCmp $4 \"\\\" 0 mythos_al_not_desktop",
  "          StrCpy $6 $3 \"\" $8",
  "          StrCpy $6 $6 \"\" 1",
  "          StrCmp $6 \"\" uninstall_vault_read",
  "          Goto mythos_canon_gate",
  "        mythos_al_not_desktop:",
  "        StrCpy $5 \"$PROFILE\\Downloads\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e\"",
  "        Pop $8",
  "        IntCmp $4 0 +5 0 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" mythos_al_deny",
  "        Goto mythos_glp_h3_5l",
  "        IntCmp $8 2 +3 0 0",
  "        IntCmp $8 3 +2 0 0",
  "        Goto mythos_al_deny",
  "        Goto mythos_glp_fb_5l",
  "        mythos_glp_h3_5l:",
  "        StrCpy $2 \"5l\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5l:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 0 mythos_al_deny",
  "          StrCmp $3 $5 uninstall_vault_read",
  "          StrCpy $4 $3 1 $8",
  "          StrCmp $4 \"\\\" 0 mythos_al_deny",
  "          StrCpy $6 $3 \"\" $8",
  "          StrCpy $6 $6 \"\" 1",
  "          StrCmp $6 \"\" uninstall_vault_read",
  "          Goto mythos_canon_gate",
  "        mythos_al_deny:",
  "        Goto uninstall_vault_read",
  "        mythos_canon_gate:",
  "          System::Call \"kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4\"",
  "          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "          System::Call \"kernel32::GetLongPathNameW(w r3, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "          StrCpy $3 $2",
  "          StrCmp $3 \"\" uninstall_vault_read",
  "          StrCpy $2 \"ct2\"",
  "          Goto mythos_comp_tail_scan",
  "          mythos_comp_tail_ret2:",
  "          System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4\"",
  "          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "          System::Call \"kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "          IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "          IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "          StrCpy $9 $2",
  "          StrCmp $9 \"\" uninstall_vault_read",
  "          StrCpy $2 \"9c\"",
  "          Goto mythos_comp_tail_scan",
  "          mythos_comp_tail_ret9c:",
  "          StrLen $8 $9",
  "          StrCpy $6 $3 $8",
  "          StrCmp $6 $9 0 uninstall_vault_read",
  "          StrCpy $6 $3 1 $8",
  "          StrCmp $6 \"\\\" 0 uninstall_vault_read",
  "          StrCpy $6 $3 \"\" $8",
  "          StrCpy $6 $6 \"\" 1",
  "          StrCmp $6 \"\" uninstall_vault_read",
  "          Goto mythos_nested_root_guard",
  "        mythos_nested_root_guard:",
  "          StrCpy $1 $9",
  "          mythos_nr_strip:",
  "            StrCpy $6 $3 1 -1",
  "            StrCmp $6 \"\\\" 0 mythos_nr_appdata",
  "            StrLen $8 $3",
  "            IntCmp $8 3 mythos_nr_appdata mythos_nr_appdata 0",
  "            StrCpy $3 $3 -1",
  "            Goto mythos_nr_strip",
  "          mythos_nr_appdata:",
  "            StrCpy $5 \"$APPDATA\\Mythos Writer\"",
  "            System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4\"",
  "            IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "            System::Call \"kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e\"",
  "            Pop $8",
  "            IntCmp $4 0 +5 0 0",
  "            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "            StrCpy $9 $2",
  "            StrCmp $9 \"\" mythos_nr_documents",
  "            Goto mythos_glp_h3_9a",
  "            IntCmp $8 2 +3 0 0",
  "            IntCmp $8 3 +2 0 0",
  "            Goto uninstall_vault_read",
  "            Goto mythos_glp_fb_9a",
  "            mythos_glp_h3_9a:",
  "            StrCpy $2 \"9a\"",
  "            Goto mythos_comp_tail_scan",
  "            mythos_comp_tail_ret9a:",
  "            StrCmp $3 $9 uninstall_vault_read",
  "            StrLen $8 $3",
  "            StrCpy $6 $9 $8",
  "            StrCmp $6 $3 0 mythos_nr_documents",
  "            StrCpy $6 $9 1 $8",
  "            StrCmp $6 \"\\\" uninstall_vault_read",
  "          mythos_nr_documents:",
  "            StrCpy $5 \"$DOCUMENTS\"",
  "            System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4\"",
  "            IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "            System::Call \"kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e\"",
  "            Pop $8",
  "            IntCmp $4 0 +5 0 0",
  "            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "            StrCpy $9 $2",
  "            StrCmp $9 \"\" mythos_nr_desktop",
  "            Goto mythos_glp_h3_9d",
  "            IntCmp $8 2 +3 0 0",
  "            IntCmp $8 3 +2 0 0",
  "            Goto uninstall_vault_read",
  "            Goto mythos_glp_fb_9d",
  "            mythos_glp_h3_9d:",
  "            StrCpy $2 \"9d\"",
  "            Goto mythos_comp_tail_scan",
  "            mythos_comp_tail_ret9d:",
  "            StrCmp $3 $9 uninstall_vault_read",
  "            StrLen $8 $3",
  "            StrCpy $6 $9 $8",
  "            StrCmp $6 $3 0 mythos_nr_desktop",
  "            StrCpy $6 $9 1 $8",
  "            StrCmp $6 \"\\\" uninstall_vault_read",
  "          mythos_nr_desktop:",
  "            StrCpy $5 \"$DESKTOP\"",
  "            System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4\"",
  "            IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "            System::Call \"kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e\"",
  "            Pop $8",
  "            IntCmp $4 0 +5 0 0",
  "            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "            StrCpy $9 $2",
  "            StrCmp $9 \"\" mythos_nr_downloads",
  "            Goto mythos_glp_h3_9k",
  "            IntCmp $8 2 +3 0 0",
  "            IntCmp $8 3 +2 0 0",
  "            Goto uninstall_vault_read",
  "            Goto mythos_glp_fb_9k",
  "            mythos_glp_h3_9k:",
  "            StrCpy $2 \"9k\"",
  "            Goto mythos_comp_tail_scan",
  "            mythos_comp_tail_ret9k:",
  "            StrCmp $3 $9 uninstall_vault_read",
  "            StrLen $8 $3",
  "            StrCpy $6 $9 $8",
  "            StrCmp $6 $3 0 mythos_nr_downloads",
  "            StrCpy $6 $9 1 $8",
  "            StrCmp $6 \"\\\" uninstall_vault_read",
  "          mythos_nr_downloads:",
  "            StrCpy $5 \"$PROFILE\\Downloads\"",
  "            System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r9, p 0) i .r4\"",
  "            IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "            System::Call \"kernel32::GetLongPathNameW(w r9, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e\"",
  "            Pop $8",
  "            IntCmp $4 0 +5 0 0",
  "            IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "            StrCpy $9 $2",
  "            StrCmp $9 \"\" mythos_nr_ok",
  "            Goto mythos_glp_h3_9l",
  "            IntCmp $8 2 +3 0 0",
  "            IntCmp $8 3 +2 0 0",
  "            Goto uninstall_vault_read",
  "            Goto mythos_glp_fb_9l",
  "            mythos_glp_h3_9l:",
  "            StrCpy $2 \"9l\"",
  "            Goto mythos_comp_tail_scan",
  "            mythos_comp_tail_ret9l:",
  "            StrCmp $3 $9 uninstall_vault_read",
  "            StrLen $8 $3",
  "            StrCpy $6 $9 $8",
  "            StrCmp $6 $3 0 mythos_nr_ok",
  "            StrCpy $6 $9 1 $8",
  "            StrCmp $6 \"\\\" uninstall_vault_read",
  "          mythos_nr_ok:",
  "            StrCpy $9 $1",
  "            Goto mythos_reparse_walk",
  "        mythos_reparse_walk:",
  "          StrLen $8 $9",
  "          IntOp $7 $8 + 1",
  "        mythos_reparse_next:",
  "          StrCpy $6 $3 1 $7",
  "          StrCmp $6 \"\" mythos_reparse_leaf",
  "          StrCmp $6 \"\\\" mythos_reparse_hit",
  "          IntOp $7 $7 + 1",
  "          Goto mythos_reparse_next",
  "        mythos_reparse_hit:",
  "          StrCpy $6 $3 $7",
  "          System::Call \"kernel32::GetFileAttributesW(w r6) i .r4\"",
  "          StrCmp $4 \"error\" uninstall_vault_read",
  "          IntOp $4 $4 & 0x400",
  "          IntCmp $4 0 0 uninstall_vault_read uninstall_vault_read",
  "          IntOp $7 $7 + 1",
  "          Goto mythos_reparse_next",
  "        mythos_reparse_leaf:",
  "          System::Call \"kernel32::GetFileAttributesW(w r3) i .r4\"",
  "          StrCmp $4 \"error\" uninstall_vault_read",
  "          IntOp $4 $4 & 0x400",
  "          IntCmp $4 0 0 uninstall_vault_read uninstall_vault_read",
  "          Goto uninstall_vault_do_delete",
  "        uninstall_vault_do_delete:",
  "          StrCpy $7 0",
  "        mythos_canon_slash:",
  "          StrCpy $6 $3 1 $7",
  "          StrCmp $6 \"\" mythos_canon_slash_ok",
  "          StrCmp $6 \"/\" uninstall_vault_read",
  "          IntOp $7 $7 + 1",
  "          Goto mythos_canon_slash",
  "        mythos_canon_slash_ok:",
  "        IfFileExists \"$3\\*.*\" 0 uninstall_vault_file",
  "          RMDir /r \"$3\"",
  "          Goto uninstall_vault_read",
  "        uninstall_vault_file:",
  "          Delete \"$3\"",
  "          Goto uninstall_vault_read",
  "        mythos_comp_tail_scan: StrCpy $4 $2 1",
  "          StrCpy $6 $3",
  "          StrCmp $4 \"5\" 0 +2",
  "          StrCpy $6 $5",
  "          StrCmp $4 \"9\" 0 +2",
  "          StrCpy $6 $9",
  "          StrCpy $7 0",
  "        mythos_comp_tail_loop: StrCpy $4 $6 1 $7",
  "          StrCmp $4 \"\" mythos_comp_tail_end",
  "          StrCmp $4 \"\\\" 0 mythos_comp_tail_inc",
  "          IntCmp $7 0 mythos_comp_tail_inc",
  "          IntOp $8 $7 - 1",
  "          StrCpy $4 $6 1 $8",
  "          StrCmp $4 \" \" uninstall_vault_read",
  "          StrCmp $4 \".\" uninstall_vault_read",
  "          StrCmp $4 \"$\\t\" uninstall_vault_read",
  "        mythos_comp_tail_inc: IntOp $7 $7 + 1",
  "          Goto mythos_comp_tail_loop",
  "        mythos_comp_tail_end: IntCmp $7 0 mythos_comp_tail_ret",
  "          IntOp $8 $7 - 1",
  "          StrCpy $4 $6 1 $8",
  "          StrCmp $4 \" \" uninstall_vault_read",
  "          StrCmp $4 \".\" uninstall_vault_read",
  "          StrCmp $4 \"$\\t\" uninstall_vault_read",
  "        mythos_comp_tail_ret: StrCmp $2 \"ct1\" mythos_comp_tail_ret1",
  "          StrCmp $2 \"ct2\" mythos_comp_tail_ret2",
  "          StrCmp $2 \"5w\" mythos_comp_tail_ret5w",
  "          StrCmp $2 \"5p\" mythos_comp_tail_ret5p",
  "          StrCmp $2 \"5x\" mythos_comp_tail_ret5x",
  "          StrCmp $2 \"5a\" mythos_comp_tail_ret5a",
  "          StrCmp $2 \"5d\" mythos_comp_tail_ret5d",
  "          StrCmp $2 \"5k\" mythos_comp_tail_ret5k",
  "          StrCmp $2 \"5l\" mythos_comp_tail_ret5l",
  "          StrCmp $2 \"9c\" mythos_comp_tail_ret9c",
  "          StrCmp $2 \"9a\" mythos_comp_tail_ret9a",
  "          StrCmp $2 \"9d\" mythos_comp_tail_ret9d",
  "          StrCmp $2 \"9k\" mythos_comp_tail_ret9k",
  "          StrCmp $2 \"9l\" mythos_comp_tail_ret9l",
  "          Goto uninstall_vault_read",
];

/** APPDATA Mythos Writer prefix + root self-match (first allowlist root, M5). */
export const CANONICAL_APPDATA_M5_GUARD_BLOCK: readonly string[] = [
  "        StrCpy $5 \"$APPDATA\\Mythos Writer\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4 ?e\"",
  "        Pop $8",
  "        IntCmp $4 0 +5 0 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" mythos_al_not_appdata",
  "        Goto mythos_glp_h3_5a",
  "        IntCmp $8 2 +3 0 0",
  "        IntCmp $8 3 +2 0 0",
  "        Goto mythos_al_not_appdata",
  "        Goto mythos_glp_fb_5a",
  "        mythos_glp_h3_5a:",
  "        StrCpy $2 \"5a\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5a:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 0 mythos_al_not_appdata",
  "          StrCmp $3 $5 uninstall_vault_read",
];

/** FileRead + RF-6 CR/LF trim loop + empty check + control-char reject (file :43–:64). */
export const CANONICAL_READ_TRIM_BLOCK: readonly string[] = CANONICAL_SIDECAR_GUARD_REGION.slice(
  0,
  CANONICAL_SIDECAR_GUARD_REGION.findIndex((l) => l === TRAVERSAL_SCAN_BLOCK_PREP_LINE),
);

export const CANONICAL_READ_TRIM_BLOCK_SHA256 = createHash('sha256')
  .update(CANONICAL_READ_TRIM_BLOCK.join('\n'))
  .digest('hex');

export const CANONICAL_SIDECAR_GUARD_REGION_SHA256 = createHash('sha256')
  .update(CANONICAL_SIDECAR_GUARD_REGION.join('\n'))
  .digest('hex');

function sliceCanonicalRegion(fromTrimmed: string, toTrimmedExclusive: string): readonly string[] {
  const from = CANONICAL_SIDECAR_GUARD_REGION.findIndex((l) => l.trim() === fromTrimmed);
  const to = CANONICAL_SIDECAR_GUARD_REGION.findIndex((l, i) => i > from && l.trim() === toTrimmedExclusive);
  if (from < 0 || to <= from) {
    throw new Error(`canonical region slice ${fromTrimmed}..${toTrimmedExclusive} missing`);
  }
  return CANONICAL_SIDECAR_GUARD_REGION.slice(from, to);
}

/** Exact sidecar traversal chain (StrCpy $7 0 … post-trav_ok segment tail guard). */
export const CANONICAL_TRAVERSAL_SCAN_BLOCK: readonly string[] = sliceCanonicalRegion(
  'StrCpy $7 0',
  'StrCpy $2 $1 1 -1',
);

export const CANONICAL_TRAVERSAL_SCAN_BLOCK_SHA256 = createHash('sha256')
  .update(CANONICAL_TRAVERSAL_SCAN_BLOCK.join('\n'))
  .digest('hex');

/** Marker-anchored sidecar guard region (file :43–:541). Each marker must occur exactly once. */
export const SIDECAR_GUARD_REGION_START_LINE = '        uninstall_vault_read: ClearErrors';
export const SIDECAR_GUARD_REGION_START_FOLLOW_LINE = '        FileRead $0 $1';
export const SIDECAR_GUARD_REGION_START_MARKER = SIDECAR_GUARD_REGION_START_FOLLOW_LINE;
export const SIDECAR_GUARD_REGION_END_LINE = '          StrCmp $2 "9l" mythos_comp_tail_ret9l';
export const SIDECAR_GUARD_REGION_END_MARKER = SIDECAR_GUARD_REGION_END_LINE;
export const SIDECAR_GUARD_REGION_END_FOLLOW_LINE = '          Goto uninstall_vault_read';

export const SIDECAR_GUARD_REGION_FILE_LINE_FIRST = 43;
export const SIDECAR_GUARD_REGION_FILE_LINE_LAST = 541;

/** S-19 existence helpers sit after the :541/:542 barrier (outside the pin). */
export const SIDECAR_FALLBACK_REGION_FILE_LINE_FIRST = 542;
export const SIDECAR_FALLBACK_REGION_FILE_LINE_LAST = 582;

export function nshExecutableLines(source: string): string {
  return source.replace(/;[^\n]*/g, '');
}

function replaceInBackslashBranch(
  nsh: string,
  needle: string,
  replacement: string,
  occurrence = 0,
): string {
  const start = nsh.indexOf(TRAV_BACKSLASH_ENTRY);
  const end = nsh.indexOf(TRAV_FWD_LABEL, start);
  if (start < 0 || end <= start) {
    throw new Error('backslash traversal branch missing');
  }
  const branch = nsh.slice(start, end);
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = branch.indexOf(needle, idx + 1);
  }
  if (idx < 0) {
    throw new Error(`needle missing in backslash branch: ${needle.slice(0, 40)}`);
  }
  const globalAt = start + idx;
  return nsh.slice(0, globalAt) + replacement + nsh.slice(globalAt + needle.length);
}

function replaceInForwardBranch(
  nsh: string,
  needle: string,
  replacement: string,
  occurrence = 0,
): string {
  const start = nsh.indexOf(TRAV_FWD_LABEL);
  const end = nsh.indexOf('mythos_trav_inc:', start);
  if (start < 0 || end <= start) {
    throw new Error('forward traversal branch missing');
  }
  const branch = nsh.slice(start, end);
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = branch.indexOf(needle, idx + 1);
  }
  if (idx < 0) {
    throw new Error(`needle missing in forward branch: ${needle.slice(0, 40)}`);
  }
  const globalAt = start + idx;
  return nsh.slice(0, globalAt) + replacement + nsh.slice(globalAt + needle.length);
}

export type TravScanOutcome = 'trav_ok' | 'vault_read';

/** `StrCpy $4 $1 1 index`: a negative index counts from the end, clamped to the first char. */
function nshCharAt(path: string, index: number): string {
  const at = index < 0 ? Math.max(0, path.length + index) : index;
  return at < path.length ? path[at]! : '';
}

function parseStrCmpQuotedLiteralUncached(raw: string): string {
  if (raw.length === 0) {
    return '';
  }
  if (raw === '""') {
    return '';
  }
  const inner = raw.slice(1, -1);
  return inner
    .replace(/\$\\([nrt"])/g, (_, c: string) => {
      switch (c) {
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        case '"':
          return '"';
        default:
          return `$\\${c}`;
      }
    })
    .replace(/\\(.)/g, '$1');
}

const quotedLiteralCache = new Map<string, string>();

/** Memoized: the scan VM re-parses the same few StrCmp literals on every step of a corpus sweep. */
function parseStrCmpQuotedLiteral(raw: string): string {
  let lit = quotedLiteralCache.get(raw);
  if (lit === undefined) {
    lit = parseStrCmpQuotedLiteralUncached(raw);
    quotedLiteralCache.set(raw, lit);
  }
  return lit;
}

function resolveTraversalJump(
  target: string,
  labels: ReadonlyMap<string, number>,
): TravScanOutcome | { pc: number } {
  if (target === 'uninstall_vault_trav_ok') {
    const at = labels.get('uninstall_vault_trav_ok');
    if (at === undefined) {
      throw new Error('uninstall_vault_trav_ok label missing from traversal block');
    }
    return { pc: at };
  }
  if (
    target === 'uninstall_vault_read' ||
    target === 'uninstall_vault_close' ||
    target === 'uninstall_vault_fallback' ||
    target === 'mythos_trim_chop'
  ) {
    return 'vault_read';
  }
  const at = labels.get(target);
  if (at === undefined) {
    throw new Error(`unknown traversal jump label: ${target}`);
  }
  return { pc: at };
}

function readTravRegister(regs: { $7: number; $8: number }, name: string): number {
  if (name === '7') {
    return regs.$7;
  }
  if (name === '8') {
    return regs.$8;
  }
  throw new Error(`unsupported traversal register $${name}`);
}

export type TravScanRegs = { $7: number; $8: number };

/** Execute mythos_trav_scan … uninstall_vault_trav_ok block for sidecar path $1. */
export function executeTraversalScanBlock(
  blockLines: readonly string[],
  path: string,
  initialRegs: TravScanRegs = { $7: 0, $8: 0 },
): TravScanOutcome {
  return executeTraversalScanBlockStateful(blockLines, path, initialRegs).outcome;
}

/** Per-array memo for tables derived from a read-only (memoized) VM block. */
function memoizeByArray<T>(compute: (lines: readonly string[]) => T): (lines: readonly string[]) => T {
  const cache = new WeakMap<readonly string[], T>();
  return (lines) => {
    if (cache.has(lines)) {
      return cache.get(lines) as T;
    }
    const value = compute(lines);
    cache.set(lines, value);
    return value;
  };
}

const traversalBlockLabels = memoizeByArray((blockLines): ReadonlyMap<string, number> => {
  const labels = new Map<string, number>();
  for (let i = 0; i < blockLines.length; i++) {
    const labelMatch = blockLines[i]!.match(/^\s*(\w+):\s*$/);
    if (labelMatch) {
      labels.set(labelMatch[1]!, i);
    }
  }
  return labels;
});

type TravScanState = { $1: string; $2: string; $4: string; regs: TravScanRegs; pc: number };

/** One decoded scan-block line: returns an outcome to stop, or `undefined` after moving `s.pc`. */
type TravScanOp = (s: TravScanState) => TravScanOutcome | undefined;

/**
 * Decodes each scan-block line once per block (the corpus sweep runs the same block on thousands of
 * paths). A jump is resolved at decode time but an unknown label still throws only when taken.
 */
const decodeTraversalScanBlock = memoizeByArray((blockLines): readonly TravScanOp[] => {
  const labels = traversalBlockLabels(blockLines);
  const scanPc = labels.get('mythos_trav_scan');
  const next: TravScanOp = (s) => {
    s.pc += 1;
    return undefined;
  };
  const jumpTo = (target: string): TravScanOp => {
    if (target === '0' || /^[+-]\d+$/.test(target)) {
      const off = target === '0' ? 1 : Number(target);
      return (s) => {
        s.pc += off;
        return undefined;
      };
    }
    let resolved: TravScanOutcome | { pc: number } | Error;
    try {
      resolved = resolveTraversalJump(target, labels);
    } catch (err) {
      resolved = err instanceof Error ? err : new Error(String(err));
    }
    return (s) => {
      if (resolved instanceof Error) {
        throw resolved;
      }
      if (typeof resolved === 'string') {
        return resolved;
      }
      s.pc = resolved.pc;
      return undefined;
    };
  };
  const branch = (taken: (s: TravScanState) => boolean, onTrue: TravScanOp, onFalse: TravScanOp): TravScanOp =>
    (s) => (taken(s) ? onTrue(s) : onFalse(s));
  const by = (n: number): TravScanOp => (s) => {
    s.pc += n;
    return undefined;
  };

  return blockLines.map((raw, pc): TravScanOp => {
    const line = raw.trim();
    if (line.endsWith(':') && /^\w+:\s*$/.test(line)) {
      return next;
    }
    const strCpy7 = line.match(/^StrCpy \$7 (\d+)$/);
    if (strCpy7) {
      const n = Number(strCpy7[1]);
      return (s) => {
        s.regs.$7 = n;
        s.pc += 1;
        return undefined;
      };
    }
    const strCpyFromPath = line.match(/^StrCpy \$4 \$1 1 \$(\d+)$/);
    if (strCpyFromPath) {
      const reg = strCpyFromPath[1]!;
      return (s) => {
        s.$4 = nshCharAt(s.$1, readTravRegister(s.regs, reg));
        s.pc += 1;
        return undefined;
      };
    }
    if (/^StrCpy \$2 \$1 1 -1$/.test(line)) {
      return (s) => {
        s.$2 = s.$1.length > 0 ? s.$1[s.$1.length - 1]! : '';
        s.pc += 1;
        return undefined;
      };
    }
    const strCmpSevenZero = line.match(/^StrCmp \$7 "0" \+(\d+)$/);
    if (strCmpSevenZero) {
      return branch((s) => s.regs.$7 === 0, by(Number(strCmpSevenZero[1])), next);
    }
    const strCmpSevenLabel = line.match(/^StrCmp \$7 ("(?:\\.|[^"])*") (\w+)$/);
    if (strCmpSevenLabel) {
      const lit = parseStrCmpQuotedLiteral(strCmpSevenLabel[1]!);
      return branch((s) => nsisStrEq(String(s.regs.$7), lit), jumpTo(strCmpSevenLabel[2]!), next);
    }
    const strCmpTwoLit = line.match(/^StrCmp \$2 ("(?:\\.|[^"])*") (\w+)$/);
    if (strCmpTwoLit) {
      const lit = parseNsisDollarEscape(strCmpTwoLit[1]!);
      return branch((s) => nsisStrEq(s.$2, lit), jumpTo(strCmpTwoLit[2]!), next);
    }
    const intOp7 = line.match(/^IntOp \$8 \$7 \+ (\d+)$/);
    if (intOp7) {
      const n = Number(intOp7[1]);
      return (s) => {
        s.regs.$8 = s.regs.$7 + n;
        s.pc += 1;
        return undefined;
      };
    }
    if (/^IntOp \$8 \$7 - 1$/.test(line)) {
      return (s) => {
        s.regs.$8 = s.regs.$7 - 1;
        s.pc += 1;
        return undefined;
      };
    }
    const intOp8 = line.match(/^IntOp \$8 \$8 \+ (\d+)$/);
    if (intOp8) {
      const n = Number(intOp8[1]);
      return (s) => {
        s.regs.$8 += n;
        s.pc += 1;
        return undefined;
      };
    }
    const intOp7inc = line.match(/^IntOp \$7 \$7 \+ (\d+)$/);
    if (intOp7inc) {
      const n = Number(intOp7inc[1]);
      return (s) => {
        s.regs.$7 += n;
        s.pc += 1;
        return undefined;
      };
    }
    if (line === 'Nop') {
      return next;
    }
    if (line === 'Goto mythos_trav_scan' && scanPc !== undefined) {
      return (s) => {
        s.pc = scanPc + 1;
        return undefined;
      };
    }
    const gotoLabel = line.match(/^Goto (\S+)$/);
    if (gotoLabel) {
      return jumpTo(gotoLabel[1]!);
    }
    const strCmpFour = line.match(/^StrCmp \$4 ("(?:\\.|[^"])*") (\d+) (\w+)$/);
    if (strCmpFour) {
      const lit = parseStrCmpQuotedLiteral(strCmpFour[1]!);
      return branch((s) => nsisStrEq(s.$4, lit), by(1 + Number(strCmpFour[2])), jumpTo(strCmpFour[3]!));
    }
    const strCmpThree = line.match(/^StrCmp \$4 ("(?:\\.|[^"])*") (\w+)$/);
    if (strCmpThree) {
      const lit = parseStrCmpQuotedLiteral(strCmpThree[1]!);
      return branch((s) => nsisStrEq(s.$4, lit), jumpTo(strCmpThree[2]!), next);
    }
    return () => {
      throw new Error(`unsupported traversal VM instruction at block pc ${pc}: ${line}`);
    };
  });
});

export function executeTraversalScanBlockStateful(
  blockLines: readonly string[],
  path: string,
  initialRegs: TravScanRegs,
  options?: { maxSteps?: number; $2?: string; $4?: string; startPc?: number },
): { outcome: TravScanOutcome; regs: TravScanRegs } {
  if (!traversalBlockLabels(blockLines).has('mythos_trav_scan')) {
    throw new Error('mythos_trav_scan label missing from traversal block');
  }
  const ops = decodeTraversalScanBlock(blockLines);
  const regs = { $7: initialRegs.$7, $8: initialRegs.$8 };
  const s: TravScanState = {
    $1: path,
    $2: options?.$2 ?? '',
    $4: options?.$4 ?? '',
    regs,
    pc: options?.startPc ?? 0,
  };
  const maxSteps = options?.maxSteps ?? path.length * 400 + 2000;

  for (let step = 0; step < maxSteps; step++) {
    if (s.pc >= ops.length) {
      return { outcome: 'trav_ok', regs };
    }
    if (s.pc < 0) {
      throw new Error(`traversal VM pc out of range: ${s.pc}`);
    }
    const outcome = ops[s.pc]!(s);
    if (outcome !== undefined) {
      return { outcome, regs };
    }
  }
  throw new Error('TRAVERSAL_VM_STEP_LIMIT_EXCEEDED');
}

export const TRAVERSAL_VM_STEP_LIMIT_ERROR = 'TRAVERSAL_VM_STEP_LIMIT_EXCEEDED';

export function locateTraversalScanBlock(nsh: string): { start: number; end: number; lines: string[] } {
  const fileLines = nshFileLines(nsh);
  const scanIdx = fileLines.findIndex((l) => l.trim() === TRAVERSAL_SCAN_BLOCK_SCAN_LABEL);
  const end = fileLines.findIndex((l) => l.trim() === TRAVERSAL_SCAN_BLOCK_END_MARKER);
  if (scanIdx < 1 || end <= scanIdx) {
    throw new Error('mythos_trav_scan chain markers missing in uninstall nsh');
  }
  const start = scanIdx - 1;
  if (fileLines[start] !== TRAVERSAL_SCAN_BLOCK_PREP_LINE) {
    throw new Error(
      `expected ${JSON.stringify(TRAVERSAL_SCAN_BLOCK_PREP_LINE)} immediately before ${TRAVERSAL_SCAN_BLOCK_SCAN_LABEL}`,
    );
  }
  return { start, end, lines: fileLines.slice(start, end + 1) };
}

export function extractTraversalScanBlockLines(nsh: string): string[] {
  return locateTraversalScanBlock(nsh).lines;
}

export function spliceTraversalScanBlock(nsh: string, blockLines: string[]): string {
  const { start, end } = locateTraversalScanBlock(nsh);
  const fileLines = nshFileLines(nsh);
  return [...fileLines.slice(0, start), ...blockLines, ...fileLines.slice(end + 1)].join('\n');
}

export function replaceTraversalScanBlockLine(
  nsh: string,
  blockLineIndex: number,
  newLine: string,
): string {
  const { lines } = locateTraversalScanBlock(nsh);
  if (blockLineIndex < 0 || blockLineIndex >= lines.length) {
    throw new Error(`block line index ${blockLineIndex} out of range (${lines.length})`);
  }
  const next = [...lines];
  next[blockLineIndex] = newLine;
  return spliceTraversalScanBlock(nsh, next);
}

export function replaceTraversalScanBlockLineByExact(
  nsh: string,
  exactLine: string,
  newLine: string,
  occurrence = 0,
): string {
  const { lines } = locateTraversalScanBlock(nsh);
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === exactLine) {
      seen += 1;
      if (seen === occurrence) {
        return replaceTraversalScanBlockLine(nsh, i, newLine);
      }
    }
  }
  throw new Error(`exact block line not found (occurrence ${occurrence}): ${exactLine}`);
}

export function assertTraversalScanBlockExact(nsh: string): void {
  assertSidecarGuardRegionExact(nsh);
}

const readTrimBlockFromGuardRegion = memoizeByArray((region): readonly string[] => {
  const scanIdx = region.findIndex((l) => l.trim() === 'mythos_trav_scan:');
  if (scanIdx < 0) {
    throw new Error('mythos_trav_scan missing from sidecar guard region');
  }
  return region.slice(0, scanIdx - 1);
});

const travBlockFromGuardRegion = memoizeByArray((region): readonly string[] => {
  const scanIdx = region.findIndex((l) => l.trim() === 'mythos_trav_scan:');
  const windir = region.findIndex((l) => l === DENY_PREFIX_BLOCK_START_LINE);
  if (scanIdx < 1 || windir <= scanIdx) {
    throw new Error('traversal scan block markers missing from sidecar guard region');
  }
  return region.slice(scanIdx - 1, windir);
});

const denyBlockFromGuardRegion = memoizeByArray((region): readonly string[] => {
  const windir = region.findIndex((l) => l === DENY_PREFIX_BLOCK_START_LINE);
  const appdataStart = region.findIndex((l) => l.includes(String.raw`StrCpy $5 "$APPDATA`));
  if (windir < 0 || appdataStart <= windir) {
    throw new Error('deny-prefix block boundaries missing from sidecar guard region');
  }
  return region.slice(windir, appdataStart);
});

function appDataM5BlockFromGuardRegion(region: readonly string[]): readonly string[] {
  const appdataStart = region.findIndex((l) => l.includes(String.raw`StrCpy $5 "$APPDATA`));
  if (appdataStart < 0) {
    throw new Error('APPDATA M5 guard start missing from sidecar guard region');
  }
  return region.slice(appdataStart);
}

/** APPDATA … Downloads allowlist gates through `mythos_al_deny` (file :102–:148). */
export function extractSidecarAllowlistDeleteLinesFromNsh(nsh: string): string[] {
  const fileLines = nshFileLines(nsh);
  const start = fileLines.findIndex((l) => l.includes(String.raw`StrCpy $5 "$APPDATA`));
  const denyLabel = fileLines.findIndex((l) => l.trim() === 'mythos_al_deny:');
  if (start < 0 || denyLabel < start) {
    throw new Error('allowlist delete block start missing in uninstall nsh');
  }
  const gotoReadIdx = denyLabel + 1;
  if (fileLines[gotoReadIdx]?.trim() !== 'Goto uninstall_vault_read') {
    throw new Error('mythos_al_deny Goto uninstall_vault_read missing');
  }
  return fileLines.slice(start, gotoReadIdx + 1);
}

function extractAppDataM5GuardLinesFromNsh(nsh: string): string[] {
  return extractSidecarAllowlistDeleteLinesFromNsh(nsh);
}

/** Two-slot nsh memo so canonical + current-mutant extracts survive mode-2 alternation. */
function memoizeByNsh<T>(compute: (nsh: string) => T): (nsh: string) => T {
  let a: { nsh: string; value: T } | undefined;
  let b: { nsh: string; value: T } | undefined;
  return (nsh) => {
    if (a?.nsh === nsh) {
      return a.value;
    }
    if (b?.nsh === nsh) {
      return b.value;
    }
    const value = compute(nsh);
    b = a;
    a = { nsh, value };
    return value;
  };
}

const extractSidecarGuardRegionForVm = memoizeByNsh(extractSidecarGuardRegionLinesRebaselined);

const extractSidecarAllowlistDeleteLinesForVm = memoizeByNsh(extractSidecarAllowlistDeleteLinesFromNsh);

function indicesOfExactLine(fileLines: readonly string[], line: string): number[] {
  const at: number[] = [];
  fileLines.forEach((l, i) => {
    if (l === line) {
      at.push(i);
    }
  });
  return at;
}

export function locateSidecarGuardRegion(nsh: string): { start: number; end: number; lines: string[] } {
  const fileLines = nshFileLines(nsh);
  const startMarkers = indicesOfExactLine(fileLines, SIDECAR_GUARD_REGION_START_MARKER);
  const endMarkers = indicesOfExactLine(fileLines, SIDECAR_GUARD_REGION_END_MARKER);
  if (startMarkers.length !== 1 || endMarkers.length !== 1) {
    throw new Error(
      `sidecar guard region markers must each occur exactly once (start ${startMarkers.length}, end ${endMarkers.length})`,
    );
  }
  const start = startMarkers[0]! - 1;
  const deleteAt = endMarkers[0]!;
  if (
    start < 0 ||
    fileLines[start] !== SIDECAR_GUARD_REGION_START_LINE ||
    deleteAt <= start ||
    fileLines[deleteAt + 1] !== SIDECAR_GUARD_REGION_END_FOLLOW_LINE
  ) {
    throw new Error('sidecar guard region (:43–:541) markers missing in uninstall nsh');
  }
  const end = deleteAt + 1;
  const lines = fileLines.slice(start, end + 1);
  return { start, end, lines };
}

export function extractSidecarGuardRegionLines(nsh: string, options?: { strictLength?: boolean }): string[] {
  const located = locateSidecarGuardRegion(nsh);
  if (options?.strictLength !== false) {
    if (located.lines.length !== CANONICAL_SIDECAR_GUARD_REGION.length) {
      throw new Error(
        `sidecar guard region line count: expected ${CANONICAL_SIDECAR_GUARD_REGION.length}, got ${located.lines.length}`,
      );
    }
  }
  return located.lines;
}

/** Re-baseline VM tables: marker slice only (no canonical line-count gate). */
export function extractSidecarGuardRegionLinesRebaselined(nsh: string): string[] {
  return extractSidecarGuardRegionLines(nsh, { strictLength: false });
}

export function spliceSidecarGuardRegion(nsh: string, blockLines: string[]): string {
  const { start, end } = locateSidecarGuardRegion(nsh);
  const fileLines = nshFileLines(nsh);
  return [...fileLines.slice(0, start), ...blockLines, ...fileLines.slice(end + 1)].join('\n');
}

export function replaceSidecarGuardRegionLine(
  nsh: string,
  regionLineIndex: number,
  newLine: string,
): string {
  const { lines } = locateSidecarGuardRegion(nsh);
  if (regionLineIndex < 0 || regionLineIndex >= lines.length) {
    throw new Error(`sidecar guard region line index ${regionLineIndex} out of range (${lines.length})`);
  }
  const next = [...lines];
  next[regionLineIndex] = newLine;
  return spliceSidecarGuardRegion(nsh, next);
}

/** Mutate one file line in :43–:541 (1-based file line number). */
export function replaceSidecarGuardFileLine(nsh: string, fileLineOneBased: number, newLine: string): string {
  if (
    fileLineOneBased < SIDECAR_GUARD_REGION_FILE_LINE_FIRST ||
    fileLineOneBased > SIDECAR_GUARD_REGION_FILE_LINE_LAST
  ) {
    throw new Error(`file line ${fileLineOneBased} outside guard region`);
  }
  const regionIndex = fileLineOneBased - SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
  return replaceSidecarGuardRegionLine(nsh, regionIndex, newLine);
}

export function assertSidecarGuardRegionExact(nsh: string): void {
  const actual = extractSidecarGuardRegionLines(nsh, { strictLength: true });
  const expected = CANONICAL_SIDECAR_GUARD_REGION;
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `sidecar guard region line ${i} (file :${SIDECAR_GUARD_REGION_FILE_LINE_FIRST + i}): expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`,
      );
    }
  }
  const hash = createHash('sha256').update(actual.join('\n')).digest('hex');
  if (hash !== CANONICAL_SIDECAR_GUARD_REGION_SHA256) {
    throw new Error(`sidecar guard region sha256 mismatch: ${hash}`);
  }
}

export function runTraversalVmFromNsh(path: string, nsh: string): TravScanOutcome {
  const region = extractSidecarGuardRegionForVm(nsh);
  return executeTraversalScanBlock(travBlockFromGuardRegion(region), path);
}

function runDenyPrefixVmFromNsh(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
): DenyPrefixOutcome {
  const region = extractSidecarGuardRegionForVm(nsh);
  return executeDenyPrefixBlock(denyBlockFromGuardRegion(region), path, env);
}

export const DENY_PREFIX_BLOCK_ANCHOR_AFTER = TRAVERSAL_SCAN_BLOCK_END_MARKER;
export const DENY_PREFIX_BLOCK_START_LINE =
  '        System::Call "kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4"';
export const DENY_PREFIX_BLOCK_END_LINE = '        StrCpy $5 "$APPDATA\\Mythos Writer"';


/** Exact $WINDIR / $PROGRAMFILES / $PROGRAMFILES64 deny chain (path GFPN/GLP + three deny roots). */
export const CANONICAL_DENY_PREFIX_BLOCK: readonly string[] = [
  "        System::Call \"kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r3, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r3, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $3 $2",
  "        StrCmp $3 \"\" uninstall_vault_read",
  "        StrCpy $2 \"ct1\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret1:",
  "        StrCpy $5 \"$WINDIR\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" uninstall_vault_read",
  "        StrCpy $2 \"5w\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5w:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 uninstall_vault_read 0",
  "        StrCpy $5 \"$PROGRAMFILES\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" uninstall_vault_read",
  "        StrCpy $2 \"5p\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5p:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 uninstall_vault_read 0",
  "        StrCpy $5 \"$PROGRAMFILES64\"",
  "        System::Call \"kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r5, p 0) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        System::Call \"kernel32::GetLongPathNameW(w r5, w .r2, i ${NSIS_MAX_STRLEN}) i .r4\"",
  "        IntCmp $4 0 uninstall_vault_read uninstall_vault_read 0",
  "        IntCmp $4 ${NSIS_MAX_STRLEN} uninstall_vault_read 0 uninstall_vault_read",
  "        StrCpy $5 $2",
  "        StrCmp $5 \"\" uninstall_vault_read",
  "        StrCpy $2 \"5x\"",
  "        Goto mythos_comp_tail_scan",
  "        mythos_comp_tail_ret5x:",
  "        StrLen $8 $5",
  "        StrCpy $4 $3 $8",
  "        StrCmp $4 $5 uninstall_vault_read 0",
];;


export const CANONICAL_DENY_PREFIX_BLOCK_SHA256 = createHash('sha256')
  .update(CANONICAL_DENY_PREFIX_BLOCK.join('\n'))
  .digest('hex');

export type SidecarNsisVarEnv = Readonly<{
  WINDIR: string;
  PROGRAMFILES: string;
  PROGRAMFILES64: string;
  APPDATA: string;
  DOCUMENTS: string;
  DESKTOP: string;
  PROFILE: string;
}>;

export const DEFAULT_SIDECAR_NSIS_VAR_ENV: SidecarNsisVarEnv = {
  WINDIR: 'C:\\Windows',
  PROGRAMFILES: 'C:\\Program Files (x86)',
  PROGRAMFILES64: 'C:\\Program Files',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  DOCUMENTS: 'C:\\Users\\me\\Documents',
  DESKTOP: 'C:\\Users\\me\\Desktop',
  PROFILE: 'C:\\Users\\me',
};

function unescapeNsisCString(inner: string): string {
  return inner.replace(/\\(.)/g, (_match, c: string) => {
    switch (c) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '"':
        return '"';
      case '\\':
        return '\\';
      default:
        return `\\${c}`;
    }
  });
}

function expandNsisQuotedLiteral(quoted: string, env: SidecarNsisVarEnv): string {
  const inner = quoted.slice(1, -1);
  if (inner.startsWith('$')) {
    const varName = inner.match(/^\$([A-Z0-9_]+)/)?.[1];
    if (varName) {
      const key = varName as keyof SidecarNsisVarEnv;
      const value = env[key];
      if (value === undefined) {
        throw new Error(`missing NSIS var expansion for $${varName}`);
      }
      const suffix = inner.slice(varName.length + 1);
      return value + unescapeNsisCString(suffix);
    }
  }
  return unescapeNsisCString(inner);
}

export type DenyPrefixOutcome = 'vault_read' | 'allowlist_continue';

function applyGfpnOrGlpnCall(
  line: string,
  reg: Record<string, string>,
  value: (tok: string) => string,
): boolean {
  const gfpn = line.match(
    /^System::Call "kernel32::GetFullPathNameW\(w r(\d), i (\S+), w \.r(\d), p 0\) i \.r(\d)"$/,
  );
  if (gfpn) {
    const src = `$${gfpn[1]!}`;
    const size = nsisLeadingInt(value(gfpn[2]!));
    const dst = `$${gfpn[3]!}`;
    const ret = `$${gfpn[4]!}`;
    const resolved = gfpnModel(reg[src] ?? '');
    if (resolved !== '') {
      reg[dst] = resolved;
    }
    if (resolved === '') {
      reg[ret] = '0';
    } else if (resolved.length >= size) {
      reg[ret] = String(resolved.length + 1);
    } else {
      reg[ret] = String(resolved.length);
    }
    return true;
  }
  const glpn = line.match(
    /^System::Call "kernel32::GetLongPathName(\w+)\(w r(\d), w \.r(\d), i (\S+)\) i \.r(\d)(?: \?e)?"$/,
  );
  if (glpn) {
    const expand = glpn[1] === 'W';
    const src = `$${glpn[2]!}`;
    const dst = `$${glpn[3]!}`;
    const size = nsisLeadingInt(value(glpn[4]!));
    const ret = `$${glpn[5]!}`;
    const raw = reg[src] ?? '';
    const resolved = raw === '' ? '' : expand ? glpnModel(raw) : raw;
    // System plugin: failure writes the empty output buffer (never the input).
    if (resolved === '') {
      reg[dst] = '';
      reg[ret] = '0';
    } else if (resolved.length >= size) {
      reg[dst] = resolved;
      reg[ret] = String(resolved.length + 1);
    } else {
      reg[dst] = resolved;
      reg[ret] = String(resolved.length);
    }
    return true;
  }
  return false;
}

/** Execute GFPN+GLP + prefix deny for $WINDIR, $PROGRAMFILES, $PROGRAMFILES64. */
export function executeDenyPrefixBlock(
  blockLines: readonly string[],
  path: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): DenyPrefixOutcome {
  const reg: Record<string, string> = {
    $1: path,
    $3: '',
    $4: '',
    $5: '',
    $8: '0',
  };
  const value = (tok: string): string => {
    if (/^\$\d$/.test(tok)) {
      return reg[tok] ?? '';
    }
    if (tok === '${NSIS_MAX_STRLEN}') {
      return String(SIDECAR_CANON_GATE_MAX_STRLEN);
    }
    return tok.startsWith('"') ? expandNsisQuotedLiteral(tok, env) : tok;
  };
  const maxSteps = blockLines.length * 8 + 80;
  let pc = 0;
  for (let step = 0; step < maxSteps; step += 1) {
    if (pc >= blockLines.length) {
      return 'allowlist_continue';
    }
    const line = blockLines[pc]!.trim();
    if (/^\w+:$/.test(line) || line === 'Nop') {
      pc += 1;
      continue;
    }
    if (applyGfpnOrGlpnCall(line, reg, value)) {
      pc += 1;
      continue;
    }
    if (line === 'StrCpy $5 $2') {
      reg.$5 = reg.$2 ?? '';
      pc += 1;
      continue;
    }
    if (line === 'StrCpy $3 $2') {
      reg.$3 = reg.$2 ?? '';
      pc += 1;
      continue;
    }
    if (line.startsWith('StrCpy $5 ')) {
      const lit = line.match(/^StrCpy \$5 ("(?:\\.|[^"])*")$/);
      if (!lit) {
        throw new Error(`unsupported deny-prefix StrCpy $5: ${line}`);
      }
      reg.$5 = expandNsisQuotedLiteral(lit[1]!, env);
      pc += 1;
      continue;
    }
    if (line === 'StrCmp $5 "" uninstall_vault_read' || line === 'StrCmp $3 "" uninstall_vault_read') {
      const v = line.includes('$5') ? (reg.$5 ?? '') : (reg.$3 ?? '');
      if (v === '') {
        return 'vault_read';
      }
      pc += 1;
      continue;
    }
    if (line === 'StrLen $8 $5') {
      reg.$8 = String(reg.$5.length);
      pc += 1;
      continue;
    }
    if (line === 'StrCpy $4 $3 $8') {
      reg.$4 = (reg.$3 ?? '').slice(0, Number(reg.$8) || 0);
      pc += 1;
      continue;
    }
    const strLenOld = line.match(/^StrLen \$3 ("(?:\\.|[^"])*")$/);
    if (strLenOld) {
      reg.$3 = String(expandNsisQuotedLiteral(strLenOld[1]!, env).length);
      pc += 1;
      continue;
    }
    const strCpyOld = line.match(/^StrCpy \$4 \$1 \$(\d+)$/);
    if (strCpyOld) {
      const len = Number(reg[`$${strCpyOld[1]!}`] ?? '0');
      reg.$4 = path.slice(0, len);
      pc += 1;
      continue;
    }
    const intCmp = line.match(/^IntCmp \$4 (\S+) (\S+)(?: (\S+))?(?: (\S+))?$/);
    if (intCmp) {
      const a = nsisLeadingInt(value('$4'));
      const b = nsisLeadingInt(value(intCmp[1]!));
      const target = a === b ? intCmp[2]! : a < b ? (intCmp[3] ?? '0') : (intCmp[4] ?? '0');
      if (target === 'uninstall_vault_read') {
        return 'vault_read';
      }
      if (target === '0') {
        pc += 1;
        continue;
      }
      throw new Error(`unsupported deny-prefix IntCmp target: ${line}`);
    }
    if (line.startsWith('StrCpy $2 ') || line === 'Goto mythos_comp_tail_scan' || /^mythos_comp_tail_ret\w+:$/.test(line)) {
      pc += 1;
      continue;
    }
    const strCmpDeny = line.match(/^StrCmp \$4 \$5 uninstall_vault_read (\d+)$/);
    if (strCmpDeny) {
      if (nsisStrEq(reg.$4 ?? '', reg.$5 ?? '')) {
        return 'vault_read';
      }
      const off = Number(strCmpDeny[1]);
      pc += off === 0 ? 1 : off;
      continue;
    }
    const strCmpLit = line.match(/^StrCmp \$4 ("(?:\\.|[^"])*") uninstall_vault_read (\d+)$/);
    if (strCmpLit) {
      const lit = expandNsisQuotedLiteral(strCmpLit[1]!, env);
      if (nsisStrEq(reg.$4 ?? '', lit)) {
        return 'vault_read';
      }
      const off = Number(strCmpLit[2]);
      pc += off === 0 ? 1 : off;
      continue;
    }
    throw new Error(`unsupported deny-prefix VM instruction: ${line}`);
  }
  throw new Error('deny-prefix VM exceeded step limit');
}

export type SidecarAllowlistDeleteOutcome = 'delete' | 'skip_delete';

export type AppDataM5GuardOutcome = 'vault_read' | 'allowlist_continue';

function allowlistDeleteToLegacyAppData(outcome: SidecarAllowlistDeleteOutcome): AppDataM5GuardOutcome {
  return outcome === 'delete' ? 'allowlist_continue' : 'vault_read';
}

function resolveAllowlistDeleteJump(
  target: string,
  labels: ReadonlyMap<string, number>,
): SidecarAllowlistDeleteOutcome | { pc: number } {
  if (
    target === 'uninstall_vault_read' ||
    target === 'uninstall_vault_close' ||
    target === 'uninstall_vault_fallback' ||
    target === 'mythos_trim_chop'
  ) {
    return 'skip_delete';
  }
  if (
    target === 'uninstall_vault_do_delete' ||
    target === 'mythos_canon_gate' ||
    target === 'mythos_reparse_walk'
  ) {
    return 'delete';
  }
  const at = labels.get(target);
  if (at === undefined) {
    throw new Error(`unknown allowlist/delete jump target: ${target}`);
  }
  return { pc: at };
}

/** Allowlist root guards (APPDATA/Documents/Desktop/Downloads) with the registers they leave for the gate. */
export function executeSidecarAllowlistDeleteBlockDetailed(
  blockLines: readonly string[],
  path: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): SidecarAllowlistDeleteDetailed {
  const labels = new Map<string, number>();
  for (let i = 0; i < blockLines.length; i++) {
    const labelMatch = blockLines[i]!.trim().match(/^(\w+):$/);
    if (labelMatch) {
      labels.set(labelMatch[1]!, i);
    }
  }

  const $1 = path;
  const reg: Record<string, string> = {
    $1: path,
    $3: glpnModel(gfpnModel(path)),
    $4: '',
    $5: '',
    $6: '',
    $8: '0',
    $9: '',
  };
  let $3 = 0;
  let $4 = '';
  let $5 = '';
  let $6 = '';
  const allowValue = (tok: string): string => {
    if (/^\$\d$/.test(tok)) {
      return reg[tok] ?? '';
    }
    if (tok === '${NSIS_MAX_STRLEN}') {
      return String(SIDECAR_CANON_GATE_MAX_STRLEN);
    }
    return tok.startsWith('"') ? expandNsisQuotedLiteral(tok, env) : tok;
  };
  let pc = 0;
  const fin = (outcome: SidecarAllowlistDeleteOutcome): SidecarAllowlistDeleteDetailed => ({
    outcome,
    $3,
    $4,
    $5,
    $6,
  });
  const maxSteps = blockLines.length * 40 + 200;
  for (let step = 0; step < maxSteps; step++) {
    if (pc < 0 || pc >= blockLines.length) {
      return fin('skip_delete');
    }
    const raw = blockLines[pc]!;
    const line = raw.trim();
    if (/^\w+:\s*$/.test(line)) {
      pc += 1;
      continue;
    }
    if (applyGfpnOrGlpnCall(line, reg, allowValue)) {
      $3 = nsisLeadingInt(reg.$3 ?? '0');
      $4 = reg.$4 ?? '';
      $5 = reg.$5 ?? '';
      $6 = reg.$6 ?? '';
      pc += 1;
      continue;
    }
    if (line === 'Pop $8') {
      pc += 1;
      continue;
    }
    if (line === 'StrCpy $5 $2') {
      $5 = reg.$2 ?? '';
      reg.$5 = $5;
      pc += 1;
      continue;
    }
    if (line === 'StrCpy $3 $2') {
      reg.$3 = reg.$2 ?? '';
      pc += 1;
      continue;
    }
    if (line === 'StrCpy $9 $2') {
      reg.$9 = reg.$2 ?? '';
      pc += 1;
      continue;
    }
    const strCmpEmptyRoot = line.match(/^StrCmp \$([359]) "" (\S+)$/);
    if (strCmpEmptyRoot) {
      const v = reg[`$${strCmpEmptyRoot[1]!}`] ?? (strCmpEmptyRoot[1] === '5' ? $5 : '');
      if (v === '') {
        const jump = resolveAllowlistDeleteJump(strCmpEmptyRoot[2]!, labels);
        if (typeof jump === 'string') {
          return fin(jump);
        }
        pc = jump.pc;
        continue;
      }
      pc += 1;
      continue;
    }
    const intCmp = line.match(/^IntCmp \$([48]) (\S+) (\S+)(?: (\S+))?(?: (\S+))?$/);
    if (intCmp) {
      const a = nsisLeadingInt(allowValue(`$${intCmp[1]!}`));
      const b = nsisLeadingInt(allowValue(intCmp[2]!));
      const target = a === b ? intCmp[3]! : a < b ? (intCmp[4] ?? '0') : (intCmp[5] ?? '0');
      if (target === '0') {
        pc += 1;
        continue;
      }
      if (/^[+-]\d+$/.test(target)) {
        pc += Number(target);
        continue;
      }
      const jump = resolveAllowlistDeleteJump(target, labels);
      if (typeof jump === 'string') {
        return fin(jump);
      }
      pc = jump.pc;
      continue;
    }
    if (line.startsWith('StrCpy $2 ') || line === 'Goto mythos_comp_tail_scan') {
      pc += 1;
      continue;
    }
    if (line === 'StrLen $8 $5') {
      reg.$8 = String((reg.$5 ?? '').length);
      $3 = (reg.$5 ?? '').length;
      pc += 1;
      continue;
    }
    if (line === 'StrCpy $4 $3 $8') {
      const len = nsisLeadingInt(reg.$8 ?? '0');
      $4 = (reg.$3 ?? '').slice(0, len);
      reg.$4 = $4;
      pc += 1;
      continue;
    }
    if (line === 'StrCpy $4 $3 1 $8') {
      const from = nsisLeadingInt(reg.$8 ?? '0');
      $4 = (reg.$3 ?? '').length > from ? (reg.$3 ?? '')[from]! : '';
      reg.$4 = $4;
      pc += 1;
      continue;
    }
    const strCpyRem3 = line.match(/^StrCpy \$6 \$3 "" \$(\d+)$/);
    if (strCpyRem3) {
      const from = strCpyRem3[1] === '8' ? nsisLeadingInt(reg.$8 ?? '0') : $3;
      $6 = (reg.$3 ?? '').slice(from);
      reg.$6 = $6;
      pc += 1;
      continue;
    }
    const strCmpPathRoot = line.match(/^StrCmp \$3 \$5 uninstall_vault_read$/);
    if (strCmpPathRoot) {
      if (nsisStrEq(reg.$3 ?? '', reg.$5 ?? '')) {
        return fin('skip_delete');
      }
      pc += 1;
      continue;
    }
    const strCmpPrefixReg = line.match(/^StrCmp \$4 \$5 0 (\w+)$/);
    if (strCmpPrefixReg) {
      if (nsisStrEq($4, $5) || nsisStrEq(reg.$4 ?? '', reg.$5 ?? '')) {
        pc += 1;
        continue;
      }
      const jump = resolveAllowlistDeleteJump(strCmpPrefixReg[1]!, labels);
      if (typeof jump === 'string') {
        return fin(jump);
      }
      pc = jump.pc;
      continue;
    }
    const strCpy5 = line.match(/^StrCpy \$5 ("(?:\\.|[^"])*")$/);
    if (strCpy5) {
      $5 = expandNsisQuotedLiteral(strCpy5[1]!, env);
      reg.$5 = $5;
      pc += 1;
      continue;
    }
    const strLenReg = line.match(/^StrLen \$3 \$5$/);
    if (strLenReg) {
      $3 = $5.length;
      pc += 1;
      continue;
    }
    const strLenLit = line.match(/^StrLen \$3 ("(?:\\.|[^"])*")$/);
    if (strLenLit) {
      $3 = expandNsisQuotedLiteral(strLenLit[1]!, env).length;
      pc += 1;
      continue;
    }
    const strCpyFromLenReg = line.match(/^StrCpy \$4 \$1 \$(\d+)$/);
    if (strCpyFromLenReg) {
      const len = strCpyFromLenReg[1] === '3' ? $3 : 0;
      $4 = $1.slice(0, len);
      pc += 1;
      continue;
    }
    const strCmpRegPair = line.match(/^StrCmp \$4 \$5 0 (\w+)$/);
    if (strCmpRegPair) {
      if (nsisStrEq($4, $5)) {
        pc += 1;
        continue;
      }
      const jump = resolveAllowlistDeleteJump(strCmpRegPair[1]!, labels);
      if (typeof jump === 'string') {
        return fin(jump);
      }
      pc = jump.pc;
      continue;
    }
    const strCmpRoot = line.match(/^StrCmp \$1 \$5 uninstall_vault_read$/);
    if (strCmpRoot) {
      if (nsisStrEq($1, $5)) {
        return fin('skip_delete');
      }
      pc += 1;
      continue;
    }
    const strCmpRootLit = line.match(/^StrCmp \$1 ("(?:\\.|[^"])*") uninstall_vault_read$/);
    if (strCmpRootLit) {
      const lit = expandNsisQuotedLiteral(strCmpRootLit[1]!, env);
      if (nsisStrEq($1, lit)) {
        return fin('skip_delete');
      }
      pc += 1;
      continue;
    }
    const strCpyTailIdx = line.match(/^StrCpy \$4 \$1 1 \$(\d+)$/);
    if (strCpyTailIdx) {
      const len = strCpyTailIdx[1] === '3' ? $3 : 0;
      $4 = $1.length > len ? $1[len]! : '';
      pc += 1;
      continue;
    }
    const strCmpFourLitJump = line.match(/^StrCmp \$4 ("(?:\\.|[^"])*") 0 (\w+)$/);
    if (strCmpFourLitJump) {
      const lit = expandNsisQuotedLiteral(strCmpFourLitJump[1]!, env);
      if (nsisStrEq($4, lit)) {
        pc += 1;
        continue;
      }
      const jump = resolveAllowlistDeleteJump(strCmpFourLitJump[2]!, labels);
      if (typeof jump === 'string') {
        return fin(jump);
      }
      pc = jump.pc;
      continue;
    }
    const strCpyRemainder = line.match(/^StrCpy \$6 \$1 "" \$(\d+)$/);
    if (strCpyRemainder) {
      const from = strCpyRemainder[1] === '3' ? $3 : 0;
      $6 = $1.slice(from);
      pc += 1;
      continue;
    }
    const strCpyChopLead = line.match(/^StrCpy \$6 \$6 "" 1$/);
    if (strCpyChopLead) {
      $6 = $6.length > 0 ? $6.slice(1) : '';
      pc += 1;
      continue;
    }
    const strCmpTailEmpty = line.match(/^StrCmp \$6 "" uninstall_vault_read$/);
    if (strCmpTailEmpty) {
      if ($6 === '') {
        return fin('skip_delete');
      }
      pc += 1;
      continue;
    }
    const gotoLine = line.match(/^Goto (\S+)$/);
    if (gotoLine) {
      const jump = resolveAllowlistDeleteJump(gotoLine[1]!, labels);
      if (typeof jump === 'string') {
        return fin(jump);
      }
      pc = jump.pc;
      continue;
    }
    if (line === 'Nop') {
      pc += 1;
      continue;
    }
    throw new Error(`unsupported allowlist/delete VM instruction: ${line}`);
  }
  throw new Error('allowlist/delete VM exceeded step limit');
}

/** NSIS StrCmp: case-insensitive equality. */
function nsisStrEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export type SidecarAllowlistDeleteDetailed = {
  outcome: SidecarAllowlistDeleteOutcome;
  $3: number;
  $4: string;
  $5: string;
  $6: string;
};

/** Execute APPDATA/Documents/Desktop/Downloads allowlist gates through the allowlist-passed vs read decision. */
export function executeSidecarAllowlistDeleteBlock(
  blockLines: readonly string[],
  path: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): SidecarAllowlistDeleteOutcome {
  return executeSidecarAllowlistDeleteBlockDetailed(blockLines, path, env).outcome;
}

/** @deprecated Use executeSidecarAllowlistDeleteBlock; maps delete→allowlist_continue, skip→vault_read. */
export function executeAppDataM5GuardBlock(
  blockLines: readonly string[],
  path: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): AppDataM5GuardOutcome {
  return allowlistDeleteToLegacyAppData(executeSidecarAllowlistDeleteBlock(blockLines, path, env));
}

function runSidecarAllowlistDeleteVmFromNsh(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
): SidecarAllowlistDeleteOutcome {
  return executeSidecarAllowlistDeleteBlock(extractSidecarAllowlistDeleteLinesForVm(nsh), path, env);
}

export const SIDECAR_CANON_GATE_MAX_STRLEN = 1024;

/**
 * Documented Win32 GetFullPathNameW order (model W): fold `/`→`\`; resolve `.` / `..` first;
 * trim trailing dots/spaces from the final component only when it is not exactly `.` or `..`;
 * a final `.` / `..` with no trailing separator collapses like an inner one (`C:\a\b\..` → `C:\a`).
 * Intermediate segments drop one trailing period unless they are all periods. Keep a trailing
 * separator. Does NOT strip ADS or resolve junctions. Real kernel32 on notes-windows is ground truth.
 */
function gfpnModelK(s: string): string {
  let folded = s.replace(/\//g, '\\');
  if (!folded.endsWith('\\')) {
    folded = folded.replace(/[ .]+$/, '');
  }
  const endsWithSep = folded.endsWith('\\');
  const parts = folded.split('\\');
  const drive = parts[0] ?? '';
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    let seg = parts[i]!;
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      out.pop();
      continue;
    }
    if (seg.endsWith('.') && !/^\.+$/.test(seg)) {
      seg = seg.slice(0, -1);
    }
    out.push(seg);
  }
  const body = out.length > 0 ? `${drive}\\${out.join('\\')}` : `${drive}\\`;
  return endsWithSep && out.length > 0 ? `${body}\\` : body;
}

const gfpnModelCache = new Map<string, string>();

export function gfpnModel(s: string): string {
  const hit = gfpnModelCache.get(s);
  if (hit !== undefined) {
    return hit;
  }
  const folded = s.replace(/\//g, '\\');
  let result: string;
  if (!folded.endsWith('\\')) {
    const slash = folded.lastIndexOf('\\');
    const last = slash < 0 ? folded : folded.slice(slash + 1);
    if (last === '.' || last === '..') {
      const withSep = gfpnModelK(`${folded}\\`);
      if (withSep !== '' && !withSep.endsWith(':\\')) {
        result = withSep.endsWith('\\') ? withSep.slice(0, -1) : withSep;
      } else {
        result = withSep;
      }
      gfpnModelCache.set(s, result);
      return result;
    }
  }
  result = gfpnModelK(s);
  gfpnModelCache.set(s, result);
  return result;
}

/**
 * GetLongPathNameW expander: known 8.3 aliases only. A real vault named `Notes~1`
 * is not an alias and stays as-is. Existence is enforced by `glpnWin32Exists`
 * in the unified VM — missing paths fail like real Windows.
 */
const GLP_8_3_ALIASES: Readonly<Record<string, string>> = {
  'downlo~1': 'Downloads',
  'docume~1': 'Documents',
  'deskto~1': 'Desktop',
  'mythos~1': 'Mythos Writer',
  'mydesk~1': 'My Desktop',
  'progra~1': 'Program Files',
  'progra~2': 'Program Files (x86)',
  'appdat~1': 'AppData',
  'windo~1': 'Windows',
  'me~1': 'me',
  'evil~1': 'evil ',
  'evild~1': 'evil.',
  'evilt~1': 'evil\t',
  'deskto~2': 'Desktop ',
  'deskto~3': 'Desktop.',
  'deskto~4': 'Desktop\t',
  'vault~2': 'vault ',
  'vault~3': 'vault.',
  'aspc~1': 'a ',
  'rf7par~1': 'rf7-parent',
  'leafj~1': 'leaf-junc',
  // GetLongPathNameW of LONGDO~1 is the long-path constant leaf (required size > NSIS_MAX_STRLEN).
  // Literal 1024: this object is evaluated at module init; the vm↔traversal
  // import cycle can leave SIDECAR_NSIS_MAX_STRLEN undefined if vm loads first.
  'longdo~1': 'D'.repeat(1024),
};

const glpnModelCache = new Map<string, string>();

export function glpnModel(s: string): string {
  const hit = glpnModelCache.get(s);
  if (hit !== undefined) {
    return hit;
  }
  const folded = s.replace(/\//g, '\\');
  const result = folded
    .split('\\')
    .map((seg, i) => {
      if (i === 0) {
        return seg;
      }
      return GLP_8_3_ALIASES[seg.toLowerCase()] ?? seg;
    })
    .join('\\');
  glpnModelCache.set(s, result);
  return result;
}

/** GFPN-REF extras: final `.`/`..` without a trailing separator, plus trailing-dot/space names. */
export const GFPN_WIN32_W_MODEL_ROWS: readonly string[] = [
  'C:\\a\\b\\..',
  'C:\\a\\b\\.',
  'C:\\a\\b/..',
  'C:\\Users\\me\\Documents\\v\\..',
  'C:\\Users\\me\\Documents\\v\\.',
  'C:\\Users\\me\\Documents.',
  'C:\\Users\\me\\Documents ',
  'C:\\a\\b\\.. ',
  'C:\\a\\b\\...',
];

/** Canonical gate block, `mythos_canon_gate:` … `Goto mythos_nested_root_guard` (file :198–:213). */
const canonGateBlockFromGuardRegion = memoizeByArray((region): readonly string[] => {
  const start = region.findIndex((l) => l.trim() === 'mythos_canon_gate:');
  const end = region.findIndex((l, i) => i > start && l.trim() === 'Goto mythos_nested_root_guard');
  if (start < 0 || end <= start) {
    throw new Error('canonical gate block markers missing from sidecar guard region');
  }
  return region.slice(start, end + 1);
});

/**
 * A GetFullPathNameW failure injected into the gate (the model never fails on its own): `zero` is a
 * 0 return, `truncate` a return of buffer + 1. `call` names the source register (`$1` path, `$5` root).
 */
export type CanonGateFault = { call: '$1' | '$5'; ret: 'zero' | 'truncate' };

export type CanonGateOptions = {
  fault?: CanonGateFault;
  /**
   * Output registers as the failed call leaves them. Win32 leaves the buffer unspecified on failure,
   * so a fault row seeds an in-root path here: only the fail-closed `IntCmp` guards keep it unread.
   */
  $3?: string;
  $9?: string;
  /** As the allowlist leaves them: the `\` after the root and the child after it. */
  $4?: string;
  $6?: string;
};

/** What the script runs after the gate block (file :215–:222): delete, delete, read, delete, read, close. */
const CANON_GATE_CONTINUATION: readonly SidecarAllowlistDeleteOutcome[] = [
  'delete',
  'delete',
  'skip_delete',
  'delete',
  'skip_delete',
];

export const SIDECAR_CANON_GATE_STEP_LIMIT_ERROR = 'SIDECAR_CANON_GATE_STEP_LIMIT_EXCEEDED';

/**
 * GetFullPathNameW containment gate (file :198–:213), interpreted so System-return mutants are
 * modelled. `GetFullPathNameW(path/root)` → gfpnModel; fail closed on a 0 or truncated (≥ buffer)
 * return. Then require the resolved path to start with the resolved root plus a `\`, and be strictly
 * deeper. `StrCmp` is case-insensitive; a `StrCmpS` mutant folds case off. The registers start as
 * the allowlist leaves them ($3 = root length, $4 = the `\` after the root, $6 = the child).
 */
export function executeCanonGateBlock(
  blockLines: readonly string[],
  path: string,
  root: string,
  options: CanonGateOptions = {},
): SidecarAllowlistDeleteOutcome {
  const { labels, instrLines, instrOrdinal, lines, tokens } = decodeNsisBlock(blockLines);
  const reg: Record<string, string> = {
    $1: path,
    $5: root,
    $3: options.$3 ?? String(root.length),
    $4: options.$4 ?? '\\',
    $6: options.$6 ?? path.slice(root.length + 1),
    $8: '0',
    $9: options.$9 ?? '',
  };
  const value = (tok: string): string => {
    if (/^\$\d$/.test(tok)) {
      return reg[tok] ?? '';
    }
    if (tok === '${NSIS_MAX_STRLEN}') {
      return String(SIDECAR_CANON_GATE_MAX_STRLEN);
    }
    return tok.startsWith('"') ? parseStrCmpQuotedLiteral(tok) : tok;
  };
  let pc = 0;
  type Jump = SidecarAllowlistDeleteOutcome | number;
  const pastEnd = (k: number): SidecarAllowlistDeleteOutcome => CANON_GATE_CONTINUATION[k] ?? 'skip_delete';
  const jump = (target: string): Jump => {
    if (
      target === 'uninstall_vault_read' ||
      target === 'uninstall_vault_close' ||
      target === 'uninstall_vault_fallback' ||
      target === 'mythos_trim_chop'
    ) {
      return 'skip_delete';
    }
    if (
      target === 'uninstall_vault_do_delete' ||
      target === 'mythos_reparse_walk' ||
      target === 'mythos_nested_root_guard'
    ) {
      return 'delete';
    }
    if (target === 'mythos_comp_tail_scan') {
      return pc + 1;
    }
    const rel = target === '0' ? 1 : /^[+-]\d+$/.test(target) ? Number(target) : undefined;
    if (rel !== undefined) {
      const to = instrOrdinal.get(pc)! + rel;
      if (to < 0) {
        throw new Error(`canon-gate relative jump before the block: ${lines[pc]}`);
      }
      return to < instrLines.length ? instrLines[to]! : pastEnd(to - instrLines.length);
    }
    const at = labels.get(target);
    if (at === undefined) {
      throw new Error(`unknown canon-gate jump target: ${target}`);
    }
    return at;
  };
  const maxSteps = blockLines.length * 8 + 80;
  for (let step = 0; step < maxSteps; step += 1) {
    if (pc >= blockLines.length) {
      return pastEnd(0);
    }
    const line = lines[pc]!;
    const tk = tokens[pc]!;
    const op = tk[0];
    let j: Jump | undefined;
    if (/^\w+:$/.test(line) || op === 'Nop') {
      j = undefined;
    } else if (op === 'System::Call') {
      const gfpn = line.match(
        /^System::Call "kernel32::GetFullPathNameW\(w r(\d), i (\S+), w \.r(\d), p 0\) i \.r(\d)"$/,
      );
      const glpn = line.match(
        /^System::Call "kernel32::GetLongPathName(\w+)\(w r(\d), w \.r(\d), i (\S+)\) i \.r(\d)(?: \?e)?"$/,
      );
      if (gfpn) {
        const src = `$${gfpn[1]!}`;
        const size = nsisLeadingInt(value(gfpn[2]!));
        const ret = `$${gfpn[4]!}`;
        const fault = options.fault?.call === src ? options.fault.ret : undefined;
        const resolved = gfpnModel(reg[src] ?? '');
        if (resolved !== '') {
          reg[`$${gfpn[3]!}`] = resolved;
        }
        if (fault === 'zero' || resolved === '') {
          reg[ret] = '0';
        } else if (fault === 'truncate') {
          reg[ret] = String(size + 1);
        } else if (resolved.length >= size) {
          reg[ret] = String(resolved.length + 1);
        } else {
          reg[ret] = String(resolved.length);
        }
      } else if (glpn) {
        const expand = glpn[1] === 'W';
        const src = `$${glpn[2]!}`;
        const size = nsisLeadingInt(value(glpn[4]!));
        const ret = `$${glpn[5]!}`;
        const raw = reg[src] ?? '';
        const resolved = raw === '' ? '' : expand ? glpnModel(raw) : raw;
        if (resolved === '') {
          reg[`$${glpn[3]!}`] = '';
          reg[ret] = '0';
        } else if (resolved.length >= size) {
          reg[`$${glpn[3]!}`] = resolved;
          reg[ret] = String(resolved.length + 1);
        } else {
          reg[`$${glpn[3]!}`] = resolved;
          reg[ret] = String(resolved.length);
        }
      } else {
        throw new Error(`unsupported canon-gate System::Call: ${line}`);
      }
    } else if (op === 'Pop' && tk.length === 2) {
      j = undefined;
    } else if (op === 'IntCmp' && tk.length >= 4 && tk.length <= 6) {
      const a = nsisLeadingInt(value(tk[1]!));
      const b = nsisLeadingInt(value(tk[2]!));
      const target = a === b ? tk[3]! : a < b ? (tk[4] ?? '0') : (tk[5] ?? '0');
      j = jump(target);
    } else if (op === 'StrLen' && tk.length === 3 && /^\$\d$/.test(tk[1]!)) {
      reg[tk[1]!] = String(value(tk[2]!).length);
    } else if (op === 'StrCpy' && tk.length >= 3 && tk.length <= 5 && /^\$\d$/.test(tk[1]!)) {
      reg[tk[1]!] = nsisStrCpy(value(tk[2]!), tk[3] === undefined ? '' : value(tk[3]), tk[4] === undefined ? '' : value(tk[4]));
    } else if ((op === 'StrCmp' || op === 'StrCmpS') && (tk.length === 4 || tk.length === 5)) {
      const lhs = value(tk[1]!);
      const rhs = value(tk[2]!);
      const eq = op === 'StrCmpS' ? lhs === rhs : nsisStrEq(lhs, rhs);
      j = jump(eq ? tk[3]! : (tk[4] ?? '0'));
    } else if (op === 'Goto' && tk.length === 2) {
      j = jump(tk[1]!);
    } else {
      throw new Error(`unsupported canon-gate VM instruction: ${line}`);
    }
    if (j === undefined) {
      pc += 1;
    } else if (typeof j === 'number') {
      pc = j;
    } else {
      return j;
    }
  }
  throw new Error(SIDECAR_CANON_GATE_STEP_LIMIT_ERROR);
}

/** Allowlist root guards + the GetFullPathNameW canonical gate → final delete vs skip. */
function runSidecarCanonGateDisposition(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
): SidecarAllowlistDeleteOutcome {
  const detailed = executeSidecarAllowlistDeleteBlockDetailed(
    extractSidecarAllowlistDeleteLinesForVm(nsh),
    path,
    env,
  );
  if (detailed.outcome === 'skip_delete') {
    return 'skip_delete';
  }
  const region = extractSidecarGuardRegionForVm(nsh);
  return executeCanonGateBlock(canonGateBlockFromGuardRegion(region), path, detailed.$5, {
    $3: String(detailed.$3),
    $4: detailed.$4,
    $6: detailed.$6,
  });
}

function runAppDataM5VmFromNsh(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
): AppDataM5GuardOutcome {
  return allowlistDeleteToLegacyAppData(runSidecarAllowlistDeleteVmFromNsh(path, nsh, env));
}

export function locateDenyPrefixBlock(nsh: string): { start: number; end: number; lines: string[] } {
  const fileLines = nshFileLines(nsh);
  const travOkIdx = fileLines.findIndex((l) => l.trim() === DENY_PREFIX_BLOCK_ANCHOR_AFTER);
  if (travOkIdx < 0) {
    throw new Error(`${DENY_PREFIX_BLOCK_ANCHOR_AFTER} missing before deny-prefix block`);
  }
  const start = fileLines.findIndex((l, i) => i > travOkIdx && l === DENY_PREFIX_BLOCK_START_LINE);
  const appdata = fileLines.findIndex((l, i) => i > start && l === DENY_PREFIX_BLOCK_END_LINE);
  if (start < 0 || appdata <= start) {
    throw new Error('deny-prefix block ($WINDIR..$PROGRAMFILES64) missing in uninstall nsh');
  }
  const end = appdata - 1;
  const lines = fileLines.slice(start, end + 1);
  if (lines.length !== CANONICAL_DENY_PREFIX_BLOCK.length) {
    throw new Error(
      `deny-prefix block length ${lines.length} != canonical ${CANONICAL_DENY_PREFIX_BLOCK.length}`,
    );
  }
  return { start, end, lines };
}

export function extractDenyPrefixBlockLines(nsh: string): string[] {
  return locateDenyPrefixBlock(nsh).lines;
}

export function spliceDenyPrefixBlock(nsh: string, blockLines: string[]): string {
  const { start, end } = locateDenyPrefixBlock(nsh);
  const fileLines = nshFileLines(nsh);
  return [...fileLines.slice(0, start), ...blockLines, ...fileLines.slice(end + 1)].join('\n');
}

export function replaceDenyPrefixBlockLineByExact(
  nsh: string,
  exactLine: string,
  newLine: string,
  occurrence = 0,
): string {
  const { lines } = locateDenyPrefixBlock(nsh);
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === exactLine) {
      seen += 1;
      if (seen === occurrence) {
        const next = [...lines];
        next[i] = newLine;
        return spliceDenyPrefixBlock(nsh, next);
      }
    }
  }
  throw new Error(`deny-prefix line not found (occurrence ${occurrence}): ${exactLine}`);
}

export function assertDenyPrefixBlockExact(nsh: string): void {
  assertSidecarGuardRegionExact(nsh);
}

export const APPDATA_M5_REJECT_PATHS: readonly string[] = [
  'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer',
];

/** Prefix match with backslash at $5 length and non-empty tail (Mythos APPDATA subtree delete). */
export const APPDATA_M5_PREFIX_BACKSLASH_TAIL_PATH =
  'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x';

/** Same offset backslash as Mythos APPDATA root, but prefix mismatch (:105 gate; must not delete). */
export const APPDATA_OFFSET_BACKSLASH_NON_MYTHOS_PATH =
  'C:\\Users\\me\\AppData\\Roaming\\SomeOtherApp1\\stuff';

export const DOCUMENTS_VAULT_DELETE_PATH = 'C:\\Users\\me\\Documents\\MyVault\\x';
export const DESKTOP_VAULT_DELETE_PATH = 'C:\\Users\\me\\Desktop\\MyVault\\x';
export const DOWNLOADS_VAULT_DELETE_PATH = 'C:\\Users\\me\\Downloads\\MyVault\\x';

export const APPDATA_M5_ALLOW_PATHS: readonly string[] = [
  'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
];

/** Isolated deny-gate paths (H-3): each row exercises one StrLen/StrCpy/StrCmp triplet. */
export const DENY_PREFIX_WINDIR_GATE_REJECT_PATH = 'C:\\Windows\\System32\\drivers';
export const DENY_PREFIX_PROGRAMFILES_GATE_REJECT_PATH = 'C:\\Program Files (x86)\\Mythos\\bin';
export const DENY_PREFIX_PROGRAMFILES64_GATE_REJECT_PATH = 'C:\\Program Files\\Mythos\\bin';

export const DENY_PREFIX_REJECT_PATHS: readonly string[] = [
  'C:\\Windows',
  'C:\\Windows\\System32',
  DENY_PREFIX_WINDIR_GATE_REJECT_PATH,
  'C:\\WINDO~1\\System32',
  'C:\\Program Files\\Foo',
  DENY_PREFIX_PROGRAMFILES_GATE_REJECT_PATH,
  'C:\\PROGRA~2\\Mythos\\bin',
  'C:\\Program Files (x86)\\Bar',
  DENY_PREFIX_PROGRAMFILES64_GATE_REJECT_PATH,
  'C:\\PROGRA~1\\Mythos\\bin',
];

export const DENY_PREFIX_ALLOW_PATHS: readonly string[] = ['C:\\Users\\vault'];

const DENY_PREFIX_LINE_EXPAND_COUNT = 11;
  const DENY_PREFIX_GATE_LINE_COUNT = 15;

function denyPrefixGateBlock(nsh: string, gateIndex: 0 | 1 | 2): readonly string[] {
  const deny = denyBlockFromGuardRegion(extractSidecarGuardRegionForVm(nsh));
  const expand = deny.slice(0, DENY_PREFIX_LINE_EXPAND_COUNT);
  const start = DENY_PREFIX_LINE_EXPAND_COUNT + gateIndex * DENY_PREFIX_GATE_LINE_COUNT;
  return [...expand, ...deny.slice(start, start + DENY_PREFIX_GATE_LINE_COUNT)];
}

function runDenyPrefixGateVmFromNsh(
  path: string,
  nsh: string,
  gateIndex: 0 | 1 | 2,
  env: SidecarNsisVarEnv,
): DenyPrefixOutcome {
  return executeDenyPrefixBlock(denyPrefixGateBlock(nsh, gateIndex), path, env);
}

export function assertDenyPrefixRejectAllowTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const path of DENY_PREFIX_REJECT_PATHS) {
    if (runTraversalVmFromNsh(path, nsh) !== 'trav_ok') {
      throw new Error(`deny-prefix table path must pass traversal first: ${JSON.stringify(path)}`);
    }
    const outcome = runDenyPrefixVmFromNsh(path, nsh, env);
    if (outcome !== 'vault_read') {
      throw new Error(`expected vault_read for deny-prefix path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  const gateRows: ReadonlyArray<{ gate: 0 | 1 | 2; path: string }> = [
    { gate: 0, path: DENY_PREFIX_WINDIR_GATE_REJECT_PATH },
    { gate: 1, path: DENY_PREFIX_PROGRAMFILES_GATE_REJECT_PATH },
    { gate: 2, path: DENY_PREFIX_PROGRAMFILES64_GATE_REJECT_PATH },
  ];
  for (const { gate, path } of gateRows) {
    const outcome = runDenyPrefixGateVmFromNsh(path, nsh, gate, env);
    if (outcome !== 'vault_read') {
      throw new Error(
        `expected vault_read for deny-prefix gate ${gate} path ${JSON.stringify(path)}, got ${outcome}`,
      );
    }
  }
  for (const path of DENY_PREFIX_ALLOW_PATHS) {
    if (runTraversalVmFromNsh(path, nsh) !== 'trav_ok') {
      throw new Error(`deny-prefix allow path must pass traversal first: ${JSON.stringify(path)}`);
    }
    const outcome = runDenyPrefixVmFromNsh(path, nsh, env);
    if (outcome !== 'allowlist_continue') {
      throw new Error(
        `expected allowlist_continue for deny-prefix path ${JSON.stringify(path)}, got ${outcome}`,
      );
    }
  }
}

function runSidecarPathAllowlistDeleteDisposition(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
): SidecarAllowlistDeleteOutcome | 'blocked_at_guard' {
  const region = extractSidecarGuardRegionForVm(nsh);
  const travBlock = travBlockFromGuardRegion(region);
  const { disposition } = runSidecarReadLineDeleteDisposition(
    path,
    nsh,
    env,
    { $7: 0, $8: 0 },
    travBlock,
  );
  return disposition;
}

/** Scan-block line where execution continues after the read-trim block leaves through `exit`. */
function sidecarTravEntryPc(travBlock: readonly string[], exit: SidecarReadTrimExit): number {
  if ('label' in exit) {
    const at = traversalBlockLabels(travBlock).get(exit.label);
    if (at === undefined) {
      throw new Error(`read-trim exit to a label outside the scan block: ${exit.label}`);
    }
    return at;
  }
  let seen = 0;
  for (let i = 0; i < travBlock.length; i += 1) {
    if (/^\w+:$/.test(travBlock[i]!.trim())) {
      continue;
    }
    if (seen === exit.instr) {
      return i;
    }
    seen += 1;
  }
  throw new Error(`read-trim exit ${exit.instr} instructions past the block lands outside the scan block`);
}

function runSidecarReadLineDeleteDisposition(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv,
  travRegs: TravScanRegs,
  travBlock: readonly string[],
  $2 = '',
  entry: { startPc: number; $4: string } = { startPc: 0, $4: '' },
): { disposition: SidecarAllowlistDeleteOutcome | 'blocked_at_guard'; travRegs: TravScanRegs } {
  const { outcome: travOutcome, regs } = executeTraversalScanBlockStateful(travBlock, path, travRegs, {
    $2,
    $4: entry.$4,
    startPc: entry.startPc,
  });
  if (travOutcome === 'vault_read') {
    return { disposition: 'blocked_at_guard', travRegs: regs };
  }
  if (travOutcome !== 'trav_ok') {
    throw new Error(`path must reach trav_ok before allowlist: ${JSON.stringify(path)}`);
  }
  if (runDenyPrefixVmFromNsh(path, nsh, env) === 'vault_read') {
    return { disposition: 'blocked_at_guard', travRegs: regs };
  }
  return {
    disposition: runSidecarCanonGateDisposition(path, nsh, env),
    travRegs: regs,
  };
}

export function assertSidecarAllowlistDeleteTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  const rows: ReadonlyArray<{ path: string; expected: SidecarAllowlistDeleteOutcome }> = [
    { path: APPDATA_M5_REJECT_PATHS[0]!, expected: 'skip_delete' },
    { path: APPDATA_OFFSET_BACKSLASH_NON_MYTHOS_PATH, expected: 'skip_delete' },
    { path: APPDATA_M5_PREFIX_BACKSLASH_TAIL_PATH, expected: 'delete' },
    { path: DOCUMENTS_VAULT_DELETE_PATH, expected: 'delete' },
    { path: DESKTOP_VAULT_DELETE_PATH, expected: 'delete' },
    { path: DOWNLOADS_VAULT_DELETE_PATH, expected: 'delete' },
    { path: 'C:\\Users\\me\\Documents\\My Vault\\x', expected: 'delete' },
    { path: 'C:\\Users\\me\\Documents\\My Vault\\notes', expected: 'delete' },
    { path: 'C:\\Users\\me\\Documents\\a.b.c', expected: 'delete' },
    { path: 'C:\\Users\\me\\Documents\\v 1.2\\x', expected: 'delete' },
    { path: 'C:\\Users\\me\\Documents\\v1.2\\notes', expected: 'delete' },
    ...TRAVERSAL_ALLOW_SEGMENT_TAIL_DELETE_PATHS.map((path) => ({ path, expected: 'delete' as const })),
    ...TRAVERSAL_ALLOW_DOT_LETTER_DELETE_PATHS.map((path) => ({ path, expected: 'delete' as const })),
  ];
  for (const { path, expected } of rows) {
    const disposition = runSidecarPathAllowlistDeleteDisposition(path, nsh, env);
    if (disposition === 'blocked_at_guard') {
      throw new Error(`allowlist/delete path blocked at guard: ${JSON.stringify(path)}`);
    }
    if (disposition !== expected) {
      throw new Error(
        `allowlist/delete expected ${expected} for ${JSON.stringify(path)}, got ${disposition}`,
      );
    }
  }
  for (const path of APPDATA_M5_ALLOW_PATHS) {
    const disposition = runSidecarPathAllowlistDeleteDisposition(path, nsh, env);
    if (disposition === 'blocked_at_guard') {
      throw new Error(`APPDATA allow path blocked at guard: ${JSON.stringify(path)}`);
    }
    if (disposition !== 'delete') {
      throw new Error(`expected delete for APPDATA allow path ${JSON.stringify(path)}, got ${disposition}`);
    }
  }
}

export function assertAppDataM5RejectAllowTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  assertSidecarAllowlistDeleteTables(nsh, env);
}

export type SidecarGuardPathOutcome = 'vault_read' | 'allowlist_continue';

export function runSidecarGuardOutcomeOnPath(
  path: string,
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): SidecarGuardPathOutcome {
  const trav = runTraversalVmFromNsh(path, nsh);
  if (trav === 'vault_read') {
    return 'vault_read';
  }
  if (trav !== 'trav_ok') {
    throw new Error(`guard path must reach trav_ok before deny, got ${trav}: ${JSON.stringify(path)}`);
  }
  if (runDenyPrefixVmFromNsh(path, nsh, env) === 'vault_read') {
    return 'vault_read';
  }
  const disposition = runSidecarPathAllowlistDeleteDisposition(path, nsh, env);
  if (disposition === 'blocked_at_guard') {
    return 'vault_read';
  }
  return 'allowlist_continue';
}

function parseNsisDollarEscape(quoted: string): string {
  if (quoted === '$\\n' || quoted === '"$\\n"') {
    return '\n';
  }
  if (quoted === '$\\r' || quoted === '"$\\r"') {
    return '\r';
  }
  if (quoted === '$\\t' || quoted === '"$\\t"') {
    return '\t';
  }
  return parseStrCmpQuotedLiteral(quoted.startsWith('"') ? quoted : `"${quoted}"`);
}

/**
 * Where execution leaves the read-trim block for the scan block that follows it: `instr` counts NSIS
 * instructions past the block's end (0 = the `StrCpy $7 0` reset), `label` names a scan-block label.
 */
export type SidecarReadTrimExit = { instr: number } | { label: string };

export type SidecarReadTrimResult = {
  /** `'empty'` = the line is skipped (empty after the trim, or rejected for a control char < 0x20). */
  trimmed: 'empty' | string;
  /**
   * True when execution leaves the block anywhere but the `StrCpy $7 0` reset right after it. Landing
   * on the reset still runs it; landing beyond it skips it in the real monolithic script, so $7
   * carries over into the next line's scan.
   */
  resetSkipped: boolean;
  exit: SidecarReadTrimExit;
  /** $2 as the trim leaves it (the last char examined); still live when the scan starts. */
  $2: string;
  /** $4 as the control-char check leaves it (`StrPBrkW` result); still live when the scan starts. */
  $4: string;
};

export const SIDECAR_READ_TRIM_STEP_LIMIT_ERROR = 'SIDECAR_READ_TRIM_STEP_LIMIT_EXCEEDED';

export const SIDECAR_SYSTEM_PLUGIN_FAULT_ERROR = 'SIDECAR_SYSTEM_PLUGIN_FAULT';

type SidecarSystemPluginState = {
  stack: string[];
  /** `System::Alloc` buffers by handle: zero-filled WCHARs (GlobalAlloc GPTR) until a struct fill. */
  heap: Map<string, { bytes: number; wchars: number[]; freed: boolean }>;
};

/**
 * The System-plugin calls of the control-char check (file :57–:61): `Alloc` pushes a zeroed buffer,
 * `Pop` takes it (an empty stack leaves the register as it was), the struct fill writes the 0x01..0x1F
 * set, `StrPBrkW` returns non-zero when the path has a char from that set, `Free` releases it. Writing
 * through a register that is not a live buffer, or past its end, is a crash, modelled as a throw.
 */
function runSidecarSystemPluginOp(
  line: string,
  tk: readonly string[],
  regs: Record<string, string>,
  system: SidecarSystemPluginState,
): void {
  const fault = (why: string): never => {
    throw new Error(`${SIDECAR_SYSTEM_PLUGIN_FAULT_ERROR}: ${why}: ${line}`);
  };
  const live = (reg: string) => {
    const buf = system.heap.get(regs[reg] ?? '');
    return buf === undefined || buf.freed ? fault(`${reg} is not a live buffer`) : buf;
  };
  if (tk[0] === 'System::Alloc' && tk.length === 2) {
    const handle = `@buffer${system.heap.size}`;
    system.heap.set(handle, { bytes: nsisLeadingInt(tk[1]!), wchars: [], freed: false });
    system.stack.push(handle);
    return;
  }
  if (tk[0] === 'Pop' && tk.length === 2 && /^\$\d$/.test(tk[1]!)) {
    const top = system.stack.pop();
    if (top !== undefined) {
      regs[tk[1]!] = top;
    }
    return;
  }
  if (tk[0] === 'System::Free' && tk.length === 2 && /^\$\d$/.test(tk[1]!)) {
    live(tk[1]!).freed = true;
    return;
  }
  const fill = line.match(/^System::Call "\*\$(\d)\(((?:&i2 \d+,)*&i2 \d+)\)"$/);
  if (fill) {
    const buf = live(`$${fill[1]!}`);
    const wchars = fill[2]!.split(',').map((item) => Number(item.slice('&i2 '.length)));
    if (wchars.length * 2 > buf.bytes) {
      fault('struct fill overruns the buffer');
    }
    buf.wchars = wchars;
    return;
  }
  const pbrk = line.match(/^System::Call "shlwapi::StrPBrkW\(w r(\d), p r(\d)\) p \.r(\d)"$/);
  if (pbrk) {
    const buf = live(`$${pbrk[2]!}`);
    const end = buf.wchars.indexOf(0);
    const set = new Set(end < 0 ? buf.wchars : buf.wchars.slice(0, end));
    const text = regs[`$${pbrk[1]!}`] ?? '';
    let found = false;
    for (let i = 0; i < text.length && !found; i += 1) {
      found = set.has(text.charCodeAt(i));
    }
    regs[`$${pbrk[3]!}`] = found ? '1' : '0';
    return;
  }
  throw new Error(`unsupported read-trim VM instruction: ${line}`);
}

/**
 * FileRead + RF-6 CR/LF loop-strip + empty check + control-char reject (file :43–:64), interpreted
 * line by line so a mutated block is modelled (not refused). `shlwapi::StrPBrkW` over the 0x01..0x1F
 * set is modelled as "contains any char below 0x20"; the System buffer build / free are no-ops.
 */
const decodeNsisBlock = memoizeByArray((blockLines) => {
  const labels = new Map<string, number>();
  // NSIS relative jumps (`+N`) count instructions; label-only lines are not instructions.
  // `label: instruction` (NSIS one-line form) is both a label and an instruction.
  const instrLines: number[] = [];
  const instrOrdinal = new Map<number, number>();
  const lines = blockLines.map((raw) => raw.trim());
  const tokens: string[][] = [];
  lines.forEach((line, i) => {
    const labeled = line.match(/^(\w+):\s*(.*)$/);
    if (labeled && !labeled[2].startsWith(':')) {
      labels.set(labeled[1]!, i);
      if (labeled[2] === '') {
        tokens.push(line.match(/"[^"]*"|\S+/g) ?? []);
        return;
      }
      tokens.push(labeled[2].match(/"[^"]*"|\S+/g) ?? []);
      instrOrdinal.set(i, instrLines.length);
      instrLines.push(i);
      return;
    }
    tokens.push(line.match(/"[^"]*"|\S+/g) ?? []);
    instrOrdinal.set(i, instrLines.length);
    instrLines.push(i);
  });
  return { labels, instrLines, instrOrdinal, lines, tokens };
});

export function runSidecarReadTrimWithReset(
  blockLines: readonly string[],
  lineContent: string,
): SidecarReadTrimResult {
  const { labels, instrLines, instrOrdinal, lines, tokens } = decodeNsisBlock(blockLines);
  const regs: Record<string, string> = { $1: lineContent };
  const system: SidecarSystemPluginState = { stack: [], heap: new Map() };
  let pc = 0;
  let exit: SidecarReadTrimExit = { instr: 0 };
  const skipped = (): SidecarReadTrimResult => ({
    trimmed: 'empty',
    resetSkipped: false,
    exit: { instr: 0 },
    $2: regs.$2 ?? '',
    $4: regs.$4 ?? '',
  });
  const done = (): SidecarReadTrimResult => ({
    trimmed: (regs.$1 ?? '') === '' ? 'empty' : regs.$1!,
    resetSkipped: !('instr' in exit && exit.instr === 0),
    exit,
    $2: regs.$2 ?? '',
    $4: regs.$4 ?? '',
  });
  type Jump = 'skip' | 'exit' | number;
  const leave = (to: SidecarReadTrimExit): Jump => {
    exit = to;
    return 'exit';
  };
  const relative = (offset: number): Jump => {
    const from = instrOrdinal.get(pc);
    if (from === undefined) {
      throw new Error(`read-trim VM relative jump from a non-instruction line: ${blockLines[pc]}`);
    }
    const to = from + offset;
    if (to < 0) {
      throw new Error(`read-trim VM relative jump before the block: ${blockLines[pc]}`);
    }
    return to < instrLines.length ? instrLines[to]! : leave({ instr: to - instrLines.length });
  };
  const jump = (target: string): Jump => {
    if (
      target === 'uninstall_vault_read' ||
      target === 'uninstall_vault_close' ||
      target === 'uninstall_vault_fallback'
    ) {
      return 'skip';
    }
    if (target === '0') {
      return relative(1);
    }
    const rel = target.match(/^([+-])(\d+)$/);
    if (rel) {
      return relative((rel[1] === '-' ? -1 : 1) * Number(rel[2]));
    }
    const at = labels.get(target);
    return at === undefined ? leave({ label: target }) : at;
  };
  const maxSteps = (lineContent.length + 8) * 40 + 400;
  for (let step = 0; step < maxSteps; step += 1) {
    if (pc < 0) {
      throw new Error(`read-trim VM pc out of range: ${pc}`);
    }
    if (pc >= blockLines.length) {
      return done();
    }
    const line = lines[pc]!;
    const tk = tokens[pc]!;
    const op = tk[0];
    if (
      /^\w+:$/.test(line) ||
      op === 'ClearErrors' ||
      op === 'Nop' ||
      // The error flag is only raised by FileRead at EOF, which never reaches this block.
      op === 'IfErrors' ||
      line === 'FileRead $0 $1'
    ) {
      pc += 1;
      continue;
    }
    if (op === 'System::Alloc' || op === 'Pop' || op === 'System::Free' || op === 'System::Call') {
      runSidecarSystemPluginOp(line, tk, regs, system);
      pc += 1;
      continue;
    }
    const value = (token: string | undefined): string =>
      token === undefined ? '' : /^\$\d$/.test(token) ? (regs[token] ?? '') : parseNsisDollarEscape(token);
    let j: Jump | undefined;
    if (op === 'Goto' && tk.length === 2) {
      j = jump(tk[1]!);
    } else if (op === 'StrCmp' && (tk.length === 4 || tk.length === 5)) {
      if (nsisStrEq(value(tk[1]), value(tk[2]))) {
        j = jump(tk[3]!);
      } else if (tk.length === 5) {
        j = jump(tk[4]!);
      }
    } else if (op === 'StrCpy' && tk.length >= 3 && tk.length <= 5 && /^\$\d$/.test(tk[1]!)) {
      regs[tk[1]!] = nsisStrCpy(value(tk[2]), tk[3] === undefined ? '' : value(tk[3]), value(tk[4]));
    } else {
      throw new Error(`unsupported read-trim VM instruction: ${line}`);
    }
    if (j === undefined) {
      pc += 1;
      continue;
    }
    if (j === 'skip') {
      return skipped();
    }
    if (j === 'exit') {
      return done();
    }
    pc = j;
  }
  throw new Error(SIDECAR_READ_TRIM_STEP_LIMIT_ERROR);
}

/** Leading integer of an NSIS numeric argument (`""` and non-numbers are 0). */
function nsisLeadingInt(text: string): number {
  const m = text.match(/^-?\d+/);
  return m ? Number(m[0]) : 0;
}

/** NSIS `StrCpy dst src [maxlen] [offset]`: a negative offset counts from the end, a negative maxlen cuts from the end. */
function nsisStrCpy(src: string, maxLen: string, offset: string): string {
  let start = nsisLeadingInt(offset);
  if (start < 0) {
    start = Math.max(0, src.length + start);
  }
  const rest = start <= src.length ? src.slice(start) : '';
  if (maxLen === '') {
    return rest;
  }
  const n = nsisLeadingInt(maxLen);
  return n >= 0 ? rest.slice(0, n) : rest.slice(0, Math.max(0, rest.length + n));
}

/** FileRead + RF-6 trim loop + control-char reject for one simulated sidecar line. */
export function executeSidecarReadTrimFromLineContent(
  blockLines: readonly string[],
  lineContent: string,
): 'empty' | string {
  return runSidecarReadTrimWithReset(blockLines, lineContent).trimmed;
}

/** Execute FileRead + trim chain for one simulated sidecar line. */
export function executeSidecarReadTrimBlock(
  blockLines: readonly string[],
  simulatedFileReadLine: string,
): 'empty' | string {
  return executeSidecarReadTrimFromLineContent(blockLines, simulatedFileReadLine);
}

export const SIDECAR_READ_TRIM_EXACT_STRING_ROWS: readonly { raw: string; trimmed: string }[] = [
  { raw: 'C:\\vault\\a\r\n', trimmed: 'C:\\vault\\a' },
  { raw: 'C:\\vault\\b\n', trimmed: 'C:\\vault\\b' },
  { raw: 'C:\\Users\\me\\vault1', trimmed: 'C:\\Users\\me\\vault1' },
  { raw: 'C:\\vault\\c\r', trimmed: 'C:\\vault\\c' },
];

export const SIDECAR_READ_LOOP_STEP_LIMIT = 100_000;

export const SIDECAR_DELETE_READ_LOOP_ROWS: readonly {
  rawLines: readonly string[];
  expectedDeleted: readonly string[];
  expectClosed: boolean;
}[] = [
  {
    rawLines: [
      `${DOCUMENTS_VAULT_DELETE_PATH}\r\n`,
      `${DESKTOP_VAULT_DELETE_PATH}\n`,
      'C:\\Users\\me\\Documents\\vault1',
    ],
    expectedDeleted: [
      DOCUMENTS_VAULT_DELETE_PATH,
      DESKTOP_VAULT_DELETE_PATH,
      'C:\\Users\\me\\Documents\\vault1',
    ],
    expectClosed: true,
  },
  {
    rawLines: [
      'C:\\Users\\me\\Documents\\note.txt\r\n',
      'C:\\Users\\me\\Documents\\vault\r\n',
    ],
    expectedDeleted: ['C:\\Users\\me\\Documents\\note.txt', 'C:\\Users\\me\\Documents\\vault'],
    expectClosed: true,
  },
  {
    rawLines: [
      'C:\\Users\\me\\Documents\\MyVault\\child\r\n',
      'C:\\Users\\me\\Documents\\MyVault\r\n',
    ],
    expectedDeleted: [
      'C:\\Users\\me\\Documents\\MyVault\\child',
      'C:\\Users\\me\\Documents\\MyVault',
    ],
    expectClosed: true,
  },
  {
    rawLines: [
      `${DOCUMENTS_VAULT_DELETE_PATH}\r`,
      'C:\\Users\\me\\Documents\\..\\..\\Windows\r',
      `${DOWNLOADS_VAULT_DELETE_PATH}\r`,
    ],
    expectedDeleted: [DOCUMENTS_VAULT_DELETE_PATH, DOWNLOADS_VAULT_DELETE_PATH],
    expectClosed: true,
  },
  // LF-only / unterminated lines ending in a separator after a `.a` / `..a` segment. With no `\r`
  // the trim leaves $2 = the path's last char while the scan runs, so a scan check retargeted from
  // $4 to $2 (:72/:73, :78/:79, :98/:99, :104/:105) hits that separator and refuses a valid name.
  {
    rawLines: [
      'C:\\Users\\me\\Documents\\v\\.a\\\n',
      'C:\\Users\\me\\Documents\\v\\.a/\n',
      'C:\\Users\\me\\Documents\\v\\..a\\\n',
      'C:\\Users\\me\\Documents\\v\\..a/\n',
      'C:\\Users\\me\\Documents\\v/.a/\n',
      'C:\\Users\\me\\Documents\\v/.a\\\n',
      'C:\\Users\\me\\Documents\\v/..a/\n',
      'C:\\Users\\me\\Documents\\v/..a\\',
    ],
    expectedDeleted: [
      'C:\\Users\\me\\Documents\\v\\.a',
      'C:\\Users\\me\\Documents\\v\\.a',
      'C:\\Users\\me\\Documents\\v\\..a',
      'C:\\Users\\me\\Documents\\v\\..a',
      'C:\\Users\\me\\Documents\\v\\.a',
      'C:\\Users\\me\\Documents\\v\\.a',
      'C:\\Users\\me\\Documents\\v\\..a',
      'C:\\Users\\me\\Documents\\v\\..a',
    ],
    expectClosed: true,
  },
  // Empty / control-char line then a valid delete: :47/:56 retarget to close drops the
  // second line, and :47/:56 → do_delete inserts an empty-path delete.
  {
    rawLines: ['\r\n', `${DOCUMENTS_VAULT_DELETE_PATH}\r\n`],
    expectedDeleted: [DOCUMENTS_VAULT_DELETE_PATH],
    expectClosed: true,
  },
  {
    rawLines: ['\n', `${DOCUMENTS_VAULT_DELETE_PATH}\r\n`],
    expectedDeleted: [DOCUMENTS_VAULT_DELETE_PATH],
    expectClosed: true,
  },
  {
    rawLines: [`C:\\Users\\me\\Documents\\a\u0001b\r\n`, `${DOCUMENTS_VAULT_DELETE_PATH}\r\n`],
    expectedDeleted: [DOCUMENTS_VAULT_DELETE_PATH],
    expectClosed: true,
  },
];

type SidecarDeleteLoopSim = {
  deleted: string[];
  acts: ReadonlyArray<{ op: 'RMDir' | 'Delete'; path: string }>;
  closed: boolean;
  steps: number;
  fileClosed: boolean;
  sidecarDeleted: boolean;
  hung: boolean;
};

type CachedDeleteLoopSim = { kind: 'ok'; value: SidecarDeleteLoopSim } | { kind: 'throw'; message: string };

/**
 * Mode-2 resimulates the same canonical nsh on every mutant. Cache only registered
 * canonical nsh outcomes (never mutants), keyed by sha + JSON row. Bounded LRU;
 * returned `deleted`/`acts` are copies. Same rows and comparisons — not a weaken.
 */
const SIDECAR_DELETE_LOOP_SIM_CACHE_MAX = 8192;
const SIDECAR_DELETE_LOOP_SIM_CACHE = new Map<string, CachedDeleteLoopSim>();
const CANONICAL_SWEEP_NSH_HASHES = new Set<string>();

let deleteLoopHashA: { nsh: string; hash: string } | undefined;
let deleteLoopHashB: { nsh: string; hash: string } | undefined;

function sidecarDeleteLoopNshHash(nsh: string): string {
  if (deleteLoopHashA?.nsh === nsh) {
    return deleteLoopHashA.hash;
  }
  if (deleteLoopHashB?.nsh === nsh) {
    return deleteLoopHashB.hash;
  }
  const hash = createHash('sha256').update(nsh).digest('hex');
  deleteLoopHashB = deleteLoopHashA;
  deleteLoopHashA = { nsh, hash };
  return hash;
}

/** Mark `nsh` as the canonical sidecar program so mode-2 may memoize its row outcomes. */
export function registerCanonicalSweepNsh(nsh: string): void {
  CANONICAL_SWEEP_NSH_HASHES.add(sidecarDeleteLoopNshHash(nsh));
}

function isCanonicalSweepNsh(nsh: string): boolean {
  return CANONICAL_SWEEP_NSH_HASHES.has(sidecarDeleteLoopNshHash(nsh));
}

function copyDeleteLoopSim(value: SidecarDeleteLoopSim): SidecarDeleteLoopSim {
  return {
    deleted: [...value.deleted],
    acts: value.acts.map((act) => ({ op: act.op, path: act.path })),
    closed: value.closed,
    steps: value.steps,
    fileClosed: value.fileClosed,
    sidecarDeleted: value.sidecarDeleted,
    hung: value.hung,
  };
}

function sidecarDeleteLoopSimCacheKey(
  nsh: string,
  rawLines: readonly string[],
  env: SidecarNsisVarEnv,
  options: Omit<SidecarNsisRunOptions, 'env'>,
): string {
  return `${sidecarDeleteLoopNshHash(nsh)}\n${JSON.stringify(rawLines)}\n${JSON.stringify(env)}\n${JSON.stringify(options)}`;
}

function rememberDeleteLoopSim(key: string, entry: CachedDeleteLoopSim): void {
  if (SIDECAR_DELETE_LOOP_SIM_CACHE.size >= SIDECAR_DELETE_LOOP_SIM_CACHE_MAX) {
    const oldest = SIDECAR_DELETE_LOOP_SIM_CACHE.keys().next().value;
    if (oldest !== undefined) {
      SIDECAR_DELETE_LOOP_SIM_CACHE.delete(oldest);
    }
  }
  SIDECAR_DELETE_LOOP_SIM_CACHE.set(key, entry);
}

export function simulateSidecarDeleteReadLoop(
  nsh: string,
  rawLines: readonly string[],
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
  options: Omit<SidecarNsisRunOptions, 'env'> = {},
): SidecarDeleteLoopSim {
  const cacheable = isCanonicalSweepNsh(nsh);
  const key = cacheable ? sidecarDeleteLoopSimCacheKey(nsh, rawLines, env, options) : '';
  if (cacheable) {
    const hit = SIDECAR_DELETE_LOOP_SIM_CACHE.get(key);
    if (hit !== undefined) {
      if (hit.kind === 'throw') {
        throw new Error(hit.message);
      }
      return copyDeleteLoopSim(hit.value);
    }
  }
  try {
    const run = runSidecarNsisProgram(nsh, rawLines, { ...options, env });
    if (run.hung) {
      if (cacheable) {
        rememberDeleteLoopSim(key, { kind: 'throw', message: SIDECAR_LINE_STEP_LIMIT_ERROR });
      }
      throw new Error(SIDECAR_LINE_STEP_LIMIT_ERROR);
    }
    const value: SidecarDeleteLoopSim = {
      deleted: run.deleted,
      acts: run.acts,
      closed: run.fileClosed,
      steps: run.steps,
      fileClosed: run.fileClosed,
      sidecarDeleted: run.sidecarDeleted,
      hung: run.hung,
    };
    if (cacheable) {
      rememberDeleteLoopSim(key, { kind: 'ok', value: copyDeleteLoopSim(value) });
    }
    return cacheable ? copyDeleteLoopSim(value) : value;
  } catch (err) {
    if (cacheable && !SIDECAR_DELETE_LOOP_SIM_CACHE.has(key)) {
      rememberDeleteLoopSim(key, {
        kind: 'throw',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export type SidecarReadTrimGuardExpectation = 'empty' | SidecarGuardPathOutcome;

export const SIDECAR_READ_TRIM_GUARD_ROWS: readonly {
  raw: string;
  expected: SidecarReadTrimGuardExpectation;
}[] = [
  { raw: '\r\n', expected: 'empty' },
  { raw: '\n', expected: 'empty' },
  { raw: '\r', expected: 'empty' },
  { raw: 'C:\\Users\\me\\Documents\\vault\\..\r\n', expected: 'vault_read' },
  { raw: 'C:\\Users\\me\\Documents\\vault\\..\n', expected: 'vault_read' },
  { raw: 'C:\\Users\\me\\Documents\\vault\\..\r', expected: 'vault_read' },
  { raw: 'C:\\vault\\.\r\n', expected: 'vault_read' },
  { raw: 'C:\\vault\\..\r\n', expected: 'vault_read' },
  { raw: 'C:/vault/../note\r\n', expected: 'vault_read' },
  { raw: 'C:\\Users\\vault\r\n', expected: 'allowlist_continue' },
  { raw: 'C:\\Users\\vault\\note\n', expected: 'allowlist_continue' },
  { raw: 'C:\\a\\.hidden\\x\r\n', expected: 'allowlist_continue' },
  { raw: 'C:/v1.2/x\r\n', expected: 'allowlist_continue' },
];

/** Simulate sidecar read loop with persistent $7/$8 across non-empty lines (NSIS :53 carry-over). */
export function runSidecarMultilineGuardOutcome(
  nsh: string,
  rawLines: readonly string[],
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): SidecarGuardPathOutcome {
  const region = extractSidecarGuardRegionForVm(nsh);
  const readBlock = readTrimBlockFromGuardRegion(region);
  const travBlock = travBlockFromGuardRegion(region);
  let travRegs: TravScanRegs = { $7: 0, $8: 0 };
  let lastOutcome: SidecarGuardPathOutcome = 'allowlist_continue';
  for (const raw of rawLines) {
    const { trimmed, exit, $2, $4 } = runSidecarReadTrimWithReset(readBlock, raw);
    if (trimmed === 'empty') {
      continue;
    }
    const path = trimmed;
    const { outcome: travOutcome, regs } = executeTraversalScanBlockStateful(travBlock, path, travRegs, {
      $2,
      $4,
      startPc: sidecarTravEntryPc(travBlock, exit),
    });
    travRegs = regs;
    if (travOutcome === 'vault_read') {
      continue;
    }
    if (travOutcome !== 'trav_ok') {
      throw new Error(`unexpected traversal outcome ${travOutcome}`);
    }
    if (runDenyPrefixVmFromNsh(path, nsh, env) === 'vault_read') {
      continue;
    }
    const disposition = runSidecarCanonGateDisposition(path, nsh, env);
    if (disposition === 'skip_delete') {
      continue;
    }
    lastOutcome = 'allowlist_continue';
  }
  return lastOutcome;
}

export function assertSidecarMultilineTravGuardTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const row of SIDECAR_MULTILINE_TRAV_GUARD_ROWS) {
    const outcome = runSidecarMultilineGuardOutcome(nsh, row.rawLines, env);
    if (outcome !== row.expected) {
      throw new Error(
        `multiline sidecar guard expected ${row.expected} for ${JSON.stringify(row.rawLines)}, got ${outcome}`,
      );
    }
  }
}

/** VM-driven FileRead + trim then full guard on trimmed path (S13 / :43–:52). */
export function assertSidecarReadTrimExactStringTables(nsh: string): void {
  const readBlock = readTrimBlockFromGuardRegion(extractSidecarGuardRegionForVm(nsh));
  for (const row of SIDECAR_READ_TRIM_EXACT_STRING_ROWS) {
    const trimmed = executeSidecarReadTrimBlock(readBlock, row.raw);
    if (trimmed === 'empty') {
      throw new Error(`read-trim exact expected path for raw ${JSON.stringify(row.raw)}, got empty`);
    }
    if (trimmed !== row.trimmed) {
      throw new Error(
        `read-trim exact mismatch for raw ${JSON.stringify(row.raw)}: expected ${JSON.stringify(row.trimmed)}, got ${JSON.stringify(trimmed)}`,
      );
    }
  }
}

export function assertSidecarDeleteReadLoopTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const h7 of SIDECAR_MULTILINE_H7_DELETE_ROWS) {
    const h7Result = simulateSidecarDeleteReadLoop(nsh, h7.rawLines, env);
    if (h7Result.closed !== h7.expectClosed) {
      throw new Error(`H-7 read-loop closed=${h7Result.closed} expected ${h7.expectClosed}`);
    }
    if (h7Result.steps >= SIDECAR_READ_LOOP_STEP_LIMIT) {
      throw new Error('H-7 read-loop exceeded step limit');
    }
    const h7Deleted = [...h7Result.deleted].sort();
    const h7Expected = [...h7.expectedDeleted].sort();
    if (h7Deleted.length !== h7Expected.length || h7Deleted.some((p, i) => p !== h7Expected[i])) {
      throw new Error(
        `H-7 read-loop delete set: expected ${JSON.stringify(h7Expected)}, got ${JSON.stringify(h7Deleted)}`,
      );
    }
  }

  for (const row of SIDECAR_DELETE_READ_LOOP_ROWS) {
    const result = simulateSidecarDeleteReadLoop(nsh, row.rawLines, env);
    if (result.closed !== row.expectClosed) {
      throw new Error(
        `read-loop closed=${result.closed} expected ${row.expectClosed} for ${JSON.stringify(row.rawLines)}`,
      );
    }
    if (result.steps >= SIDECAR_READ_LOOP_STEP_LIMIT) {
      throw new Error(`read-loop exceeded step limit for ${JSON.stringify(row.rawLines)}`);
    }
    const got = [...result.deleted].sort();
    const expected = [...row.expectedDeleted].sort();
    if (got.length !== expected.length || got.some((p, i) => p !== expected[i])) {
      throw new Error(
        `read-loop delete set mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
      );
    }
  }
}

export function assertSidecarReadTrimGuardTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
  options?: { includeExactTrimPin?: boolean },
): void {
  if (options?.includeExactTrimPin ?? true) {
    assertSidecarReadTrimExactStringTables(nsh);
  }
  const readBlock = readTrimBlockFromGuardRegion(extractSidecarGuardRegionForVm(nsh));
  for (const row of SIDECAR_READ_TRIM_GUARD_ROWS) {
    const trimmed = executeSidecarReadTrimBlock(readBlock, row.raw);
    if (row.expected === 'empty') {
      if (trimmed !== 'empty') {
        throw new Error(
          `read-trim expected empty for raw ${JSON.stringify(row.raw)}, got ${JSON.stringify(trimmed)}`,
        );
      }
      continue;
    }
    if (trimmed === 'empty') {
      throw new Error(`read-trim expected path for raw ${JSON.stringify(row.raw)}, got empty`);
    }
    const outcome = runSidecarGuardOutcomeOnPath(trimmed, nsh, env);
    if (outcome !== row.expected) {
      throw new Error(
        `read-trim guard expected ${row.expected} for raw ${JSON.stringify(row.raw)} (trimmed ${JSON.stringify(trimmed)}), got ${outcome}`,
      );
    }
  }
}

/** Deny-prefix VM tables only (re-baseline / H6; pin excluded). */
export function assertDenyPrefixVmBehaviourTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  const gateRows: ReadonlyArray<{ gate: 0 | 1 | 2; path: string }> = [
    { gate: 0, path: DENY_PREFIX_WINDIR_GATE_REJECT_PATH },
    { gate: 1, path: DENY_PREFIX_PROGRAMFILES_GATE_REJECT_PATH },
    { gate: 2, path: DENY_PREFIX_PROGRAMFILES64_GATE_REJECT_PATH },
  ];
  for (const { gate, path } of gateRows) {
    const outcome = runDenyPrefixGateVmFromNsh(path, nsh, gate, env);
    if (outcome !== 'vault_read') {
      throw new Error(
        `expected vault_read for deny-prefix gate ${gate} path ${JSON.stringify(path)}, got ${outcome}`,
      );
    }
  }
  for (const path of DENY_PREFIX_REJECT_PATHS) {
    const outcome = runDenyPrefixVmFromNsh(path, nsh, env);
    if (outcome !== 'vault_read') {
      throw new Error(`expected vault_read for deny-prefix path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  for (const path of DENY_PREFIX_ALLOW_PATHS) {
    const outcome = runDenyPrefixVmFromNsh(path, nsh, env);
    if (outcome !== 'allowlist_continue') {
      throw new Error(
        `expected allowlist_continue for deny-prefix path ${JSON.stringify(path)}, got ${outcome}`,
      );
    }
  }
  const swappedPfEnv: SidecarNsisVarEnv = {
    ...env,
    PROGRAMFILES: 'C:\\Program Files',
    PROGRAMFILES64: 'C:\\Program Files (x86)',
  };
  const shortPfPath = 'C:\\PROGRA~1\\Mythos\\bin';
  if (runDenyPrefixVmFromNsh(shortPfPath, nsh, swappedPfEnv) !== 'vault_read') {
    throw new Error(
      `expected vault_read for deny-prefix short PROGRAMFILES path ${JSON.stringify(shortPfPath)}`,
    );
  }
}

export type SidecarGuardVmBehaviourOptions = {
  /**
   * Mode-2 sweep: parity against `canonicalNsh` on every traversal/deny/allowlist row, plus the
   * read-trim exact + guard, delete-loop (H-7 rows included) and multiline tables. Skips only the
   * S14 / hard label-swap probes, which mutate the nsh again by file line.
   */
  sweepRebaseline?: boolean;
  canonicalNsh?: string;
};

/** String VM outcomes keyed by nsh sha + row — canonical side of mode-2 is computed once per worker. */
const SIDECAR_SWEEP_VM_OUTCOME_CACHE = new Map<string, string>();

function cachedSweepVmOutcome(nsh: string, rowKey: string, compute: () => string): string {
  if (!isCanonicalSweepNsh(nsh)) {
    return compute();
  }
  const key = `${sidecarDeleteLoopNshHash(nsh)}\n${rowKey}`;
  const hit = SIDECAR_SWEEP_VM_OUTCOME_CACHE.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const value = compute();
  if (SIDECAR_SWEEP_VM_OUTCOME_CACHE.size >= SIDECAR_DELETE_LOOP_SIM_CACHE_MAX) {
    const oldest = SIDECAR_SWEEP_VM_OUTCOME_CACHE.keys().next().value;
    if (oldest !== undefined) {
      SIDECAR_SWEEP_VM_OUTCOME_CACHE.delete(oldest);
    }
  }
  SIDECAR_SWEEP_VM_OUTCOME_CACHE.set(key, value);
  return value;
}

export function assertSidecarGuardVmSweepParity(
  mutantNsh: string,
  canonicalNsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const path of [
    ...TRAVERSAL_REJECT_PATHS,
    ...TRAVERSAL_REJECT_S16_CANONICAL_ONLY_PATHS,
    TRAVERSAL_HARD_H6_PATH,
  ]) {
    const canonical = cachedSweepVmOutcome(canonicalNsh, `trav-reject:${path}`, () =>
      runTraversalVmFromNsh(path, canonicalNsh),
    );
    const mutant = runTraversalVmFromNsh(path, mutantNsh);
    if (mutant !== canonical) {
      throw new Error(
        `sweep parity traversal reject ${JSON.stringify(path)}: canonical ${canonical}, mutant ${mutant}`,
      );
    }
  }
  for (const path of TRAVERSAL_ALLOW_PATHS) {
    const canonical = cachedSweepVmOutcome(canonicalNsh, `trav-allow:${path}`, () =>
      runTraversalVmFromNsh(path, canonicalNsh),
    );
    const mutant = runTraversalVmFromNsh(path, mutantNsh);
    if (mutant !== canonical) {
      throw new Error(
        `sweep parity traversal allow ${JSON.stringify(path)}: canonical ${canonical}, mutant ${mutant}`,
      );
    }
  }
  const denyGateRows: ReadonlyArray<{ gate: 0 | 1 | 2; path: string }> = [
    { gate: 0, path: DENY_PREFIX_WINDIR_GATE_REJECT_PATH },
    { gate: 1, path: DENY_PREFIX_PROGRAMFILES_GATE_REJECT_PATH },
    { gate: 2, path: DENY_PREFIX_PROGRAMFILES64_GATE_REJECT_PATH },
  ];
  for (const { gate, path } of denyGateRows) {
    const canonical = cachedSweepVmOutcome(canonicalNsh, `deny-gate:${gate}:${path}:${JSON.stringify(env)}`, () =>
      runDenyPrefixGateVmFromNsh(path, canonicalNsh, gate, env),
    );
    const mutant = runDenyPrefixGateVmFromNsh(path, mutantNsh, gate, env);
    if (mutant !== canonical) {
      throw new Error(
        `sweep parity deny gate ${gate} ${JSON.stringify(path)}: canonical ${canonical}, mutant ${mutant}`,
      );
    }
  }
  for (const path of DENY_PREFIX_REJECT_PATHS) {
    const canonical = cachedSweepVmOutcome(canonicalNsh, `deny-reject:${path}:${JSON.stringify(env)}`, () =>
      runDenyPrefixVmFromNsh(path, canonicalNsh, env),
    );
    const mutant = runDenyPrefixVmFromNsh(path, mutantNsh, env);
    if (mutant !== canonical) {
      throw new Error(
        `sweep parity deny reject ${JSON.stringify(path)}: canonical ${canonical}, mutant ${mutant}`,
      );
    }
  }
  for (const path of DENY_PREFIX_ALLOW_PATHS) {
    const canonical = cachedSweepVmOutcome(canonicalNsh, `deny-allow:${path}:${JSON.stringify(env)}`, () =>
      runDenyPrefixVmFromNsh(path, canonicalNsh, env),
    );
    const mutant = runDenyPrefixVmFromNsh(path, mutantNsh, env);
    if (mutant !== canonical) {
      throw new Error(
        `sweep parity deny allow ${JSON.stringify(path)}: canonical ${canonical}, mutant ${mutant}`,
      );
    }
  }
  const allowlistRows: ReadonlyArray<{ path: string }> = [
    { path: APPDATA_M5_REJECT_PATHS[0]! },
    { path: APPDATA_OFFSET_BACKSLASH_NON_MYTHOS_PATH },
    { path: APPDATA_M5_PREFIX_BACKSLASH_TAIL_PATH },
    ...APPDATA_M5_ALLOW_PATHS.map((path) => ({ path })),
  ];
  for (const { path } of allowlistRows) {
    const canonical = cachedSweepVmOutcome(canonicalNsh, `allowlist:${path}:${JSON.stringify(env)}`, () =>
      runSidecarPathAllowlistDeleteDisposition(path, canonicalNsh, env),
    );
    const mutant = runSidecarPathAllowlistDeleteDisposition(path, mutantNsh, env);
    if (mutant !== canonical) {
      throw new Error(
        `sweep parity allowlist/delete ${JSON.stringify(path)}: canonical ${canonical}, mutant ${mutant}`,
      );
    }
  }
}

export function assertSidecarH7DeleteLoopSweepParity(
  mutantNsh: string,
  canonicalNsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  const sortPaths = (paths: readonly string[]) => [...paths].sort();
  for (const h7 of SIDECAR_MULTILINE_H7_DELETE_ROWS) {
    const canonicalDel = simulateSidecarDeleteReadLoop(canonicalNsh, h7.rawLines, env);
    const mutantDel = simulateSidecarDeleteReadLoop(mutantNsh, h7.rawLines, env);
    if (
      sortPaths(canonicalDel.deleted).join('\0') !== sortPaths(mutantDel.deleted).join('\0')
    ) {
      throw new Error(
        `sweep parity H-7 delete-loop: canonical ${JSON.stringify(sortPaths(canonicalDel.deleted))}, mutant ${JSON.stringify(sortPaths(mutantDel.deleted))}`,
      );
    }
  }
}

export const RF7_PLAIN_VAULT = 'C:\\Users\\me\\Documents\\rf7-plain';
export const RF7_NESTED_PLAIN_VAULT = 'C:\\Users\\me\\Documents\\rf7-nest\\vault';
export const RF7_JUNCTION_VAULT = 'C:\\Users\\me\\Documents\\rf7-junction';
export const RF7_SYMLINK_VAULT = 'C:\\Users\\me\\Documents\\rf7-symlink';
export const RF7_PARENT_JUNCTION = 'C:\\Users\\me\\Documents\\rf7-parent';
export const RF7_PARENT_JUNCTION_VAULT = 'C:\\Users\\me\\Documents\\rf7-parent\\vault';
export const RF7_LEAF_JUNC = 'C:\\Users\\me\\Documents\\leaf-junc';
export const RF7_MID_REPARSE = 'C:\\Users\\me\\Documents\\rf7-a\\link';
export const RF7_MID_REPARSE_VAULT = 'C:\\Users\\me\\Documents\\rf7-a\\link\\vault';
export const RF7_READONLY_VAULT = 'C:\\Users\\me\\Documents\\rf7-readonly';
export const RF7_HIDDEN_VAULT = 'C:\\Users\\me\\Documents\\rf7-hidden';
export const RF7_SYSTEM_VAULT = 'C:\\Users\\me\\Documents\\rf7-system';
export const RF7_MISSING_VAULT = 'C:\\Users\\me\\Documents\\rf7-missing';
export const RF7_ERROR_VAULT = 'C:\\Users\\me\\Documents\\rf7-error';
export const RF7_ERROR_PARENT = 'C:\\Users\\me\\Documents\\rf7-errp';
export const RF7_ERROR_PARENT_VAULT = 'C:\\Users\\me\\Documents\\rf7-errp\\vault';
export const RF7_INVALID_VAULT = 'C:\\Users\\me\\Documents\\rf7-invalid';
export const RF7_APPDATA_FIXED_VAULTS = 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults';
export const RF7_ONE_CHAR_JUNCTION = 'C:\\Users\\me\\Documents\\a';
export const RF7_ONE_CHAR_JUNCTION_VAULT = 'C:\\Users\\me\\Documents\\a\\b\\v';

export type SidecarRf7ReparseRow = Readonly<{
  name: string;
  path: string;
  expect: 'delete' | 'skip';
  options: Omit<SidecarNsisRunOptions, 'env'>;
}>;

/**
 * RF-7b modelled attribute table. INVALID_FILE_ATTRIBUTES (0xFFFFFFFF) skips because
 * `0xFFFFFFFF & 0x400 !== 0` — there is no separate −1 compare. Readonly / hidden /
 * system without 0x400 must still delete. Walk is top-down from the allow-root child.
 */
export const SIDECAR_RF7_REPARSE_ROWS: readonly SidecarRf7ReparseRow[] = [
  { name: 'plain vault deletes', path: RF7_PLAIN_VAULT, expect: 'delete', options: {} },
  {
    name: 'nested plain vault deletes (ancestor mask must not skip DIRECTORY)',
    path: RF7_NESTED_PLAIN_VAULT,
    expect: 'delete',
    options: {},
  },
  {
    name: 'junction vault skips',
    path: RF7_JUNCTION_VAULT,
    expect: 'skip',
    options: { reparsePaths: [RF7_JUNCTION_VAULT] },
  },
  {
    name: 'symlink vault skips',
    path: RF7_SYMLINK_VAULT,
    expect: 'skip',
    options: { reparsePaths: [RF7_SYMLINK_VAULT] },
  },
  {
    name: 'parent junction + plain vault skips',
    path: RF7_PARENT_JUNCTION_VAULT,
    expect: 'skip',
    options: { reparsePaths: [RF7_PARENT_JUNCTION] },
  },
  {
    name: 'middle junction + plain vault skips',
    path: RF7_MID_REPARSE_VAULT,
    expect: 'skip',
    options: { reparsePaths: [RF7_MID_REPARSE] },
  },
  {
    name: 'attribute error skips',
    path: RF7_ERROR_VAULT,
    expect: 'skip',
    options: { attrErrorPaths: [RF7_ERROR_VAULT] },
  },
  {
    name: 'ancestor attribute error skips',
    path: RF7_ERROR_PARENT_VAULT,
    expect: 'skip',
    options: { attrErrorPaths: [RF7_ERROR_PARENT] },
  },
  {
    name: 'INVALID_FILE_ATTRIBUTES skips via 0x400 bit',
    path: RF7_INVALID_VAULT,
    expect: 'skip',
    options: { invalidAttrPaths: [RF7_INVALID_VAULT] },
  },
  {
    name: 'missing path (INVALID between scan and delete) skips',
    path: RF7_MISSING_VAULT,
    expect: 'skip',
    options: { fs: {} },
  },
  {
    name: 'readonly vault deletes',
    path: RF7_READONLY_VAULT,
    expect: 'delete',
    options: { fileAttributes: { [RF7_READONLY_VAULT]: FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_READONLY } },
  },
  {
    name: 'hidden vault deletes',
    path: RF7_HIDDEN_VAULT,
    expect: 'delete',
    options: { fileAttributes: { [RF7_HIDDEN_VAULT]: FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_HIDDEN } },
  },
  {
    name: 'system vault deletes',
    path: RF7_SYSTEM_VAULT,
    expect: 'delete',
    options: { fileAttributes: { [RF7_SYSTEM_VAULT]: FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_SYSTEM } },
  },
  {
    name: 'reparse AppData vaults/ fixed target skips',
    path: RF7_APPDATA_FIXED_VAULTS,
    expect: 'skip',
    options: { reparsePaths: [RF7_APPDATA_FIXED_VAULTS] },
  },
  {
    name: '1-char component junction a\\b\\v skips (walk +2 / Goto +N)',
    path: RF7_ONE_CHAR_JUNCTION_VAULT,
    expect: 'skip',
    options: { reparsePaths: [RF7_ONE_CHAR_JUNCTION] },
  },
  {
    name: 'parent junction via / skips (walk $1 mutant)',
    path: 'C:\\Users\\me\\Documents\\rf7-parent/vault',
    expect: 'skip',
    options: { reparsePaths: [RF7_PARENT_JUNCTION] },
  },
  {
    name: 'parent junction via RF7PAR~1 skips (walk $1 mutant)',
    path: 'C:\\Users\\me\\Documents\\RF7PAR~1\\vault',
    expect: 'skip',
    options: { reparsePaths: [RF7_PARENT_JUNCTION] },
  },
  {
    name: 'leaf junction via / skips (leaf $3→$1 mutant)',
    path: 'C:\\Users\\me\\Documents/leaf-junc',
    expect: 'skip',
    options: { reparsePaths: [RF7_LEAF_JUNC] },
  },
  {
    name: 'leaf junction via LEAFJ~1 skips (leaf $3→$1 mutant)',
    path: 'C:\\Users\\me\\Documents\\LEAFJ~1',
    expect: 'skip',
    options: { reparsePaths: [RF7_LEAF_JUNC] },
  },
  {
    name: 'leaf junction raw LEAFJ~1 is a plain directory (leaf GFA without nr_ok $1 smash)',
    path: 'C:\\Users\\me\\Documents\\LEAFJ~1',
    expect: 'skip',
    options: {
      reparsePaths: [RF7_LEAF_JUNC],
      fileAttributes: { 'C:\\Users\\me\\Documents\\LEAFJ~1': FILE_ATTRIBUTE_DIRECTORY },
    },
  },
];

export function sidecarRf7Deleted(nsh: string, row: SidecarRf7ReparseRow, env: SidecarNsisVarEnv): string[] {
  const run = simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], env, row.options);
  return run.deleted;
}

export function assertSidecarReparseTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const row of SIDECAR_RF7_REPARSE_ROWS) {
    let deleted: string[];
    try {
      deleted = sidecarRf7Deleted(nsh, row, env);
    } catch (err) {
      throw new Error(
        `RF-7 ${row.name}: expected ${row.expect} with no error, threw ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (row.expect === 'skip') {
      if (deleted.length !== 0) {
        throw new Error(`RF-7 ${row.name}: expected skip, deleted ${JSON.stringify(deleted)}`);
      }
    } else if (deleted.length !== 1 || deleted[0] !== row.path) {
      throw new Error(`RF-7 ${row.name}: expected delete ${JSON.stringify(row.path)}, deleted ${JSON.stringify(deleted)}`);
    }
  }
}

export type SidecarH1SlashRow = Readonly<{
  name: string;
  path: string;
  env: SidecarNsisVarEnv;
  expectDeleted: readonly string[];
  mustNotDelete: readonly string[];
  options?: Omit<SidecarNsisRunOptions, 'env'>;
}>;

function h1AllowRoots(env: SidecarNsisVarEnv): readonly { name: string; root: string }[] {
  return [
    { name: 'Documents', root: env.DOCUMENTS },
    { name: 'Desktop', root: env.DESKTOP },
    { name: 'Downloads', root: `${env.PROFILE}\\Downloads` },
    { name: 'AppData', root: `${env.APPDATA}\\Mythos Writer` },
  ];
}

/**
 * H1: `/` in a sidecar line. RMDir runs validate_filename (`a/b` → `ab`); Delete/IfFileExists
 * are raw-path and myDelete splits on `\` only (`a/b.txt` → `b.txt`). Acts must use `$3`.
 */
export const SIDECAR_H1_SLASH_ROWS: readonly SidecarH1SlashRow[] = h1AllowRoots(DEFAULT_SIDECAR_NSIS_VAR_ENV).flatMap(
  ({ name, root }) => [
    {
      name: `H1 ${name} a/b must not delete ab`,
      path: `${root}\\a/b`,
      env: DEFAULT_SIDECAR_NSIS_VAR_ENV,
      expectDeleted: [`${root}\\a\\b`],
      mustNotDelete: [`${root}\\ab`],
    },
    {
      name: `H1 ${name} a/b with ab junction must not delete ab`,
      path: `${root}\\a/b`,
      env: DEFAULT_SIDECAR_NSIS_VAR_ENV,
      expectDeleted: [`${root}\\a\\b`],
      mustNotDelete: [`${root}\\ab`],
      options: { reparsePaths: [`${root}\\ab`] },
    },
    {
      name: `H1 ${name} D/esktop must not delete Desktop`,
      path: `${root}\\D/esktop`,
      env: DEFAULT_SIDECAR_NSIS_VAR_ENV,
      expectDeleted: [`${root}\\D\\esktop`],
      mustNotDelete: [`${root}\\Desktop`],
    },
  ],
);

export function assertSidecarH1SlashTables(nsh: string): void {
  for (const row of SIDECAR_H1_SLASH_ROWS) {
    let deleted: string[];
    try {
      deleted = simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env, row.options ?? {}).deleted;
    } catch (err) {
      throw new Error(
        `H1 ${row.name}: expected delete ${JSON.stringify(row.expectDeleted)}, threw ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (deleted.join('\0') !== [...row.expectDeleted].join('\0')) {
      throw new Error(
        `H1 ${row.name}: expected deleted ${JSON.stringify(row.expectDeleted)}, got ${JSON.stringify(deleted)}`,
      );
    }
    for (const ban of row.mustNotDelete) {
      if (deleted.includes(ban)) {
        throw new Error(`H1 ${row.name}: must not delete ${JSON.stringify(ban)}, got ${JSON.stringify(deleted)}`);
      }
    }
  }
}

export function assertSidecarH1SlashSweepParity(mutantNsh: string, canonicalNsh: string): void {
  for (const row of SIDECAR_H1_SLASH_ROWS) {
    const options = row.options ?? {};
    const canonical = simulateSidecarDeleteReadLoop(canonicalNsh, [`${row.path}\r\n`], row.env, options).deleted.join(
      '\0',
    );
    const mutant = simulateSidecarDeleteReadLoop(mutantNsh, [`${row.path}\r\n`], row.env, options).deleted.join('\0');
    if (mutant !== canonical) {
      throw new Error(
        `H1 sweep parity ${row.name}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`,
      );
    }
  }
  for (const row of SIDECAR_H1_DELETE_SLASH_ROWS) {
    const canonical = simulateSidecarDeleteReadLoop(canonicalNsh, [`${row.path}\r\n`], row.env).deleted.join('\0');
    const mutant = simulateSidecarDeleteReadLoop(mutantNsh, [`${row.path}\r\n`], row.env).deleted.join('\0');
    if (mutant !== canonical) {
      throw new Error(
        `H1 Delete-slash sweep parity ${row.name}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`,
      );
    }
  }
}

/** Forge H1: Delete on raw `$1` cuts at the last `\`, so `root\a/b.txt` deletes `root\b.txt`. */
export const SIDECAR_H1_DELETE_SLASH_ROWS: readonly SidecarH1SlashRow[] = h1AllowRoots(
  DEFAULT_SIDECAR_NSIS_VAR_ENV,
).flatMap(({ name, root }) => {
  const gfpnAb = `${root}\\a\\b.txt`;
  const rawCut = `${root}\\b.txt`;
  const mixed = `${root}\\a\\b\\f.txt`;
  const mixedCut = `${root}\\a\\f.txt`;
  return [
    {
      name: `H1 Delete ${name} a/b.txt must not delete b.txt`,
      path: `${root}\\a/b.txt`,
      env: DEFAULT_SIDECAR_NSIS_VAR_ENV,
      expectDeleted: [gfpnAb],
      mustNotDelete: [rawCut],
    },
    {
      name: `H1 Delete ${name} a\\b/f.txt must not delete a\\f.txt`,
      path: `${root}\\a\\b/f.txt`,
      env: DEFAULT_SIDECAR_NSIS_VAR_ENV,
      expectDeleted: [mixed],
      mustNotDelete: [mixedCut],
    },
    {
      name: `H1 Delete ${name} a/b\\f.txt must not delete a/b\\f.txt`,
      path: `${root}\\a/b\\f.txt`,
      env: DEFAULT_SIDECAR_NSIS_VAR_ENV,
      expectDeleted: [mixed],
      mustNotDelete: [`${root}\\a/b\\f.txt`],
    },
    {
      name: `H1 Delete ${name} x/f.txt must not delete f.txt`,
      path: `${root}\\x/f.txt`,
      env: DEFAULT_SIDECAR_NSIS_VAR_ENV,
      expectDeleted: [`${root}\\x\\f.txt`],
      mustNotDelete: [`${root}\\f.txt`],
    },
  ];
});

export function assertSidecarH1DeleteSlashTables(nsh: string): void {
  for (const row of SIDECAR_H1_DELETE_SLASH_ROWS) {
    let deleted: string[];
    try {
      deleted = simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env).deleted;
    } catch (err) {
      throw new Error(
        `H1 Delete-slash ${row.name}: expected ${JSON.stringify(row.expectDeleted)}, threw ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (deleted.join('\0') !== [...row.expectDeleted].join('\0')) {
      throw new Error(
        `H1 Delete-slash ${row.name}: expected deleted ${JSON.stringify(row.expectDeleted)}, got ${JSON.stringify(deleted)}`,
      );
    }
    for (const ban of row.mustNotDelete) {
      if (deleted.includes(ban)) {
        throw new Error(`H1 Delete-slash ${row.name}: must not delete ${JSON.stringify(ban)}, got ${JSON.stringify(deleted)}`);
      }
    }
  }
}

/**
 * Shield 5462286933 four pin-free survivors at a3719f95 :167 / :220.
 * Documents=`C:\Users\me\Desk` is a text prefix of Desktop without a following `\`,
 * so :167's else is taken and then Desktop must still delete. The file row pins
 * one delete act per sidecar line so :220/:307 `Goto mythos_trim_chop` cannot
 * re-delete shorter prefixes.
 */
export const SIDECAR_RF7_DESK_PREFIX_ENV: SidecarNsisVarEnv = {
  ...DEFAULT_SIDECAR_NSIS_VAR_ENV,
  DOCUMENTS: 'C:\\Users\\me\\Desk',
};

export const SIDECAR_RF7_DESK_PREFIX_DESKTOP_VAULT = 'C:\\Users\\me\\Desktop\\MyVault\\x';

export const SIDECAR_RF7_ONE_ACT_FILE_PATH = 'C:\\Users\\me\\Documents\\note.txt';

export type SidecarRf7ShieldSurvivorRow = Readonly<{
  name: string;
  rawLines: readonly string[];
  env: SidecarNsisVarEnv;
  expectedDeleted: readonly string[];
}>;

export const SIDECAR_RF7_SHIELD_SURVIVOR_ROWS: readonly SidecarRf7ShieldSurvivorRow[] = [
  {
    name: ':167 Desktop deletes when Documents is a Desk prefix',
    rawLines: [`${SIDECAR_RF7_DESK_PREFIX_DESKTOP_VAULT}\r\n`],
    env: SIDECAR_RF7_DESK_PREFIX_ENV,
    expectedDeleted: [SIDECAR_RF7_DESK_PREFIX_DESKTOP_VAULT],
  },
  {
    name: ':220/:307 one act per sidecar file line',
    rawLines: [`${SIDECAR_RF7_ONE_ACT_FILE_PATH}\r\n`],
    env: DEFAULT_SIDECAR_NSIS_VAR_ENV,
    expectedDeleted: [SIDECAR_RF7_ONE_ACT_FILE_PATH],
  },
];

function sidecarDeletedSetOrThrow(
  nsh: string,
  rawLines: readonly string[],
  env: SidecarNsisVarEnv,
): string {
  try {
    return [...simulateSidecarDeleteReadLoop(nsh, rawLines, env).deleted].sort().join('\0');
  } catch (err) {
    return `THROW:${err instanceof Error ? err.message : String(err)}`;
  }
}

export function assertSidecarRf7ShieldSurvivorTables(nsh: string): void {
  for (const row of SIDECAR_RF7_SHIELD_SURVIVOR_ROWS) {
    const got = sidecarDeletedSetOrThrow(nsh, row.rawLines, row.env);
    const expected = [...row.expectedDeleted].sort().join('\0');
    if (got !== expected) {
      throw new Error(
        `RF-7 Shield survivor row ${row.name}: expected ${JSON.stringify(row.expectedDeleted)}, got ${JSON.stringify(got.split('\0'))}`,
      );
    }
  }
}

export function assertSidecarRf7ShieldSurvivorSweepParity(mutantNsh: string, canonicalNsh: string): void {
  for (const row of SIDECAR_RF7_SHIELD_SURVIVOR_ROWS) {
    const canonical = sidecarDeletedSetOrThrow(canonicalNsh, row.rawLines, row.env);
    const mutant = sidecarDeletedSetOrThrow(mutantNsh, row.rawLines, row.env);
    if (mutant !== canonical) {
      throw new Error(
        `RF-7 Shield survivor parity ${row.name}: canonical ${JSON.stringify(canonical.split('\0'))}, mutant ${JSON.stringify(mutant.split('\0'))}`,
      );
    }
  }
}

export function assertSidecarReparseSweepParity(
  mutantNsh: string,
  canonicalNsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const row of SIDECAR_RF7_REPARSE_ROWS) {
    let canonical: string;
    let mutant: string;
    try {
      canonical = sidecarRf7Deleted(canonicalNsh, row, env).join('\0');
    } catch (err) {
      throw new Error(
        `RF-7 sweep parity ${row.name}: canonical threw ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      mutant = sidecarRf7Deleted(mutantNsh, row, env).join('\0');
    } catch (err) {
      throw new Error(
        `RF-7 sweep parity ${row.name}: mutant threw ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (mutant !== canonical) {
      throw new Error(
        `RF-7 sweep parity ${row.name}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`,
      );
    }
  }
}

const HARD1_WILDCARD_TAILS: readonly string[] = ['*', '*.*', '?', '<', '>', '"', '|', 'v*', 'x?y'];
const HARD1_SEPS: readonly string[] = ['\\', '/'];

/** Local E1 copy — do not read sidecarNsisVm envs at module init (circular import). */
const HARD12_ENV_E1: SidecarNsisVarEnv = {
  WINDIR: 'C:\\Windows',
  PROGRAMFILES: 'C:\\Program Files',
  PROGRAMFILES64: 'C:\\Program Files (x86)',
  APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  DOCUMENTS: 'C:\\Users\\me\\Documents',
  DESKTOP: 'C:\\Users\\me\\Desktop',
  PROFILE: 'C:\\Users\\me',
};
const HARD1_ENV_E5: SidecarNsisVarEnv = {
  ...HARD12_ENV_E1,
  PROFILE: `C:\\Users\\${'p'.repeat(300)}`,
  APPDATA: `C:\\Users\\${'p'.repeat(300)}\\AppData\\Roaming`,
  DOCUMENTS: `C:\\Users\\${'p'.repeat(300)}\\Documents`,
  DESKTOP: `C:\\Users\\${'p'.repeat(300)}\\Desktop`,
};
const HARD1_ENV_E6: SidecarNsisVarEnv = {
  ...HARD12_ENV_E1,
  PROGRAMFILES: 'D:\\Apps32',
  PROGRAMFILES64: 'C:\\Program Files',
  DOCUMENTS: 'D:\\Apps32\\Docs',
};

function hard1AllowRoots(env: SidecarNsisVarEnv): readonly string[] {
  return [`${env.APPDATA}\\Mythos Writer`, env.DOCUMENTS, env.DESKTOP, `${env.PROFILE}\\Downloads`];
}

export type SidecarHard1WildcardRow = Readonly<{
  name: string;
  env: SidecarNsisVarEnv;
  path: string;
}>;

/** HARD-1: `* ? < > " |` plus `*.*` / `v*` / `x?y` under every root, both separators. ≥77 rows. */
export const SIDECAR_HARD1_WILDCARD_ROWS: readonly SidecarHard1WildcardRow[] = (() => {
  const rows: SidecarHard1WildcardRow[] = [];
  const pushEnv = (envName: string, env: SidecarNsisVarEnv, tails: readonly string[], seps: readonly string[]): void => {
    for (const root of hard1AllowRoots(env)) {
      for (const tail of tails) {
        for (const sep of seps) {
          const path = `${root}${sep}${tail}`;
          rows.push({ name: `${envName} ${path}`, env, path });
        }
      }
    }
  };
  pushEnv('E1', HARD12_ENV_E1, HARD1_WILDCARD_TAILS, HARD1_SEPS);
  pushEnv('E5', HARD1_ENV_E5, ['*', '*.*'], ['\\']);
  pushEnv('E6', HARD1_ENV_E6, ['*', '*.*'], ['\\']);
  return rows;
})();

export type SidecarHard2NestedRow = Readonly<{
  id: string;
  env: SidecarNsisVarEnv;
  path: string;
  expect: 'skip' | 'delete';
}>;

export const SIDECAR_HARD2_NESTED_ENVS: Readonly<Record<string, SidecarNsisVarEnv>> = {
  N1: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Documents\\Desktop' },
  N2: {
    ...HARD12_ENV_E1,
    DOCUMENTS: 'C:\\Users\\me\\OneDrive\\Documents',
    DESKTOP: 'C:\\Users\\me\\OneDrive\\Documents\\Desktop',
  },
  N3: { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users\\me' },
  N4: { ...HARD12_ENV_E1, DOCUMENTS: 'D:\\Docs', DESKTOP: 'D:\\Docs\\Desktop' },
  N5: { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users\\me\\Desktop\\Documents' },
  N6: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Downloads\\Desktop' },
  /** Downloads nested under Documents via PROFILE=Documents\prof. */
  N7: {
    ...HARD12_ENV_E1,
    PROFILE: 'C:\\Users\\me\\Documents\\prof',
    DOCUMENTS: 'C:\\Users\\me\\Documents',
    DESKTOP: 'C:\\Users\\me\\Desktop',
  },
  /** Downloads nested under the profile; Desktop is outside so it cannot catch first. */
  N8: {
    ...HARD12_ENV_E1,
    DOCUMENTS: 'C:\\Users',
    DESKTOP: 'C:\\Desktop',
    PROFILE: 'C:\\Users\\me',
  },
};

const HARD2_CHILD_ROOTS: readonly { envId: keyof typeof SIDECAR_HARD2_NESTED_ENVS; root: string }[] = [
  { envId: 'N1', root: 'C:\\Users\\me\\Documents\\Desktop' },
  { envId: 'N2', root: 'C:\\Users\\me\\OneDrive\\Documents\\Desktop' },
  { envId: 'N3', root: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer' },
  { envId: 'N3', root: 'C:\\Users\\me\\Desktop' },
  { envId: 'N3', root: 'C:\\Users\\me\\Downloads' },
  { envId: 'N4', root: 'D:\\Docs\\Desktop' },
  { envId: 'N5', root: 'C:\\Users\\me\\Desktop\\Documents' },
  { envId: 'N6', root: 'C:\\Users\\me\\Downloads\\Desktop' },
];

const HARD2_SKIP_SUFFIXES: readonly { tag: string; suffix: string }[] = [
  { tag: 'bare', suffix: '' },
  { tag: 'bs', suffix: '\\' },
  { tag: 'dbl', suffix: '\\\\' },
  { tag: 'dot', suffix: '\\.\\' },
  { tag: 'space', suffix: '\\ ' },
  { tag: 'fwd', suffix: '/' },
  { tag: 'fwdfwd', suffix: '//' },
];

/** Probe's 56 nested-root skip + 16 vault-delete rows, plus N3 AppData ancestor skips. */
export const SIDECAR_HARD2_NESTED_ROWS: readonly SidecarHard2NestedRow[] = [
  ...HARD2_CHILD_ROOTS.flatMap(({ envId, root }) => {
    const env = SIDECAR_HARD2_NESTED_ENVS[envId]!;
    const skips: SidecarHard2NestedRow[] = HARD2_SKIP_SUFFIXES.map(({ tag, suffix }) => ({
      id: `${envId}|${root}|${tag}`,
      env,
      path: `${root}${suffix}`,
      expect: 'skip' as const,
    }));
    const deletes: SidecarHard2NestedRow[] = [
      { id: `${envId}|${root}|vault`, env, path: `${root}\\v`, expect: 'delete' },
      { id: `${envId}|${root}|vault2`, env, path: `${root}\\My Vault\\notes`, expect: 'delete' },
    ];
    return [...skips, ...deletes];
  }),
  {
    id: 'N3|C:\\Users\\me\\AppData|bare',
    env: SIDECAR_HARD2_NESTED_ENVS.N3!,
    path: 'C:\\Users\\me\\AppData',
    expect: 'skip',
  },
  {
    id: 'N3|C:\\Users\\me\\AppData\\Roaming|bare',
    env: SIDECAR_HARD2_NESTED_ENVS.N3!,
    path: 'C:\\Users\\me\\AppData\\Roaming',
    expect: 'skip',
  },
  ...(['bare', 'bs', 'fwd', 'short'] as const).flatMap((tag) => {
    const env = SIDECAR_HARD2_NESTED_ENVS.N7!;
    const ancestor = 'C:\\Users\\me\\Documents\\prof';
    const downloads = `${ancestor}\\Downloads`;
    const ancestorPath =
      tag === 'bare'
        ? ancestor
        : tag === 'bs'
          ? `${ancestor}\\`
          : tag === 'fwd'
            ? `${ancestor}/`
            : 'C:\\Users\\me\\DOCUME~1\\prof';
    const downloadsPath =
      tag === 'bare'
        ? downloads
        : tag === 'bs'
          ? `${downloads}\\`
          : tag === 'fwd'
            ? `${downloads}/`
            : 'C:\\Users\\me\\DOCUME~1\\prof\\DOWNLO~1';
    return [
      { id: `N7|Downloads-ancestor|${tag}`, env, path: ancestorPath, expect: 'skip' as const },
      { id: `N7|Downloads-nested|${tag}`, env, path: downloadsPath, expect: 'skip' as const },
    ];
  }),
  ...(['bare', 'bs', 'fwd', 'short'] as const).flatMap((tag) => {
    const env = SIDECAR_HARD2_NESTED_ENVS.N8!;
    const ancestor = 'C:\\Users\\me';
    const downloads = `${ancestor}\\Downloads`;
    const ancestorPath =
      tag === 'bare' ? ancestor : tag === 'bs' ? `${ancestor}\\` : tag === 'fwd' ? `${ancestor}/` : 'C:\\USERS\\ME';
    const downloadsPath =
      tag === 'bare'
        ? downloads
        : tag === 'bs'
          ? `${downloads}\\`
          : tag === 'fwd'
            ? `${downloads}/`
            : 'C:\\Users\\me\\DOWNLO~1';
    return [
      { id: `N8|Downloads-ancestor|${tag}`, env, path: ancestorPath, expect: 'skip' as const },
      { id: `N8|Downloads-nested|${tag}`, env, path: downloadsPath, expect: 'skip' as const },
    ];
  }),
];

export function assertSidecarHard1WildcardTables(nsh: string): void {
  if (SIDECAR_HARD1_WILDCARD_ROWS.length < 77) {
    throw new Error(`HARD-1 must ship ≥77 wildcard rows, got ${SIDECAR_HARD1_WILDCARD_ROWS.length}`);
  }
  for (const row of SIDECAR_HARD1_WILDCARD_ROWS) {
    let deleted: string[];
    try {
      deleted = simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env).deleted;
    } catch (err) {
      throw new Error(
        `HARD-1 ${row.name}: expected skip with no error, threw ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (deleted.length !== 0) {
      throw new Error(`HARD-1 ${row.name}: expected skip, deleted ${JSON.stringify(deleted)}`);
    }
  }
}

/** Mode-2 subset: one char per class × both seps on Documents, plus AppData `*`. */
export const SIDECAR_HARD1_SWEEP_ROWS: readonly SidecarHard1WildcardRow[] = SIDECAR_HARD1_WILDCARD_ROWS.filter(
  (row) =>
    row.name.startsWith('E1 ') &&
    (row.path.includes('\\Documents\\') || row.path.includes('/Documents/') || row.path.endsWith('Mythos Writer\\*')),
).filter((row) => {
  const tail = row.path.replace(/^.*[\\/]/, '');
  const keep = new Set(['*', '*.*', '?', '<', '>', '"', '|', 'v*', 'x?y']);
  return keep.has(tail);
});

export function assertSidecarHard1WildcardSweepParity(mutantNsh: string, canonicalNsh: string): void {
  for (const row of SIDECAR_HARD1_SWEEP_ROWS) {
    const canonical = simulateSidecarDeleteReadLoop(canonicalNsh, [`${row.path}\r\n`], row.env).deleted.join('\0');
    const mutant = simulateSidecarDeleteReadLoop(mutantNsh, [`${row.path}\r\n`], row.env).deleted.join('\0');
    if (mutant !== canonical) {
      throw new Error(
        `HARD-1 sweep parity ${row.name}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`,
      );
    }
  }
}

export function assertSidecarHard2NestedTables(nsh: string): void {
  const skipCount = SIDECAR_HARD2_NESTED_ROWS.filter((r) => r.expect === 'skip').length;
  const deleteCount = SIDECAR_HARD2_NESTED_ROWS.filter((r) => r.expect === 'delete').length;
  if (skipCount < 56 || deleteCount < 16) {
    throw new Error(`HARD-2 must include Probe's 56 skip + 16 delete rows, got skip=${skipCount} delete=${deleteCount}`);
  }
  for (const row of SIDECAR_HARD2_NESTED_ROWS) {
    let deleted: string[];
    try {
      deleted = simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env).deleted;
    } catch (err) {
      throw new Error(
        `HARD-2 ${row.id}: expected ${row.expect} with no error, threw ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (row.expect === 'skip') {
      if (deleted.length !== 0) {
        throw new Error(`HARD-2 ${row.id}: expected skip, deleted ${JSON.stringify(deleted)}`);
      }
    } else if (deleted.length !== 1 || deleted[0] !== row.path) {
      throw new Error(`HARD-2 ${row.id}: expected delete ${JSON.stringify(row.path)}, deleted ${JSON.stringify(deleted)}`);
    }
  }
}

/**
 * Mode-2 nested subset: each successor equal-check plus one vault-delete and the N3
 * AppData ancestors. Full Probe 56+16 stay on the canonical tables.
 */
export const SIDECAR_HARD2_SWEEP_ROWS: readonly SidecarHard2NestedRow[] = SIDECAR_HARD2_NESTED_ROWS.filter((row) => {
  const id = row.id;
  return (
    id.endsWith('|bare') ||
    id.endsWith('|fwd') ||
    id.endsWith('|vault') ||
    id.endsWith('|short') ||
    id.startsWith('N3|C:\\Users\\me\\AppData') ||
    id.startsWith('N7|') ||
    id.startsWith('N8|')
  );
});

export function assertSidecarHard2NestedSweepParity(mutantNsh: string, canonicalNsh: string): void {
  for (const row of SIDECAR_HARD2_SWEEP_ROWS) {
    const canonical = simulateSidecarDeleteReadLoop(canonicalNsh, [`${row.path}\r\n`], row.env).deleted.join('\0');
    const mutant = simulateSidecarDeleteReadLoop(mutantNsh, [`${row.path}\r\n`], row.env).deleted.join('\0');
    if (mutant !== canonical) {
      throw new Error(
        `HARD-2 sweep parity ${row.id}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`,
      );
    }
  }
}

export type SidecarHardARow = Readonly<{
  name: string;
  path: string;
  env: SidecarNsisVarEnv;
  expect: 'skip' | 'delete';
  mustNotDelete?: readonly string[];
  options?: Omit<SidecarNsisRunOptions, 'env'>;
  /** Primary sweep line this row is meant to kill when Nop'd (Forge 29 / canon-root). */
  killsFileLine?: number;
  killsFileLines?: readonly number[];
}>;

const HARD_A_DOCS_AS_PROFILE: SidecarNsisVarEnv = { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users\\me' };
const HARD_A_DESK_UNDER_DOCS: SidecarNsisVarEnv = {
  ...HARD12_ENV_E1,
  DESKTOP: 'C:\\Users\\me\\Documents\\My Desktop',
};
const HARD_A_DESK_UNDER_DL: SidecarNsisVarEnv = {
  ...HARD12_ENV_E1,
  DESKTOP: 'C:\\Users\\me\\Downloads\\Desktop',
};
const HARD_A_SHORT_DOCS: SidecarNsisVarEnv = {
  ...HARD12_ENV_E1,
  DOCUMENTS: 'C:\\Users\\me\\DOCUME~1',
};
const HARD_A_SHORT_APPDATA: SidecarNsisVarEnv = {
  ...HARD12_ENV_E1,
  APPDATA: 'C:\\Users\\me\\APPDAT~1\\Roaming',
};

/** Probe HARD-A 8.3 repros, short-form roots, real `Notes~1`, and PROGRA~1 deny. */
const S19_ONEDRIVE_LINE = 'C:\\Users\\me\\OneDrive';
const S19_ONEDRIVE_KEEP = [
  'C:\\Users\\me\\OneDrive',
  'C:\\Users\\me\\OneDrive\\Documents',
  'C:\\Users\\me\\OneDrive\\Desktop',
  'C:\\Users\\me\\OneDrive\\Downloads',
] as const;

/** 6 blocks × 3 8.3 spellings × errno 2/3 = 36. Each must keep the OneDrive ancestor. */
function s19OnedriveRow(
  name: string,
  env: SidecarNsisVarEnv,
  line: number,
  errno: number,
): SidecarHardARow {
  return {
    name,
    path: S19_ONEDRIVE_LINE,
    env,
    expect: 'skip',
    mustNotDelete: S19_ONEDRIVE_KEEP,
    options: { glpnErrnoFileLines: { [line]: errno } },
  };
}

export const S19_ONEDRIVE_WRONG_TARGET_ROWS: readonly SidecarHardARow[] = (
  [
    { id: 'ME~1', documents: 'C:\\Users\\ME~1\\OneDrive\\Documents', desktop: 'C:\\Users\\ME~1\\OneDrive\\Desktop', profile: 'C:\\Users\\ME~1\\OneDrive' },
    { id: 'DOCUME~1', documents: 'C:\\Users\\me\\OneDrive\\DOCUME~1', desktop: 'C:\\Users\\me\\OneDrive\\DESKTO~1', profile: 'C:\\Users\\me\\OneDrive' },
    { id: 'docume~1', documents: 'C:\\Users\\me\\OneDrive\\docume~1', desktop: 'C:\\Users\\me\\OneDrive\\deskto~1', profile: 'C:\\Users\\me\\OneDrive' },
  ] as const
).flatMap((sp) =>
  ([2, 3] as const).flatMap((errno) => [
    s19OnedriveRow(`S-19 :230 ${sp.id} errno ${errno} OneDrive ancestor keep`, { ...HARD12_ENV_E1, DOCUMENTS: sp.documents }, 230, errno),
    s19OnedriveRow(`S-19 :260 ${sp.id} errno ${errno} OneDrive ancestor keep`, { ...HARD12_ENV_E1, DESKTOP: sp.desktop }, 260, errno),
    s19OnedriveRow(`S-19 :290 ${sp.id} errno ${errno} OneDrive ancestor keep`, { ...HARD12_ENV_E1, PROFILE: sp.profile }, 290, errno),
    s19OnedriveRow(`S-19 :389 nested Documents ${sp.id} errno ${errno} OneDrive ancestor keep`, { ...HARD12_ENV_E1, DOCUMENTS: sp.documents, DESKTOP: 'C:\\Users\\me' }, 389, errno),
    s19OnedriveRow(`S-19 :415 nested Desktop ${sp.id} errno ${errno} OneDrive ancestor keep`, { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users\\me', DESKTOP: sp.desktop }, 415, errno),
    s19OnedriveRow(`S-19 :441 nested Downloads ${sp.id} errno ${errno} OneDrive ancestor keep`, { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users\\me', PROFILE: sp.profile }, 441, errno),
  ]),
);

export const SIDECAR_HARD_A_ROWS: readonly SidecarHardARow[] = [
  {
    name: 'DOWNLO~1 under profile must not delete Downloads',
    path: 'C:\\Users\\me\\DOWNLO~1',
    env: HARD_A_DOCS_AS_PROFILE,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads'],
  },
  {
    name: 'downlo~1 lowercase must not delete Downloads',
    path: 'C:\\Users\\me\\downlo~1',
    env: HARD_A_DOCS_AS_PROFILE,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads'],
  },
  {
    name: 'MYTHOS~1 must not delete Mythos Writer',
    path: 'C:\\Users\\me\\AppData\\Roaming\\MYTHOS~1',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer'],
  },
  {
    name: 'G3 Documents inside Mythos Writer\\Docs; MYTHOS~1\\Docs skips (no next-root)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\MYTHOS~1\\Docs',
    env: {
      ...HARD12_ENV_E1,
      DOCUMENTS: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\Docs',
    },
    expect: 'skip',
    mustNotDelete: [
      'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer',
      'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\Docs',
    ],
    killsFileLine: 404,
  },
  {
    name: 'Mythos Writer vault via / still deletes',
    path: 'C:/Users/me/AppData/Roaming/Mythos Writer/vaults/x',
    env: HARD12_ENV_E1,
    expect: 'delete',
    killsFileLines: [216, 219],
  },
  {
    name: 'Mythos Writer vault via MYTHOS~1\\v still deletes',
    path: 'C:\\Users\\me\\AppData\\Roaming\\MYTHOS~1\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    killsFileLines: [216, 219, 221],
  },
  {
    name: 'Downloads vault via / still deletes',
    path: 'C:/Users/me/Downloads/v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    killsFileLines: [306, 309],
  },
  {
    name: 'Downloads vault via DOWNLO~1\\v still deletes',
    path: 'C:\\Users\\me\\DOWNLO~1\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    killsFileLines: [306, 309, 311],
  },
  {
    name: 'short-Desktop MYDESK~1\\v still deletes',
    path: 'C:\\Users\\me\\MYDESK~1\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\My Desktop' },
    expect: 'delete',
    killsFileLine: 281,
  },
  {
    name: 'Documents\\MYDESK~1 must not delete My Desktop',
    path: 'C:\\Users\\me\\Documents\\MYDESK~1',
    env: HARD_A_DESK_UNDER_DOCS,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\My Desktop'],
  },
  {
    name: 'Downloads\\DESKTO~1 must not delete Desktop',
    path: 'C:\\Users\\me\\Downloads\\DESKTO~1',
    env: HARD_A_DESK_UNDER_DL,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\Desktop'],
  },
  {
    name: 'PROGRA~1 must not pass the deny list',
    path: 'C:\\PROGRA~1\\Mythos\\bin',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Program Files\\Mythos\\bin'],
  },
  {
    name: 'short-form DOCUME~1 root still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD_A_SHORT_DOCS,
    expect: 'delete',
    killsFileLine: 152,
    killsFileLines: [152, 332],
  },
  {
    name: 'short-form APPDAT~1 root still deletes a Mythos vault',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: HARD_A_SHORT_APPDATA,
    expect: 'delete',
  },
  {
    name: 'real vault Notes~1 still deletes',
    path: 'C:\\Users\\me\\Documents\\Notes~1',
    env: HARD12_ENV_E1,
    expect: 'delete',
  },
  {
    name: 'PROGRA~1 PROGRAMFILES inside the allowlist must still deny Shared Docs\\v',
    path: 'C:\\Program Files\\Shared Docs\\v',
    env: {
      ...HARD12_ENV_E1,
      PROGRAMFILES: 'C:\\PROGRA~1',
      DOCUMENTS: 'C:\\Program Files\\Shared Docs',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Program Files\\Shared Docs\\v'],
    killsFileLine: 170,
  },
  {
    name: 'APPDATA under an 8.3 parent must not delete AppData\\Roaming',
    path: 'C:\\Users\\me\\AppData\\Roaming',
    env: {
      ...HARD12_ENV_E1,
      APPDATA: 'C:\\Users\\me\\APPDAT~1\\Roaming',
      DOCUMENTS: 'C:\\Users\\me\\AppData',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming'],
    killsFileLine: 363,
  },
  {
    name: 'Desktop under an 8.3 parent must not delete Documents\\Desktop',
    path: 'C:\\Users\\me\\Documents\\Desktop',
    env: {
      ...HARD12_ENV_E1,
      DESKTOP: 'C:\\Users\\me\\DOCUME~1\\Desktop',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\Desktop'],
    killsFileLine: 415,
  },
  {
    name: 'short DOCUME~1 vault path under a long Documents root still deletes',
    path: 'C:\\Users\\me\\DOCUME~1\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    killsFileLine: 143,
  },
  {
    name: 'short DESKTO~1 root still deletes a long Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\DESKTO~1' },
    expect: 'delete',
    killsFileLine: 260,
  },
  {
    name: 'short ME~1 profile root still deletes a long Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: { ...HARD12_ENV_E1, PROFILE: 'C:\\Users\\ME~1' },
    expect: 'delete',
    killsFileLine: 290,
  },
  {
    name: 'Downloads prefix compare must not skip a same-length non-prefix Documents child',
    path: 'C:\\Users\\no',
    env: { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users' },
    expect: 'delete',
    killsFileLines: [433, 459],
  },
  {
    name: 'H5 Downloads proper-prefix Documents child still deletes (next char is not \\)',
    path: 'C:\\Users\\me\\Download',
    env: { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users\\me' },
    expect: 'delete',
    killsFileLines: [460, 461],
  },
  {
    name: 'short PROGRAMFILES root must still deny Program Files\\Mythos\\bin',
    path: 'C:\\Program Files\\Mythos\\bin',
    env: { ...HARD12_ENV_E1, PROGRAMFILES: 'C:\\PROGRA~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Program Files\\Mythos\\bin'],
  },
  {
    name: 'short WINDIR root must still deny Windows\\System32',
    path: 'C:\\Windows\\System32\\drivers',
    env: { ...HARD12_ENV_E1, WINDIR: 'C:\\WINDO~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Windows\\System32\\drivers'],
  },
  {
    name: 'short vault path under a long Desktop root still deletes',
    path: 'C:\\Users\\me\\Desktop\\VAULT~1',
    env: HARD12_ENV_E1,
    expect: 'delete',
  },
  {
    name: 'missing WINDIR root skips a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, WINDIR: '' },
    expect: 'skip',
  },
  {
    name: 'missing WINDIR root skips a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, WINDIR: '' },
    expect: 'skip',
  },
  {
    name: 'missing WINDIR root skips a Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: { ...HARD12_ENV_E1, WINDIR: '' },
    expect: 'skip',
  },
  {
    name: 'missing WINDIR root skips an AppData Mythos vault',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: { ...HARD12_ENV_E1, WINDIR: '' },
    expect: 'skip',
  },
  {
    name: 'WINDIR GFPN fault skips a Documents vault (kills :151 0-check Nop)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailPaths: ['C:\\Windows'] },
    killsFileLine: 153,
  },
  {
    name: 'WINDIR GLP fault skips a Documents vault (kills :150/:151)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnFailPaths: ['C:\\Windows'] },
    killsFileLines: [155, 156],
  },
  {
    name: 'WINDIR GLP trunc skips a Documents vault (kills :152)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncPaths: ['C:\\Windows'] },
    killsFileLine: 157,
  },
  {
    name: 'PROGRAMFILES GFPN fault skips a Documents vault (kills :158)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailPaths: ['C:\\Program Files'] },
    killsFileLine: 168,
  },
  {
    name: 'PROGRAMFILES GLP fault skips a Documents vault (kills :161)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnFailPaths: ['C:\\Program Files'] },
    killsFileLine: 171,
  },
  {
    name: 'PROGRAMFILES GLP trunc skips a Documents vault (kills :162)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncPaths: ['C:\\Program Files'] },
    killsFileLine: 172,
  },
  {
    name: 'PROGRAMFILES64 GFPN fault skips a Documents vault (kills :168)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailPaths: ['C:\\Program Files (x86)'] },
    killsFileLine: 183,
  },
  {
    name: 'PROGRAMFILES64 GLP fault skips a Documents vault (kills :170/:171)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnFailPaths: ['C:\\Program Files (x86)'] },
    killsFileLines: [185, 186],
  },
  {
    name: 'PROGRAMFILES64 GLP trunc skips a Documents vault (kills :172)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncPaths: ['C:\\Program Files (x86)'] },
    killsFileLine: 187,
  },
  {
    name: 'Documents nested GFPN 3rd-call fault skips (GFPN fail is not next-root)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\Documents': 3 } },
    killsFileLine: 387,
  },
  {
    name: 'Documents nested GLP fault still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnFailFileLines: [389] },
    killsFileLines: [390, 396],
  },
  {
    name: 'Documents nested GLP at :299 trunc skips (kills :301, not :259)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncFileLines: [389] },
    killsFileLine: 392,
  },
  {
    name: 'Desktop nested GFPN 3rd-call fault skips (GFPN fail is not next-root)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\Desktop': 3 } },
    killsFileLine: 413,
  },
  {
    name: 'Desktop nested GLP fault still deletes a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnFailFileLines: [415] },
    killsFileLines: [416, 422],
  },
  {
    name: 'Desktop nested GLP at :313 trunc skips (kills :315, not :259)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncFileLines: [415] },
    killsFileLine: 418,
  },
  {
    name: 'Downloads nested GFPN 3rd-call fault skips (GFPN fail is not next-root)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\Downloads': 3 } },
    killsFileLine: 439,
  },
  {
    name: 'Downloads nested GLP fault still deletes a Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnFailFileLines: [441] },
    killsFileLines: [442, 448],
  },
  {
    name: 'Downloads nested GLP at :327 trunc skips (kills :329, not :259)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncFileLines: [441] },
    killsFileLine: 444,
  },
  {
    name: 'canon-root GFPN 2nd-call fault skips a Documents vault (kills :257)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\Documents': 2 } },
    killsFileLine: 330,
  },
  {
    name: 'canon-root GFPN 2nd-call trunc skips a Documents vault (kills :258)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\Documents': 2 } },
    killsFileLine: 331,
  },
  {
    name: 'path GLP 1st-call fault skips (kills :144)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnFailNth: { 'C:\\Users\\me\\Documents\\MyVault': 1 } },
    killsFileLine: 144,
  },
  {
    name: 'path GLP 1st-call trunc skips (kills :145)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncNth: { 'C:\\Users\\me\\Documents\\MyVault': 1 } },
    killsFileLine: 145,
  },
  {
    name: 'PROGRAMFILES GFPN trunc skips a Documents vault (kills :159)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncPaths: ['C:\\Program Files'] },
    killsFileLine: 169,
  },
  {
    name: 'PROGRAMFILES64 GFPN trunc skips a Documents vault (kills :169)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncPaths: ['C:\\Program Files (x86)'] },
    killsFileLine: 184,
  },
  {
    name: 'APPDATA allow GFPN 1st-call fault skips (kills :178)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer': 1 } },
    killsFileLine: 198,
  },
  {
    name: 'APPDATA allow GFPN 1st-call trunc skips (kills :179)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer': 1 } },
    killsFileLine: 199,
  },
  {
    name: 'APPDATA allow GLP 1st-call fault still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnFailNth: { 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer': 1 } },
  },
  {
    name: 'APPDATA allow GLP 1st-call trunc skips (kills :182)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncNth: { 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer': 1 } },
    killsFileLine: 203,
  },
  {
    name: 'Documents allow GFPN 1st-call fault skips (kills :196)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\Documents': 1 } },
    killsFileLine: 228,
  },
  {
    name: 'Documents allow GFPN 1st-call trunc skips (kills :197)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\Documents': 1 } },
    killsFileLine: 229,
  },
  {
    name: 'Documents allow GLP 1st-call fault still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnFailNth: { 'C:\\Users\\me\\Documents': 1 } },
  },
  {
    name: 'Documents allow GLP 1st-call trunc skips (kills :200)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncNth: { 'C:\\Users\\me\\Documents': 1 } },
    killsFileLine: 233,
  },
  {
    name: 'Desktop allow GFPN 1st-call fault skips (kills :214)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\Desktop': 1 } },
    killsFileLine: 258,
  },
  {
    name: 'Desktop allow GFPN 1st-call trunc skips (kills :215)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\Desktop': 1 } },
    killsFileLine: 259,
  },
  {
    name: 'Desktop allow GLP 1st-call fault still deletes a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnFailNth: { 'C:\\Users\\me\\Desktop': 1 } },
  },
  {
    name: 'Desktop allow GLP 1st-call trunc skips (kills :218)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncNth: { 'C:\\Users\\me\\Desktop': 1 } },
    killsFileLine: 263,
  },
  {
    name: 'Downloads allow GFPN 1st-call fault skips (kills :232)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\Downloads': 1 } },
    killsFileLine: 288,
  },
  {
    name: 'Downloads allow GFPN 1st-call trunc skips (kills :233)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\Downloads': 1 } },
    killsFileLine: 289,
  },
  {
    name: 'Downloads allow GLP 1st-call fault still deletes a Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnFailNth: { 'C:\\Users\\me\\Downloads': 1 } },
  },
  {
    name: 'Downloads allow GLP 1st-call trunc skips (kills :236)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncNth: { 'C:\\Users\\me\\Downloads': 1 } },
    killsFileLine: 293,
  },
  {
    name: 'canon path GFPN 2nd-call fault skips (kills :251)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\Documents\\MyVault': 2 } },
    killsFileLine: 319,
  },
  {
    name: 'canon path GFPN 2nd-call trunc skips (kills :252)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\Documents\\MyVault': 2 } },
    killsFileLine: 320,
  },
  {
    name: 'canon path GLP 2nd-call fault skips (kills :254)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnFailNth: { 'C:\\Users\\me\\Documents\\MyVault': 2 } },
    killsFileLine: 322,
  },
  {
    name: 'canon path GLP 2nd-call trunc skips (kills :255)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncNth: { 'C:\\Users\\me\\Documents\\MyVault': 2 } },
    killsFileLine: 323,
  },
  {
    name: 'canon-root GLP at :259 fault skips a Documents vault (kills :259)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnFailFileLines: [332] },
  },
  {
    name: 'canon-root GLP 2nd-call fault skips (kills :260)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnFailNth: { 'C:\\Users\\me\\Documents': 2 } },
    killsFileLine: 333,
  },
  {
    name: 'canon-root GLP 2nd-call trunc skips (kills :261)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncNth: { 'C:\\Users\\me\\Documents': 2 } },
    killsFileLine: 334,
  },
  {
    name: 'AppData nested GFPN 2nd-call fault skips (GFPN fail is not next-root)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnFailNth: { 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer': 2 } },
    killsFileLine: 361,
  },
  {
    name: 'AppData nested GFPN 2nd-call trunc skips (kills :284)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer': 2 } },
    killsFileLine: 362,
  },
  {
    name: 'AppData nested GLP 2nd-call fault still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnFailNth: { 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer': 2 } },
    killsFileLines: [364, 370],
  },
  {
    name: 'AppData nested GLP 2nd-call trunc skips (kills :287)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { glpnTruncNth: { 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer': 2 } },
    killsFileLine: 366,
  },
  {
    name: 'Documents nested GFPN 3rd-call trunc skips (kills :298)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\Documents': 3 } },
    killsFileLine: 388,
  },
  {
    name: 'Desktop nested GFPN 3rd-call trunc skips (kills :312)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\Desktop': 3 } },
    killsFileLine: 414,
  },
  {
    name: 'Downloads nested GFPN 3rd-call trunc skips (kills :326)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { gfpnTruncNth: { 'C:\\Users\\me\\Downloads': 3 } },
    killsFileLine: 440,
  },
  {
    name: ':164 $1 revert would delete Program Files\\Shared Docs\\v (canonical skips)',
    path: 'C:\\PROGRA~1\\Shared Docs\\v',
    env: { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Program Files\\Shared Docs' },
    expect: 'skip',
    mustNotDelete: ['C:\\Program Files\\Shared Docs\\v'],
  },
  {
    name: 'missing PROGRAMFILES root skips a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, PROGRAMFILES: '' },
    expect: 'skip',
  },
  {
    name: 'missing PROGRAMFILES root skips a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, PROGRAMFILES: '' },
    expect: 'skip',
  },
  {
    name: 'missing PROGRAMFILES root skips a Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: { ...HARD12_ENV_E1, PROGRAMFILES: '' },
    expect: 'skip',
  },
  {
    name: 'missing PROGRAMFILES root skips an AppData Mythos vault',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: { ...HARD12_ENV_E1, PROGRAMFILES: '' },
    expect: 'skip',
  },
  {
    name: 'missing PROGRAMFILES64 root skips a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, PROGRAMFILES64: '' },
    expect: 'skip',
  },
  {
    name: 'missing PROGRAMFILES64 root skips a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, PROGRAMFILES64: '' },
    expect: 'skip',
  },
  {
    name: 'missing PROGRAMFILES64 root skips a Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: { ...HARD12_ENV_E1, PROGRAMFILES64: '' },
    expect: 'skip',
  },
  {
    name: 'missing PROGRAMFILES64 root skips an AppData Mythos vault',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: { ...HARD12_ENV_E1, PROGRAMFILES64: '' },
    expect: 'skip',
  },
  {
    name: 'missing APPDATA root still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, APPDATA: '' },
    expect: 'delete',
  },
  {
    name: 'missing APPDATA root still deletes a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, APPDATA: '' },
    expect: 'delete',
  },
  {
    name: 'missing APPDATA root still deletes a Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: { ...HARD12_ENV_E1, APPDATA: '' },
    expect: 'delete',
  },
  {
    name: 'missing APPDATA root skips an AppData Mythos vault',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: { ...HARD12_ENV_E1, APPDATA: '' },
    expect: 'skip',
  },
  {
    name: 'missing DOCUMENTS root skips a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, DOCUMENTS: '' },
    expect: 'skip',
  },
  {
    name: 'missing DOCUMENTS root skips a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, DOCUMENTS: '' },
    expect: 'skip',
  },
  {
    name: 'missing DOCUMENTS root skips a Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: { ...HARD12_ENV_E1, DOCUMENTS: '' },
    expect: 'skip',
  },
  {
    name: 'missing DOCUMENTS root skips an AppData Mythos vault (nested GFPN fail-closed)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: { ...HARD12_ENV_E1, DOCUMENTS: '' },
    expect: 'skip',
  },
  {
    name: 'missing DESKTOP root skips a Documents vault (nested GFPN fail-closed)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, DESKTOP: '' },
    expect: 'skip',
  },
  {
    name: 'missing DESKTOP root skips a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: '' },
    expect: 'skip',
  },
  {
    name: 'missing DESKTOP root skips a Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: '' },
    expect: 'skip',
  },
  {
    name: 'missing DESKTOP root skips an AppData Mythos vault (nested GFPN fail-closed)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: { ...HARD12_ENV_E1, DESKTOP: '' },
    expect: 'skip',
  },
  {
    name: 'missing PROFILE root still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, PROFILE: '' },
    expect: 'delete',
  },
  {
    name: 'missing PROFILE root still deletes a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, PROFILE: '' },
    expect: 'delete',
  },
  {
    name: 'missing PROFILE root skips a Downloads vault',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: { ...HARD12_ENV_E1, PROFILE: '' },
    expect: 'skip',
  },
  {
    name: 'missing PROFILE root still deletes an AppData Mythos vault',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: { ...HARD12_ENV_E1, PROFILE: '' },
    expect: 'delete',
  },
  {
    name: 'H3a EVIL~1 trailing-space nested Desktop must skip',
    path: 'C:\\Users\\me\\Documents\\EVIL~1',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Documents\\evil' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\evil', 'C:\\Users\\me\\Documents\\evil '],
  },
  {
    name: 'H3a EVILD~1 trailing-dot nested Desktop must skip',
    path: 'C:\\Users\\me\\Documents\\EVILD~1',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Documents\\evil' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\evil', 'C:\\Users\\me\\Documents\\evil.'],
  },
  {
    name: 'H3a EVILT~1 trailing-TAB nested Desktop must skip',
    path: 'C:\\Users\\me\\Documents\\EVILT~1',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Documents\\evil' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\evil'],
  },
  {
    name: 'H3a DESKTO~2 trailing-space decoy must skip',
    path: 'C:\\Users\\me\\Downloads\\DESKTO~2',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Downloads\\Desktop' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\Desktop', 'C:\\Users\\me\\Downloads\\Desktop '],
  },
  {
    name: 'H3a DESKTO~3 trailing-dot decoy must skip',
    path: 'C:\\Users\\me\\Downloads\\DESKTO~3',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Downloads\\Desktop' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\Desktop'],
  },
  {
    name: 'H3a DESKTO~4 trailing-TAB decoy must skip',
    path: 'C:\\Users\\me\\Downloads\\DESKTO~4',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Downloads\\Desktop' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\Desktop'],
  },
  {
    name: 'H3b EVIL~1 junction decoy walk must skip',
    path: 'C:\\Users\\me\\Documents\\EVIL~1\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\evil', 'C:\\Users\\me\\Documents\\evil \\x'],
    options: { reparsePaths: ['C:\\Users\\me\\Documents\\evil '] },
  },
  {
    name: 'H3b EVILD~1 junction decoy walk must skip',
    path: 'C:\\Users\\me\\Documents\\EVILD~1\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    options: { reparsePaths: ['C:\\Users\\me\\Documents\\evil.'] },
  },
  {
    name: 'H3b EVILT~1 junction decoy walk must skip',
    path: 'C:\\Users\\me\\Documents\\EVILT~1\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\evil', 'C:\\Users\\me\\Documents\\evil\t\\x'],
    options: { reparsePaths: ['C:\\Users\\me\\Documents\\evil\t'] },
  },
  {
    name: 'H3 root DESKTO~2 (Desktop ) fail-closed skips a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\DESKTO~2' },
    expect: 'skip',
  },
  {
    name: 'H3 root DESKTO~3 (Desktop.) fail-closed skips a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\DESKTO~3' },
    expect: 'skip',
  },
  {
    name: 'H3 root DESKTO~4 (Desktop TAB) fail-closed skips a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\DESKTO~4' },
    expect: 'skip',
  },
  {
    name: 'H3 line vault~2 trailing-space component must skip',
    path: 'C:\\Users\\me\\Documents\\VAULT~2',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\vault'],
  },
  {
    name: 'missing-folder Downloads root still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { missingPaths: ['C:\\Users\\me\\Downloads'] },
  },
  {
    name: 'missing-folder Desktop root still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { missingPaths: ['C:\\Users\\me\\Desktop'] },
  },
  {
    name: 'missing-folder Documents root still deletes a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { missingPaths: ['C:\\Users\\me\\Documents'] },
  },
  {
    name: 'missing-folder AppData root still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { missingPaths: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer'] },
  },
  {
    name: 'missing-folder Downloads root still skips nested Desktop',
    path: 'C:\\Users\\me\\Downloads\\Desktop',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Downloads\\Desktop' },
    expect: 'skip',
    options: { missingPaths: ['C:\\Users\\me\\Downloads'] },
  },
  {
    name: 'missing-folder vault path skips (line GLP fail-closed)',
    path: 'C:\\Users\\me\\Documents\\NoSuchVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
  },
  {
    name: 'H4 fallback Desktop GFPN intermediate trailing-space still H3-skips a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\evil \\Desktop' },
    expect: 'skip',
  },
  {
    name: 'H4 fallback Desktop GFPN intermediate trailing-TAB still H3-skips a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\evil\t\\Desktop' },
    expect: 'skip',
  },
  {
    name: 'Desktop GLP access-denied is not a parent prefix; Documents vault still deletes',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    mustNotDelete: ['C:\\Users\\me', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 260: 5 } },
  },
  {
    name: 'Desktop GLP access-denied skips the Desktop vault (no GFPN fallback)',
    path: 'C:\\Users\\me\\Desktop\\DeskVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me', 'C:\\Users\\me\\Desktop', 'C:\\Users\\me\\Desktop\\DeskVault'],
    options: { glpnErrno: { 'C:\\Users\\me\\Desktop': 5 } },
  },
  {
    name: 'empty Desktop GFPN fails closed; Documents vault skips',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, DESKTOP: '' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me', 'C:\\Users\\me\\Desktop', 'C:\\Users\\me\\Documents\\MyVault'],
  },
  {
    name: 'empty Documents GFPN fails closed (empty root is never a prefix)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, DOCUMENTS: '' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me', 'C:\\Users\\me\\Documents', 'C:\\Users\\me\\Desktop\\v'],
  },
  {
    name: 'Downloads GLP PATH_NOT_FOUND (3) existing Downloads skips (S-19 no fallback)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\v', 'C:\\Users\\me\\Downloads'],
    options: { glpnErrnoFileLines: { 290: 3, 441: 3 } },
  },
  {
    name: 'Downloads GLP PATH_NOT_FOUND (3) helper GFA fail still falls back; deletes',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: {
      // GLP errno 3 on an existing string; helper GFA of the leftover root
      // is INVALID so 2/3 fallback H3s. Walk starts after $1 and still sees
      // the vault leaf (invalidAttr is the root only, not descendants).
      glpnErrnoFileLines: { 290: 3, 441: 3 },
      invalidAttrPaths: ['C:\\Users\\me\\Downloads'],
    },
    killsFileLines: [298, 449],
  },
  {
    name: 'Downloads GLP access-denied skips the Downloads vault (no GFPN fallback)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me', 'C:\\Users\\me\\Downloads'],
    options: { glpnErrno: { 'C:\\Users\\me\\Downloads': 5 } },
  },
  {
    name: 'AppData nested GFPN fail skips a Documents vault (no next-root)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault'],
    options: { gfpnFailFileLines: [360] },
    killsFileLine: 361,
  },
  {
    name: 'nested Documents GLP access-denied skips OneDrive ancestor (no next-root)',
    path: 'C:\\Users\\me\\OneDrive',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me', DOCUMENTS: 'C:\\Users\\me\\OneDrive\\Documents' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\OneDrive', 'C:\\Users\\me\\Documents'],
    options: { glpnErrnoFileLines: { 389: 5 } },
  },
  {
    name: 'nested Desktop GLP access-denied skips OneDrive ancestor (no next-root)',
    path: 'C:\\Users\\me\\OneDrive',
    env: { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users\\me', DESKTOP: 'C:\\Users\\me\\OneDrive\\Desktop' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\OneDrive', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 415: 5 } },
  },
  {
    name: 'nested Downloads GLP access-denied skips Users\\me ancestor (no next-root)',
    path: 'C:\\Users\\me',
    env: { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users', DESKTOP: 'C:\\Desktop', PROFILE: 'C:\\Users\\me' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me', 'C:\\Users\\me\\Downloads'],
    options: { glpnErrnoFileLines: { 441: 5 } },
  },
  {
    name: 'nested Documents GLP access-denied skips a Documents vault (no next-root)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault'],
    options: {
      glpnErrnoFileLines: { 389: 5 },
      // Leftover GFPN Documents is the walk root ($1), so walk never GFAs it.
      // Helper GFA INVALID → H3 leftover; Nop :398 then deletes the vault.
      invalidAttrPaths: ['C:\\Users\\me\\Documents'],
    },
    killsFileLines: [391, 398],
  },
  {
    name: 'nested Desktop GLP access-denied skips a Desktop vault (no next-root)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v'],
    options: {
      glpnErrnoFileLines: { 415: 5 },
      invalidAttrPaths: ['C:\\Users\\me\\Desktop'],
    },
    killsFileLines: [417, 424],
  },
  {
    name: 'nested Downloads GLP access-denied skips a Downloads vault (no next-root)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\v'],
    options: {
      glpnErrnoFileLines: { 441: 5 },
      invalidAttrPaths: ['C:\\Users\\me\\Downloads'],
    },
    killsFileLines: [443, 450],
  },
  {
    name: 'H5 Documents root junction still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { reparsePaths: ['C:\\Users\\me\\Documents'] },
    killsFileLine: 350,
  },
  {
    name: 'H5 Desktop root junction still deletes a Desktop vault',
    path: 'C:\\Users\\me\\Desktop\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { reparsePaths: ['C:\\Users\\me\\Desktop'] },
    killsFileLine: 350,
  },
  {
    name: 'H5 profile junction still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { reparsePaths: ['C:\\Users\\me'] },
    killsFileLine: 350,
  },
  {
    name: 'H5 C:\\Users junction still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { reparsePaths: ['C:\\Users'] },
    killsFileLine: 350,
  },
  {
    name: 'H5 C:\\Users GFA error still deletes a Documents vault',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { attrErrorPaths: ['C:\\Users'] },
    killsFileLine: 350,
  },
  {
    name: 'H6 :393 short DOCUMENTS nested under Desktop; parent My Desktop skips',
    path: 'C:\\Users\\me\\Desktop\\My Desktop',
    env: {
      ...HARD12_ENV_E1,
      DOCUMENTS: 'C:\\Users\\me\\Desktop\\MYDESK~1\\Docs',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\My Desktop', 'C:\\Users\\me\\Desktop\\My Desktop\\Docs'],
    killsFileLine: 393,
  },
  {
    name: 'H6 :445 short PROFILE Downloads; parent My Desktop skips',
    path: 'C:\\Users\\me\\Documents\\My Desktop',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\Documents\\MYDESK~1',
    },
    expect: 'skip',
    mustNotDelete: [
      'C:\\Users\\me\\Documents\\My Desktop',
      'C:\\Users\\me\\Documents\\My Desktop\\Downloads',
    ],
    killsFileLine: 445,
  },
  {
    name: 'H6 :372 short APPDATA errno 5 skips Documents\\My Desktop (no next-root)',
    path: 'C:\\Users\\me\\Documents\\My Desktop',
    env: {
      ...HARD12_ENV_E1,
      APPDATA: 'C:\\Users\\me\\Documents\\MYDESK~1\\Roaming',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\My Desktop'],
    options: {
      glpnErrnoFileLines: { 363: 5 },
      // 8.3 Mythos Writer is not a real directory. Helper GFA must be INVALID so
      // :372 Nop falls into the 2/3 helper and H3s (unexpanded GFPN misses) instead
      // of treating the leftover 8.3 root as existing and deny-equivalencing :372.
      invalidAttrPaths: ['C:\\Users\\me\\Documents\\MYDESK~1\\Roaming\\Mythos Writer'],
    },
    killsFileLine: 372,
  },
  {
    name: 'H5 :463 leftover Downloads longer than parent junction still skips',
    path: 'C:\\Users\\me\\Documents\\rf7-parent\\vault',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\Documents\\rf7-parent-and-more',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\rf7-parent\\vault'],
    options: { reparsePaths: ['C:\\Users\\me\\Documents\\rf7-parent'] },
    killsFileLine: 463,
  },
  {
    name: 'H5 shorter Desktop after longer Downloads: plain vault deletes',
    path: 'C:\\Users\\me\\Desktop\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { reparsePaths: ['C:\\Users'] },
    killsFileLine: 350,
  },
  {
    name: 'H5 shorter Desktop after longer Downloads: first-child junction skips',
    path: 'C:\\Users\\me\\Desktop\\desk-junc\\vault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\desk-junc\\vault'],
    options: { reparsePaths: ['C:\\Users\\me\\Desktop\\desk-junc'] },
    killsFileLine: 463,
  },
  {
    name: 'H5 shorter Documents after longer Downloads: plain vault deletes',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\Documents\\dl-leftover-longer-than-doc-junc',
    },
    expect: 'delete',
    options: { reparsePaths: ['C:\\Users'] },
    killsFileLine: 350,
  },
  {
    name: 'H5 shorter Documents after longer Downloads: first-child junction skips',
    path: 'C:\\Users\\me\\Documents\\doc-junc\\vault',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\Documents\\dl-leftover-longer-than-doc-junc',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\doc-junc\\vault'],
    options: { reparsePaths: ['C:\\Users\\me\\Documents\\doc-junc'] },
    killsFileLine: 463,
  },
  {
    name: 'H5 shorter Mythos Writer after longer Downloads: plain vault deletes',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\dl-leftover-longer-than-mw-junc',
    },
    expect: 'delete',
    options: { reparsePaths: ['C:\\Users'] },
    killsFileLine: 350,
  },
  {
    name: 'H5 shorter Mythos Writer after longer Downloads: first-child junction skips',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\mw-junc\\vault',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\dl-leftover-longer-than-mw-junc',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\mw-junc\\vault'],
    options: { reparsePaths: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\mw-junc'] },
    killsFileLine: 463,
  },
  {
    name: 'H6 ME~1 Desktop exact-root nested under Documents skips',
    path: 'C:\\Users\\me\\Documents\\me',
    env: {
      ...HARD12_ENV_E1,
      DESKTOP: 'C:\\Users\\me\\Documents\\ME~1',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\me'],
    killsFileLine: 419,
  },
  {
    name: 'H6 ME~1 Desktop ancestor nested under Documents skips',
    path: 'C:\\Users\\me\\Documents\\me',
    env: {
      ...HARD12_ENV_E1,
      DESKTOP: 'C:\\Users\\me\\Documents\\ME~1\\Sub',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\me'],
    killsFileLine: 419,
  },
  {
    name: 'H6 ME~1 Desktop exact-root nested under Downloads skips',
    path: 'C:\\Users\\me\\Downloads\\me',
    env: {
      ...HARD12_ENV_E1,
      DESKTOP: 'C:\\Users\\me\\Downloads\\ME~1',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\me'],
    killsFileLine: 419,
  },
  {
    name: 'H6 ME~1 Desktop ancestor nested under Downloads skips',
    path: 'C:\\Users\\me\\Downloads\\me',
    env: {
      ...HARD12_ENV_E1,
      DESKTOP: 'C:\\Users\\me\\Downloads\\ME~1\\Sub',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\me'],
    killsFileLine: 419,
  },
  {
    name: 'H6 ME~1 PROFILE Downloads exact-root nested under Documents skips',
    path: 'C:\\Users\\me\\Documents\\me\\Downloads',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\Documents\\ME~1',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\me', 'C:\\Users\\me\\Documents\\me\\Downloads'],
    killsFileLine: 445,
  },
  {
    name: 'H6 ME~1 PROFILE Downloads ancestor nested under Documents skips',
    path: 'C:\\Users\\me\\Documents\\me',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\Documents\\ME~1',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\me'],
    killsFileLine: 445,
  },
  {
    name: 'H6 ME~1 PROFILE Downloads exact-root nested under Downloads skips',
    path: 'C:\\Users\\me\\Downloads\\me\\Downloads',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\Downloads\\ME~1',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\me', 'C:\\Users\\me\\Downloads\\me\\Downloads'],
    killsFileLine: 445,
  },
  {
    name: 'H6 ME~1 PROFILE Downloads ancestor nested under Downloads skips',
    path: 'C:\\Users\\me\\Downloads\\me',
    env: {
      ...HARD12_ENV_E1,
      PROFILE: 'C:\\Users\\me\\Downloads\\ME~1',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\me'],
    killsFileLine: 445,
  },
  {
    name: 'H6 ME~1 APPDATA exact-root nested under Documents skips',
    path: 'C:\\Users\\me\\Documents\\me\\Roaming\\Mythos Writer',
    env: {
      ...HARD12_ENV_E1,
      APPDATA: 'C:\\Users\\me\\Documents\\ME~1\\Roaming',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\me\\Roaming\\Mythos Writer'],
    killsFileLine: 367,
  },
  {
    name: 'H6 ME~1 APPDATA ancestor nested under Documents skips',
    path: 'C:\\Users\\me\\Documents\\me',
    env: {
      ...HARD12_ENV_E1,
      APPDATA: 'C:\\Users\\me\\Documents\\ME~1\\Roaming',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\me'],
    killsFileLine: 367,
  },
  {
    name: 'H6 short-env Mythos Writer GLP errno 5 skips the Mythos vault',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: {
      ...HARD12_ENV_E1,
      APPDATA: 'C:\\Users\\ME~1\\AppData\\Roaming',
    },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: {
      glpnErrnoFileLines: { 363: 5 },
      invalidAttrPaths: ['C:\\Users\\ME~1\\AppData\\Roaming\\Mythos Writer'],
    },
    killsFileLine: 372,
  },
  {
    name: 'HARD-F :200 errno 5 Mythos vault skips (deny; :363 cannot fire)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: { glpnErrnoFileLines: { 200: 5 } },
  },
  {
    name: 'HARD-F :200 errno 2 existing Mythos vault skips (S-19; :363 cannot fire)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: { glpnErrnoFileLines: { 200: 2 } },
    killsFileLine: 210,
  },
  {
    name: 'HARD-F :200 errno 3 existing Mythos vault skips (S-19; :363 cannot fire)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: { glpnErrnoFileLines: { 200: 3 } },
    killsFileLine: 210,
  },
  {
    name: 'HARD-F :230 errno 5 Documents vault skips (deny; nested Documents cannot fire)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault'],
    options: { glpnErrnoFileLines: { 230: 5 } },
  },
  {
    name: 'HARD-F :230 errno 2 existing Documents vault skips (S-19; nested Documents cannot fire)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault'],
    options: { glpnErrnoFileLines: { 230: 2 } },
    killsFileLine: 240,
  },
  {
    name: 'HARD-F :230 errno 3 existing Documents vault skips (S-19; nested Documents cannot fire)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault'],
    options: { glpnErrnoFileLines: { 230: 3 } },
    killsFileLine: 240,
  },
  {
    name: 'HARD-F :260 not-found errno 2 existing Desktop vault skips (S-19; nested Desktop cannot fire)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 260: 2 } },
    killsFileLine: 270,
  },
  {
    name: 'HARD-F :260 errno 5 Desktop vault skips (nested-pass child; :363 cannot save)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 260: 5 } },
  },
  {
    name: 'HARD-F :260 errno 3 existing Desktop vault skips (S-19; nested-pass child)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 260: 3 } },
    killsFileLine: 270,
  },
  {
    name: 'HARD-F :363 errno 5 Mythos vault skips (no next-root; later nested cannot save)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: { glpnErrnoFileLines: { 363: 5 } },
    killsFileLine: 372,
  },
  {
    name: 'HARD-F :363 errno 2 existing Mythos vault skips (S-19; later nested cannot save)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: { glpnErrnoFileLines: { 363: 2 } },
    killsFileLine: 373,
  },
  {
    name: 'HARD-F :363 errno 3 existing Mythos vault skips (S-19; later nested cannot save)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: { glpnErrnoFileLines: { 363: 3 } },
    killsFileLine: 373,
  },
  {
    name: 'HARD-F :237 +3→+5 OneDrive missing Documents never RMDirs OneDrive',
    path: 'C:\\Users\\me\\OneDrive',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me', DOCUMENTS: 'C:\\Users\\me\\OneDrive\\Documents' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\OneDrive', 'C:\\Users\\me\\Documents'],
    options: {
      missingPaths: ['C:\\Users\\me\\OneDrive\\Documents'],
      glpnErrnoFileLines: { 230: 2 },
    },
  },
  {
    name: 'HARD-F H3 no-tag default fail-closed never leftover-Downloads deletes',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
  },
  {
    name: 'S-19 DESKTO~1 errno 2 existing 8.3 Desktop never deletes dangerously',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\DESKTO~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 260: 2 } },
  },
  {
    name: 'S-19 DESKTO~1 errno 3 existing 8.3 Desktop never deletes dangerously',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\DESKTO~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 260: 3 } },
  },
  {
    name: 'S-19 deskto~1 errno 2 existing 8.3 Desktop never deletes dangerously',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\deskto~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 260: 2 } },
  },
  {
    name: 'S-19 deskto~1 errno 3 existing 8.3 Desktop never deletes dangerously',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\deskto~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 260: 3 } },
  },
  {
    name: 'S-19 MYDESK~1 errno 2 existing 8.3 Desktop never deletes dangerously',
    path: 'C:\\Users\\me\\My Desktop\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\MYDESK~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\My Desktop\\v', 'C:\\Users\\me\\My Desktop'],
    options: { glpnErrnoFileLines: { 260: 2 } },
  },
  {
    name: 'S-19 MYDESK~1 errno 3 existing 8.3 Desktop never deletes dangerously',
    path: 'C:\\Users\\me\\My Desktop\\v',
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\MYDESK~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\My Desktop\\v', 'C:\\Users\\me\\My Desktop'],
    options: { glpnErrnoFileLines: { 260: 3 } },
  },
  ...S19_ONEDRIVE_WRONG_TARGET_ROWS,
  {
    name: 'S-19 :290 errno 2 existing Downloads vault skips (helper is the only protection)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\v', 'C:\\Users\\me\\Downloads'],
    options: { glpnErrnoFileLines: { 290: 2 } },
    killsFileLine: 300,
  },
  {
    name: 'S-19 :290 errno 3 existing Downloads vault skips (helper is the only protection)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\v', 'C:\\Users\\me\\Downloads'],
    options: { glpnErrnoFileLines: { 290: 3 } },
    killsFileLine: 300,
  },
  {
    name: 'S-19 :389 errno 2 existing nested Documents vault skips (helper is the only protection)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault', 'C:\\Users\\me\\Documents'],
    options: { glpnErrnoFileLines: { 389: 2 } },
    killsFileLine: 399,
  },
  {
    name: 'S-19 :389 errno 3 existing nested Documents vault skips (helper is the only protection)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault', 'C:\\Users\\me\\Documents'],
    options: { glpnErrnoFileLines: { 389: 3 } },
    killsFileLine: 399,
  },
  {
    name: 'S-19 :415 errno 2 existing nested Desktop vault skips (helper is the only protection)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 415: 2 } },
    killsFileLine: 425,
  },
  {
    name: 'S-19 :415 errno 3 existing nested Desktop vault skips (helper is the only protection)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Desktop'],
    options: { glpnErrnoFileLines: { 415: 3 } },
    killsFileLine: 425,
  },
  {
    name: 'S-19 :441 errno 2 existing nested Downloads vault skips (helper is the only protection)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\v', 'C:\\Users\\me\\Downloads'],
    options: { glpnErrnoFileLines: { 441: 2 } },
    killsFileLine: 451,
  },
  {
    name: 'S-19 :441 errno 3 existing nested Downloads vault skips (helper is the only protection)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Downloads\\v', 'C:\\Users\\me\\Downloads'],
    options: { glpnErrnoFileLines: { 441: 3 } },
    killsFileLine: 451,
  },
  {
    name: 'HARD-F :363 8.3 MYTHOS~1 nested errno 2 existing Mythos vault skips',
    path: 'C:\\Users\\me\\AppData\\Roaming\\MYTHOS~1\\vaults\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: [
      'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
      'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer',
    ],
    options: { glpnErrnoFileLines: { 363: 2 } },
    killsFileLine: 373,
  },
  {
    name: 'HARD-F :363 8.3 MYTHOS~1 nested errno 3 existing Mythos vault skips',
    path: 'C:\\Users\\me\\AppData\\Roaming\\MYTHOS~1\\vaults\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: [
      'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
      'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer',
    ],
    options: { glpnErrnoFileLines: { 363: 3 } },
    killsFileLine: 373,
  },
  {
    name: 'HARD-F :363 8.3 APPDAT~1 nested errno 2 existing Mythos vault skips',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: { ...HARD12_ENV_E1, APPDATA: 'C:\\Users\\me\\APPDAT~1\\Roaming' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: { glpnErrnoFileLines: { 363: 2 } },
    killsFileLine: 373,
  },
  {
    name: 'HARD-F :363 8.3 APPDAT~1 nested errno 3 existing Mythos vault skips',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x',
    env: { ...HARD12_ENV_E1, APPDATA: 'C:\\Users\\me\\APPDAT~1\\Roaming' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: { glpnErrnoFileLines: { 363: 3 } },
    killsFileLine: 373,
  },
  {
    name: 'HARD-F :363 8.3 MYTHOS~1 nested errno 5 Mythos vault skips',
    path: 'C:\\Users\\me\\AppData\\Roaming\\MYTHOS~1\\vaults\\x',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\vaults\\x'],
    options: { glpnErrnoFileLines: { 363: 5 } },
    killsFileLine: 372,
  },
  {
    name: 'Nop AppData equal deletes the nested Mythos Writer root',
    path: 'C:\\Users\\me\\Documents\\mw-nest\\Roaming\\Mythos Writer',
    env: {
      ...HARD12_ENV_E1,
      APPDATA: 'C:\\Users\\me\\Documents\\mw-nest\\Roaming',
    },
    expect: 'skip',
    mustNotDelete: [
      'C:\\Users\\me\\Documents\\mw-nest\\Roaming\\Mythos Writer',
      'C:\\Users\\me\\Documents\\mw-nest',
    ],
    options: { glpnErrnoFileLines: { 200: 5 } },
    killsFileLine: 378,
  },
  {
    name: 'H6 :372 readable 8.3 DOCUME~1 vault; missing Mythos Writer; errno 5 Nop deletes',
    path: 'C:\\Users\\me\\DOCUME~1\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault', 'C:\\Users\\me\\Documents'],
    options: {
      glpnErrnoFileLines: { 363: 5 },
      missingPaths: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer'],
    },
    killsFileLine: 372,
  },
  {
    name: 'HARD-F :327 ct2 trailing-space after canon (EVIL~1 Documents; Desktop is not the decoy)',
    path: 'C:\\Users\\me\\Documents\\EVIL~1',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\evil', 'C:\\Users\\me\\Documents\\evil '],
    killsFileLine: 327,
  },
  {
    name: 'HARD-F :338 9c trailing-space on matched Documents root (EVIL~1 Documents env)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users\\me\\Documents\\EVIL~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault', 'C:\\Users\\me\\Documents\\evil '],
    killsFileLine: 338,
  },
  {
    name: 'HARD-F :376 9a trailing-space nested AppData (allowlist AppData errno 5 so 5a did not scan)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, APPDATA: 'C:\\Users\\me\\Documents\\EVIL~1\\Roaming' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault', 'C:\\Users\\me\\Documents\\evil '],
    options: { glpnErrnoFileLines: { 200: 5 } },
    killsFileLine: 376,
  },
  {
    name: 'HARD-F :402 9d trailing-space nested Documents (allowlist Documents errno 5 so 5d did not scan)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: { ...HARD12_ENV_E1, DOCUMENTS: 'C:\\Users\\me\\Documents\\EVIL~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Desktop\\v', 'C:\\Users\\me\\Documents\\evil '],
    options: { glpnErrnoFileLines: { 230: 5 } },
    killsFileLine: 402,
  },
  {
    name: 'HARD-F :454 9l trailing-space nested Downloads (allowlist Downloads errno 5 so 5l did not scan)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: { ...HARD12_ENV_E1, PROFILE: 'C:\\Users\\me\\Documents\\EVIL~1' },
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault', 'C:\\Users\\me\\Documents\\evil '],
    options: { glpnErrnoFileLines: { 290: 5 } },
    killsFileLine: 454,
  },
  {
    name: 'FindFirst IfFileExists fail on Documents vault still deletes (Delete branch)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { ifFileExistsFailPaths: ['C:\\Users\\me\\Documents\\MyVault'] },
    killsFileLine: 497,
  },
  {
    name: 'GFA error on Documents vault skips (kills :476 Nop)',
    path: RF7_ERROR_VAULT,
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: [RF7_ERROR_VAULT],
    options: { attrErrorPaths: [RF7_ERROR_VAULT] },
    killsFileLine: 476,
  },
  {
    name: 'GFA error on Documents vault leaf skips (kills :483 Nop)',
    path: RF7_ERROR_VAULT,
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: [RF7_ERROR_VAULT],
    options: { attrErrorPaths: [RF7_ERROR_VAULT] },
    killsFileLines: [476, 483],
  },
  {
    name: 'GFPN fault at :360 nested AppData skips a Documents vault (kills :361)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'skip',
    mustNotDelete: ['C:\\Users\\me\\Documents\\MyVault'],
    options: { gfpnFailFileLines: [360] },
    killsFileLine: 361,
  },
  {
    name: 'S-19 :200 errno 2 existing AppData leftover; Documents vault still deletes (kills :547 fb_5a Goto Nop)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnErrnoFileLines: { 200: 2 } },
    killsFileLine: 547,
  },
  {
    name: 'S-19 :230 errno 2 existing Documents leftover; Desktop vault still deletes (kills :552 fb_5d Goto Nop)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnErrnoFileLines: { 230: 2 } },
    killsFileLine: 552,
  },
  {
    name: 'S-19 :260 errno 2 existing Desktop leftover; Downloads vault still deletes (kills :557 fb_5k Goto Nop)',
    path: 'C:\\Users\\me\\Downloads\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnErrnoFileLines: { 260: 2 } },
    killsFileLine: 557,
  },
  {
    name: 'S-19 :290 errno 2 existing Downloads leftover; Documents vault still deletes (kills :567 fb_5l Goto Nop)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: { glpnErrnoFileLines: { 290: 2 } },
    killsFileLine: 567,
  },
  {
    name: 'S-19 :200 errno 2 INVALID GFA leftover; AppData descendant still deletes via H3 (kills :546 fb_5a IntCmp Nop)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\Docs\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: {
      glpnErrnoFileLines: { 200: 2 },
      invalidAttrPaths: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer'],
    },
    killsFileLine: 546,
    killsFileLines: [201, 202, 207, 546],
  },
];

/** PATH_NOT_FOUND (3) still-deletes. One-shot HARD-A tables / tgt3Maxlen; not sweep parity. */
export const SIDECAR_ERRNO3_HARD_A_ROWS: readonly SidecarHardARow[] = [
  {
    name: 'APPDATA GLP PATH_NOT_FOUND (3) helper GFA fail still falls back; deletes (kills :208)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\Docs\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: {
      glpnErrnoFileLines: { 200: 3 },
      invalidAttrPaths: ['C:\\Users\\me\\AppData\\Roaming\\Mythos Writer'],
    },
    killsFileLine: 208,
    killsFileLines: [208],
  },
  {
    name: 'Documents GLP PATH_NOT_FOUND (3) helper GFA fail still falls back; deletes (kills :238)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: {
      glpnErrnoFileLines: { 230: 3, 389: 3 },
      invalidAttrPaths: ['C:\\Users\\me\\Documents'],
    },
    killsFileLine: 238,
    killsFileLines: [238],
  },
  {
    name: 'Desktop GLP PATH_NOT_FOUND (3) helper GFA fail still falls back; deletes (kills :268)',
    path: 'C:\\Users\\me\\Desktop\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: {
      glpnErrnoFileLines: { 260: 3, 415: 3 },
      invalidAttrPaths: ['C:\\Users\\me\\Desktop'],
    },
    killsFileLine: 268,
    killsFileLines: [268],
  },
  {
    name: 'Nested Documents GLP PATH_NOT_FOUND (3) helper GFA fail still falls back; deletes (kills :397)',
    path: 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\Docs\\v',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: {
      glpnErrnoFileLines: { 389: 3 },
      invalidAttrPaths: ['C:\\Users\\me\\Documents'],
    },
    killsFileLine: 397,
    killsFileLines: [397],
  },
  {
    name: 'Nested Desktop GLP PATH_NOT_FOUND (3) helper GFA fail still falls back; deletes (kills :423)',
    path: 'C:\\Users\\me\\Documents\\MyVault',
    env: HARD12_ENV_E1,
    expect: 'delete',
    options: {
      glpnErrnoFileLines: { 415: 3 },
      invalidAttrPaths: ['C:\\Users\\me\\Desktop'],
    },
    killsFileLine: 423,
    killsFileLines: [423],
  },
];


export const SIDECAR_H3_H4_COMBINED_ROWS: readonly {
  name: string;
  rawLines: readonly string[];
  env: SidecarNsisVarEnv;
  options?: Omit<SidecarNsisRunOptions, 'env'>;
  expectDeleted: readonly string[];
  mustNotDelete: readonly string[];
}[] = [
  {
    name: 'H4 missing Downloads + H3 EVIL~1 trailing-space: skip decoy, delete legit Documents vault',
    rawLines: [
      'C:\\Users\\me\\Documents\\EVIL~1\r\n',
      'C:\\Users\\me\\Documents\\MyVault\r\n',
    ],
    env: { ...HARD12_ENV_E1, DESKTOP: 'C:\\Users\\me\\Documents\\evil' },
    options: { missingPaths: ['C:\\Users\\me\\Downloads'] },
    expectDeleted: ['C:\\Users\\me\\Documents\\MyVault'],
    mustNotDelete: ['C:\\Users\\me\\Documents\\evil', 'C:\\Users\\me\\Documents\\evil '],
  },
];

export function assertSidecarH3H4CombinedTables(nsh: string): void {
  for (const row of SIDECAR_H3_H4_COMBINED_ROWS) {
    let deleted: string[];
    try {
      deleted = simulateSidecarDeleteReadLoop(nsh, row.rawLines, row.env, row.options ?? {}).deleted;
    } catch (err) {
      throw new Error(
        `H3/H4 combined ${row.name}: threw ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (deleted.join('\0') !== [...row.expectDeleted].join('\0')) {
      throw new Error(
        `H3/H4 combined ${row.name}: expected ${JSON.stringify(row.expectDeleted)}, got ${JSON.stringify(deleted)}`,
      );
    }
    for (const ban of row.mustNotDelete) {
      if (deleted.includes(ban)) {
        throw new Error(`H3/H4 combined ${row.name}: must not delete ${JSON.stringify(ban)}, got ${JSON.stringify(deleted)}`);
      }
    }
  }
}

export function assertSidecarH3H4CombinedSweepParity(mutantNsh: string, canonicalNsh: string): void {
  for (const row of SIDECAR_H3_H4_COMBINED_ROWS) {
    const canonical = simulateSidecarDeleteReadLoop(canonicalNsh, row.rawLines, row.env, row.options ?? {}).deleted.join('\0');
    const mutant = simulateSidecarDeleteReadLoop(mutantNsh, row.rawLines, row.env, row.options ?? {}).deleted.join('\0');
    if (mutant !== canonical) {
      throw new Error(`H3/H4 combined sweep parity ${row.name}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`);
    }
  }
}

export function sidecarHardADeleted(nsh: string, row: SidecarHardARow): string[] {
  return simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env, row.options ?? {}).deleted;
}

export function assertSidecarHardATables(nsh: string): void {
  for (const row of sidecarHardAAllRows()) {
    let deleted: string[];
    try {
      deleted = sidecarHardADeleted(nsh, row);
    } catch (err) {
      throw new Error(
        `HARD-A ${row.name}: expected ${row.expect}, threw ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (row.expect === 'skip') {
      if (deleted.length !== 0) {
        throw new Error(`HARD-A ${row.name}: expected skip, deleted ${JSON.stringify(deleted)}`);
      }
    } else if (deleted.length !== 1 || (deleted[0] !== row.path && deleted[0] !== glpnModel(gfpnModel(row.path)))) {
      throw new Error(`HARD-A ${row.name}: expected delete ${JSON.stringify(row.path)}, deleted ${JSON.stringify(deleted)}`);
    }
    for (const ban of row.mustNotDelete ?? []) {
      if (deleted.includes(ban)) {
        throw new Error(`HARD-A ${row.name}: must not delete ${JSON.stringify(ban)}, got ${JSON.stringify(deleted)}`);
      }
    }
  }
}

export function assertSidecarHardASweepParity(mutantNsh: string, canonicalNsh: string): void {
  // Oversize / errno-3 rows stay on assertSidecarHardATables (once) and tgt3Maxlen.
  // Putting them on every oracle mutant misses the 40-minute oracle-sweeps cap.
  for (const row of SIDECAR_HARD_A_ROWS) {
    const canonical = sidecarHardADeleted(canonicalNsh, row).join('\0');
    const mutant = sidecarHardADeleted(mutantNsh, row).join('\0');
    if (mutant !== canonical) {
      throw new Error(
        `HARD-A sweep parity ${row.name}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`,
      );
    }
  }
}

/** HARD-C: ancestor-of-root fixtures that kill Documents/Desktop/Downloads sep nop/del. */
export const SIDECAR_HARD_C_ROWS: readonly SidecarHard2NestedRow[] = [
  {
    id: 'HARD-C|OneDrive-Documents-ancestor',
    env: {
      ...HARD12_ENV_E1,
      DESKTOP: 'C:\\Users\\me',
      DOCUMENTS: 'C:\\Users\\me\\OneDrive\\Documents',
    },
    path: 'C:\\Users\\me\\OneDrive',
    expect: 'skip',
  },
  {
    id: 'HARD-C|OneDrive-Desktop-ancestor',
    env: {
      ...HARD12_ENV_E1,
      DOCUMENTS: 'C:\\Users\\me',
      DESKTOP: 'C:\\Users\\me\\OneDrive\\Desktop',
    },
    path: 'C:\\Users\\me\\OneDrive',
    expect: 'skip',
  },
  {
    id: 'HARD-C|Users-me-Downloads-ancestor',
    env: {
      ...HARD12_ENV_E1,
      DOCUMENTS: 'C:\\Users',
      DESKTOP: 'C:\\Desktop',
      PROFILE: 'C:\\Users\\me',
    },
    path: 'C:\\Users\\me',
    expect: 'skip',
  },
];

/** HARD-E: short-form nested-guard rows that kill `$3→$1` on StrLen/StrCmp. */
export const SIDECAR_HARD_E_ROWS: readonly SidecarHard2NestedRow[] = [
  {
    id: 'HARD-E|ME~1-OneDrive-Documents-ancestor',
    env: {
      ...HARD12_ENV_E1,
      DESKTOP: 'C:\\Users\\me',
      DOCUMENTS: 'C:\\Users\\me\\OneDrive\\Documents',
    },
    path: 'C:\\Users\\ME~1\\OneDrive',
    expect: 'skip',
  },
  {
    id: 'HARD-E|ME~1-OneDrive-Desktop-ancestor-swap',
    env: {
      ...HARD12_ENV_E1,
      DOCUMENTS: 'C:\\Users\\me',
      DESKTOP: 'C:\\Users\\me\\OneDrive\\Documents',
    },
    path: 'C:\\Users\\ME~1\\OneDrive',
    expect: 'skip',
  },
  {
    id: 'HARD-E|APPDAT~1-AppData-ancestor',
    env: {
      ...HARD12_ENV_E1,
      DOCUMENTS: 'C:\\Users\\me',
    },
    path: 'C:\\Users\\me\\APPDAT~1',
    expect: 'skip',
  },
];

export function assertSidecarHardCTables(nsh: string): void {
  for (const row of [...SIDECAR_HARD_C_ROWS, ...SIDECAR_HARD_E_ROWS]) {
    let deleted: string[];
    try {
      deleted = simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env).deleted;
    } catch (err) {
      throw new Error(
        `HARD-C ${row.id}: expected ${row.expect}, threw ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (row.expect === 'skip') {
      if (deleted.length !== 0) {
        throw new Error(`HARD-C ${row.id}: expected skip, deleted ${JSON.stringify(deleted)}`);
      }
    } else if (deleted.length !== 1 || deleted[0] !== row.path) {
      throw new Error(`HARD-C ${row.id}: expected delete ${JSON.stringify(row.path)}, deleted ${JSON.stringify(deleted)}`);
    }
  }
}

export function assertSidecarHardCSweepParity(mutantNsh: string, canonicalNsh: string): void {
  for (const row of [...SIDECAR_HARD_C_ROWS, ...SIDECAR_HARD_E_ROWS]) {
    const canonical = simulateSidecarDeleteReadLoop(canonicalNsh, [`${row.path}\r\n`], row.env).deleted.join('\0');
    const mutant = simulateSidecarDeleteReadLoop(mutantNsh, [`${row.path}\r\n`], row.env).deleted.join('\0');
    if (mutant !== canonical) {
      throw new Error(
        `HARD-C sweep parity ${row.id}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`,
      );
    }
  }
}

export type ForgeOracleFamilyScore = Readonly<{ family: string; dangerous: number; falseReject: number }>;

function scoreForgeRows(
  family: string,
  nsh: string,
  rows: readonly { path: string; env: SidecarNsisVarEnv; expect: 'skip' | 'delete'; options?: Omit<SidecarNsisRunOptions, 'env'> }[],
): ForgeOracleFamilyScore {
  let dangerous = 0;
  let falseReject = 0;
  for (const row of rows) {
    const deleted = simulateSidecarDeleteReadLoop(nsh, [`${row.path}\r\n`], row.env, row.options ?? {}).deleted;
    if (row.expect === 'skip') {
      if (deleted.length > 0) {
        dangerous += 1;
      }
    } else if (deleted.length === 0) {
      falseReject += 1;
    }
  }
  return { family, dangerous, falseReject };
}

export function scoreForgeOracleFamilies(nsh: string): readonly ForgeOracleFamilyScore[] {
  return [
    scoreForgeRows('slash', nsh, [
      ...SIDECAR_H1_SLASH_ROWS.map((r) => ({ path: r.path, env: r.env, expect: 'delete' as const, options: r.options })),
      ...SIDECAR_H1_DELETE_SLASH_ROWS.map((r) => ({
        path: r.path,
        env: r.env,
        expect: 'delete' as const,
      })),
    ]),
    scoreForgeRows(
      'helper',
      nsh,
      [],
    ),
    scoreForgeRows('false-reject', nsh, sidecarHardAAllRows().filter((r) => r.expect === 'delete')),
    scoreForgeRows('shortname', nsh, sidecarHardAAllRows()),
    scoreForgeRows('layout', nsh, [
      ...SIDECAR_HARD_C_ROWS,
      ...SIDECAR_HARD_E_ROWS,
      ...SIDECAR_HARD2_NESTED_ROWS.filter((r) => r.id.startsWith('N7|') || r.id.startsWith('N8|')),
    ]),
  ];
}

export function assertForgeOracleFamiliesZeroZero(nsh: string): void {
  for (const score of scoreForgeOracleFamilies(nsh)) {
    if (score.family === 'helper') {
      continue;
    }
    if (score.dangerous !== 0 || score.falseReject !== 0) {
      throw new Error(
        `Forge ${score.family}: dangerous=${score.dangerous} falseReject=${score.falseReject} (want 0/0)`,
      );
    }
  }
}

/** VM behaviour tables only (no exact region pin) — Probe re-baseline sweep mode. */
export function assertSidecarGuardVmBehaviourTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
  options?: SidecarGuardVmBehaviourOptions,
): void {
  assertSidecarFcfbOracleRows(nsh);
  assertSidecarLinearStepCapSelfCheck(nsh, SIDECAR_NSIS_ENV_E1);
  if (!options?.sweepRebaseline) {
    assertSidecarUnifiedVmStepLimitIsFatal();
  }
  if (options?.sweepRebaseline) {
    const canonical = options.canonicalNsh ?? nsh;
    registerCanonicalSweepNsh(canonical);
    assertSidecarGuardVmSweepParity(nsh, canonical, env);
    assertSidecarAllowlistDeleteTables(nsh, env);
    assertSidecarReadTrimGuardTables(nsh, env, { includeExactTrimPin: true });
    assertSidecarDeleteReadLoopTables(nsh, env);
    assertSidecarH7DeleteLoopSweepParity(nsh, canonical, env);
    assertSidecarMultilineTravGuardTables(nsh, env);
    assertSidecarRf456SweepParity(nsh, canonical, env);
    assertSidecarReparseTables(nsh, env);
    assertSidecarReparseSweepParity(nsh, canonical, env);
    assertSidecarH1SlashTables(nsh);
    assertSidecarH1SlashSweepParity(nsh, canonical);
    assertSidecarH1DeleteSlashTables(nsh);
    assertSidecarHard1WildcardSweepParity(nsh, canonical);
    assertSidecarHard2NestedSweepParity(nsh, canonical);
    assertSidecarHardASweepParity(nsh, canonical);
    assertSidecarH3H4CombinedSweepParity(nsh, canonical);
    assertSidecarHardCSweepParity(nsh, canonical);
    return;
  }
  assertSidecarReadTrimGuardTables(nsh, env, { includeExactTrimPin: false });
  assertSidecarRf7ShieldSurvivorTables(nsh);
  assertSidecarDeleteReadLoopTables(nsh, env);
  assertSidecarMultilineTravGuardTables(nsh, env);
  assertSidecarRf456Tables(nsh, env);
  assertSidecarReparseTables(nsh, env);
  assertSidecarH1SlashTables(nsh);
  assertSidecarH1DeleteSlashTables(nsh);
  assertSidecarHard1WildcardTables(nsh);
  assertSidecarHard2NestedTables(nsh);
  assertSidecarHardATables(nsh);
  assertSidecarH3H4CombinedTables(nsh);
  assertSidecarHardCTables(nsh);
  assertTraversalS14LabelSwapRejectTables(nsh);
  assertTraversalVmStepLimitIsFatal();
  assertTraversalRejectAllowTables(nsh);
  assertDenyPrefixVmBehaviourTables(nsh, env);
  assertSidecarAllowlistDeleteTables(nsh, env);
}

/**
 * Probe loosen-guard audit: net `it()` assertions folded into `assertSidecarGuardVmBehaviourTables`.
 * traversal.behavior.test.ts: -1 (H-7 multiline carry covered in helpers, not a separate it).
 */
export const LOOSEN_GUARD_NET_ASSERTION_DELTA: Readonly<Record<string, number>> = {
  'uninstallVaultsNsh.traversal.behavior.test.ts': -1,
};

/** All sidecar guard VM tables (traversal, deny-prefix, APPDATA M5) from the pinned :53–:104 region. */
export function assertSidecarGuardRejectAllowTables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  assertSidecarReadTrimExactStringTables(nsh);
  assertSidecarGuardVmBehaviourTables(nsh, env);
  assertTraversalHardLabelSwapRejectTables(nsh);
}

/** Trailing `\.` / `/.` at path end — backslash + forward branches (Probe H-2 :63). */
export const TRAVERSAL_REJECT_TRAILING_DOT_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\vault\\.',
  'C:/Users/me/Documents/vault/.',
  'D:\\data\\vault\\.',
  'D:/data/vault/.',
];

/** Trailing `\..` / `/..` at path end — both branches (Probe H-2 :68; Documents escape). */
export const TRAVERSAL_REJECT_TRAILING_DOTDOT_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\vault\\..',
  'C:/Users/me/Documents/vault/..',
  'C:\\Users\\me\\Documents\\vault\\..\\note',
  'C:/Users/me/Documents/vault/../note',
];

/** Leading `\..` / `/..` at offset 0 (Probe H-2 :53). */
export const TRAVERSAL_REJECT_LEADING_DOTDOT_PATHS: readonly string[] = [
  String.raw`\..\Users\me\Documents\vault`,
  '/../Users/me/Documents/vault',
];

/** Critic S12 — trailing single- and double-dot vault roots. */
export const TRAVERSAL_REJECT_S12_PATHS: readonly string[] = ['C:\\vault\\.', 'C:\\vault\\..'];

/** Critic S12 — dotted segment names and version-like paths (not traversal). */
export const TRAVERSAL_ALLOW_S12_PATHS: readonly string[] = [
  'C:\\a\\.hidden\\x',
  'C:\\a\\..b\\x',
  'C:/v1.2/x',
];

/** Mixed separator traversal (Ivy product bug :64/:69 — backslash branch must reject `/` after `\.` / `\..`). */
export const TRAVERSAL_REJECT_MIXED_SEPARATOR_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\../Windows',
  'Documents\\./x',
  'Documents/..\\Windows',
  String.raw`\../x`,
  String.raw`\./x`,
  '/..\\x',
  '/.\\x',
];

/** Critic S16 — Win32 segment tail space/tab/dot (must reject). */
export const TRAVERSAL_REJECT_S16_WIN32_SEGMENT_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\.. ',
  `C:\\Users\\me\\Documents\\..${'\t'}`,
  'C:\\Users\\me\\Documents\\ ',
  `C:\\Users\\me\\Documents\\${'\t'}`,
  `C:\\Users\\me\\Documents\\.${'\t'}`,
  'C:\\Users\\me\\Documents\\a/... ',
  'C:\\Users\\me\\Documents\\...',
  'C:\\Users\\me\\Documents\\. ',
  'C:/Users/me/Documents/... ',
  'C:\\Users\\me\\Documents\\vault.',
  'C:\\Users\\me\\Documents\\vault ',
  'C:\\Users\\me\\Documents\\. .',
  'C:\\Users\\me\\Documents\\v ',
  'C:\\Users\\me\\Documents\\v.',
  'C:\\segment\\name.',
];

/**
 * Forge fix item 3 — segment tail (space/TAB/dot) in a middle position, before `/` (:83–:88)
 * and before `\` (:58–:63). Final-segment tails are in TRAVERSAL_REJECT_S16_WIN32_SEGMENT_PATHS.
 */
export const TRAVERSAL_REJECT_MIDDLE_SEGMENT_TAIL_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\.. /Windows',
  'C:\\Users\\me\\Documents\\.. ./Windows',
  'C:\\Users\\me\\Documents\\a./x',
  'C:\\Users\\me\\Documents\\a /x',
  `C:\\Users\\me\\Documents\\a${'\t'}/x`,
  'C:\\Users\\me\\Documents\\a.\\x',
  'C:\\Users\\me\\Documents\\a \\x',
  `C:\\Users\\me\\Documents\\a${'\t'}\\x`,
  'C:\\Users\\me\\Documents\\.. \\Windows',
  'C:\\Users\\me\\Documents\\.. .\\Windows',
  `C:\\Users\\me\\Documents\\..${'\t'}/Windows`,
  `C:\\Users\\me\\Documents\\..${'\t'}\\Windows`,
];

/**
 * Forge fix item 4 — leading space/TAB on a segment, after `\` (:64–:67) and after `/`
 * (:89–:93). Ivy ruling: reject (fail closed). The `..` tails turn an early exit from the
 * scan at the leading-space check into a delete outside Documents.
 */
export const TRAVERSAL_REJECT_LEADING_WS_SEGMENT_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\ x\\..\\..\\Windows',
  `C:\\Users\\me\\Documents\\${'\t'}x\\..\\..\\Windows`,
  'C:\\Users\\me\\Documents\\v/ x/../../Windows',
  `C:\\Users\\me\\Documents\\v/${'\t'}x/../../Windows`,
  'C:\\Users\\me\\Documents\\ a\\x',
  `C:\\Users\\me\\Documents\\${'\t'}a\\x`,
  'C:\\Users\\me\\Documents\\v/ a/x',
  `C:\\Users\\me\\Documents\\v/${'\t'}a/x`,
];

/** Probe hard H-4 / H-5 — dotted segment before later `..` traversal (trav_ok label-swap bypass). */
export const TRAVERSAL_HARD_H4_H5_REJECT_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\.git\\..\\..\\..\\Windows',
  'C:\\Users\\me\\Documents\\a/.git/../../../Windows',
];

/** Probe hard H-6 — `//` in path segment (fwd label-swap must not loop; step cap must fire). */
export const TRAVERSAL_HARD_H6_PATH = 'C:\\Users\\me\\Documents\\a//b';

/**
 * Formerly canonical-only reject rows. Forge fix item 2: also in mode-2 sweep parity, so the
 * :60 register swap and :107 increment mutants are no longer hidden on these paths.
 */
export const TRAVERSAL_REJECT_S16_CANONICAL_ONLY_PATHS: readonly string[] = [
  `C:\\Users\\me\\Documents\\vault\\..${'\t'}\\x`,
  'C:\\Users\\me\\Documents\\.. \\x',
  'C:\\Users\\me\\Documents\\.. .\\x',
  TRAVERSAL_HARD_H6_PATH,
  'Documents\\./x',
];
export const TRAVERSAL_HARD_H6_FWD_LOOP_PATH = '//';

/** Post-S16 pin: inner `StrCmp $4 "." 0 mythos_trav_inc` per branch (Probe H-4/H-5 :66/:83 at d5c5339f). */
export const TRAVERSAL_HARD_H4_TRAV_OK_SWAP_FILE_LINE = 100;
export const TRAVERSAL_HARD_H5_TRAV_OK_SWAP_FILE_LINE = 126;
export const TRAVERSAL_HARD_H6_FWD_SWAP_FILE_LINE = 80;

export const TRAVERSAL_HARD_H7_STRCPY7_RESET_FILE_LINE = 65;

const RF_DOCUMENTS = 'C:\\Users\\me\\Documents';
const RF_DESKTOP = 'C:\\Users\\me\\Desktop';
const RF_DOWNLOADS = 'C:\\Users\\me\\Downloads';
const RF_APPDATA = 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer';
const RF_PROFILE = 'C:\\Users\\me';
const RF_SEPS: readonly string[] = ['\\', '/'];
const RF_TAB = '\t';

/** RF-4 (H8): a colon anywhere but the drive colon at index 1, both branches, every allow root. */
export const TRAVERSAL_REJECT_RF4_COLON_PATHS: readonly string[] = [
  RF_DOCUMENTS,
  RF_DESKTOP,
  RF_APPDATA,
  RF_DOWNLOADS,
].flatMap((root) =>
  RF_SEPS.flatMap((sep) =>
    [
      '..::$INDEX_ALLOCATION',
      '..:x',
      'v:x',
      'v::$DATA',
      `v:x${sep}y`,
      '.::$INDEX_ALLOCATION',
      '...::$DATA',
      `v${sep}..::$INDEX_ALLOCATION${sep}x`,
      `v${sep}..:x`,
      'x::$DATA',
      'foo:bar',
      `v${sep}a:b${sep}c`,
      'C:\\Windows',
    ].map((tail) => `${root}${sep}${tail}`),
  ),
);

/** RF-4: UNC / device prefixes, rejected by the scan itself (never by the allowlist alone). */
export const TRAVERSAL_REJECT_RF4_PREFIX_PATHS: readonly string[] = [
  '\\\\?\\C:\\Users\\me\\Documents\\v',
  '\\\\.\\C:\\Users\\me\\Documents\\v',
  '\\\\server\\share\\v',
  '\\\\?\\UNC\\server\\share\\v',
];

/** RF-5 (H9): an empty segment (doubled separator, any mix) under every root, incl. the profile root. */
export const TRAVERSAL_REJECT_RF5_EMPTY_SEGMENT_PATHS: readonly string[] = [
  RF_DOCUMENTS,
  RF_DESKTOP,
  RF_DOWNLOADS,
  RF_APPDATA,
  RF_PROFILE,
].flatMap((root) => ['\\\\', '\\\\\\', '\\/', '/\\', '//', '\\\\v'].map((tail) => `${root}${tail}`));

/** RF-5: last round's allow rows `v\\`, `v\/`, `v/\` flip to must-reject (doubled separator). */
export const TRAVERSAL_REJECT_RF5_FLIPPED_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\v\\\\',
  'C:\\Users\\me\\Documents\\v\\/',
  'C:\\Users\\me\\Documents\\v/\\',
];

/** Critic root rows the scan rejects: Documents / Desktop / Downloads × both separators, plus `root\/`. */
export const TRAVERSAL_REJECT_ROOT_SCAN_PATHS: readonly string[] = [RF_DOCUMENTS, RF_DESKTOP, RF_DOWNLOADS].flatMap(
  (root) => [
    ...RF_SEPS.flatMap((sep) =>
      [sep + sep, sep.repeat(4), `${sep}.${sep}`, `${sep}x${sep}..${sep}`, `${sep} `].map((tail) => root + tail),
    ),
    `${root}\\/`,
  ],
);

/** S-5: a vault name that begins with a space or TAB is skipped on purpose (both branches). */
export const TRAVERSAL_REJECT_S5_LEADING_WS_PATHS: readonly string[] = RF_SEPS.flatMap((sep) =>
  [' ', RF_TAB].map((ws) => `${RF_DOCUMENTS}${sep}${ws}notes`),
);

export const TRAVERSAL_REJECT_PATHS: readonly string[] = [
  ...TRAVERSAL_REJECT_S12_PATHS,
  ...TRAVERSAL_REJECT_RF4_COLON_PATHS,
  ...TRAVERSAL_REJECT_RF4_PREFIX_PATHS,
  ...TRAVERSAL_REJECT_RF5_EMPTY_SEGMENT_PATHS,
  ...TRAVERSAL_REJECT_RF5_FLIPPED_PATHS,
  ...TRAVERSAL_REJECT_ROOT_SCAN_PATHS,
  ...TRAVERSAL_REJECT_S5_LEADING_WS_PATHS,
  ...TRAVERSAL_REJECT_S16_WIN32_SEGMENT_PATHS,
  ...TRAVERSAL_REJECT_MIDDLE_SEGMENT_TAIL_PATHS,
  ...TRAVERSAL_REJECT_LEADING_WS_SEGMENT_PATHS,
  ...TRAVERSAL_HARD_H4_H5_REJECT_PATHS,
  ...TRAVERSAL_REJECT_MIXED_SEPARATOR_PATHS,
  'C:\\vault\\.\\note',
  'C:\\vault\\..\\note',
  'C:/vault/./note',
  'C:/vault/../note',
  'C:/vault/.',
  'C:/vault/..',
  'C:\\vault\\.',
  'C:\\vault\\..',
  String.raw`C:/vault/.\note`,
  String.raw`C:/vault/..\note`,
  String.raw`C:\vault/.\note`,
  String.raw`C:\vault/..\note`,
  ...TRAVERSAL_REJECT_TRAILING_DOT_PATHS,
  ...TRAVERSAL_REJECT_TRAILING_DOTDOT_PATHS,
  ...TRAVERSAL_REJECT_LEADING_DOTDOT_PATHS,
  String.raw`\..\x`,
  '/../x',
  'C:\\odd\\pre\\..\\post',
  'C:/odd/pre/../post',
  'C:\\a\\..\\..\\Windows',
  '...\\Documents\\..\\..\\Windows',
  'C:\\segment\\..\\peer',
  'C:/segment/../peer',
  'C:/only/../',
  'C:\\only\\..\\',
];

/** Dotted dir names that are not traversal (Probe S9 soft allows). */
export const TRAVERSAL_ALLOW_DOTTED_NAME_PATHS: readonly string[] = [
  'C:\\a\\.git',
  'C:/a/..b',
  'C:\\vault\\.a',
  '/.a',
];

export const TRAVERSAL_ALLOW_S16_DELETE_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\My Vault',
  'C:\\Users\\me\\Documents\\My Vault\\x',
  'C:\\Users\\me\\Documents\\My Vault\\notes',
  'C:\\Users\\me\\Documents\\a.b.c',
  'C:\\Users\\me\\Documents\\v 1.2\\x',
  'C:\\Users\\me\\Documents\\v1.2\\notes',
];

/**
 * Forge fuzz follow-up: valid names whose segment starts `.`/`..`/`...` but is NOT a traversal
 * segment, and a single trailing separator. Canonical deletes all of these (doubled separators
 * are must-reject since RF-5: see TRAVERSAL_REJECT_RF5_FLIPPED_PATHS). The literal swaps on
 * the `.`/`..`-then-separator rejects (`""`/`"\"`/`"/"` → `"."`/`" "`/`"$\t"`, lines :68/:71-:73,
 * :77-:79, :94, :97-:99, :103-:105) wrongly refuse them, so they are the allow rows that catch
 * those stricter mutants. The systematic shapes in sidecarGuardOracleCorpus() generalise the class.
 */
export const TRAVERSAL_ALLOW_SEGMENT_TAIL_DELETE_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\v\\. a',
  `C:\\Users\\me\\Documents\\v\\.${'\t'}a`,
  'C:\\Users\\me\\Documents\\v\\.. a',
  `C:\\Users\\me\\Documents\\v\\..${'\t'}a`,
  'C:\\Users\\me\\Documents\\v\\...a',
  'C:\\Users\\me\\Documents\\v/. a',
  `C:\\Users\\me\\Documents\\v/.${'\t'}a`,
  'C:\\Users\\me\\Documents\\v/.. a',
  `C:\\Users\\me\\Documents\\v/..${'\t'}a`,
  'C:\\Users\\me\\Documents\\v/...a',
  'C:\\Users\\me\\Documents\\v\\',
  'C:\\Users\\me\\Documents\\v/',
];

/**
 * `.x` / `..x` names after either separator: valid names that canonical deletes. The `"x"` literal
 * swaps on the `.`/`..`-then-separator rejects (:71-:74, :77-:79, :97-:100, :103-:105) refuse
 * exactly these, so they are the allow rows that catch them.
 */
export const TRAVERSAL_ALLOW_DOT_LETTER_DELETE_PATHS: readonly string[] = [
  'C:\\Users\\me\\Documents\\v\\.x',
  'C:\\Users\\me\\Documents\\v\\..x',
  'C:\\Users\\me\\Documents\\v/.x',
  'C:\\Users\\me\\Documents\\v/..x',
];

export const TRAVERSAL_ALLOW_PATHS: readonly string[] = [
  'C:\\Users\\me\\Mythos Writer\\vaults\\x',
  'D:/data/vault',
  ...TRAVERSAL_ALLOW_DOTTED_NAME_PATHS,
  ...TRAVERSAL_ALLOW_S12_PATHS,
  ...TRAVERSAL_ALLOW_S16_DELETE_PATHS,
  ...TRAVERSAL_ALLOW_SEGMENT_TAIL_DELETE_PATHS,
  ...TRAVERSAL_ALLOW_DOT_LETTER_DELETE_PATHS,
];

/**
 * Root / empty-child / sibling-boundary rows asserted on the allowlist ALONE. The canonical gate
 * backstops these in the full pipeline, so each root guard (boundary + empty-child, per root) is
 * pinned here without it: a Nop on any of them turns one of these rows into a delete. Same-length
 * siblings, and a non-root path with a `\` where the AppData root ends, pin the per-root prefix checks.
 */
export const ALLOWLIST_ROOT_GUARD_SKIP_PATHS: readonly string[] = [
  RF_APPDATA,
  RF_DOCUMENTS,
  RF_DESKTOP,
  RF_DOWNLOADS,
  `${RF_APPDATA}\\`,
  `${RF_DOCUMENTS}\\`,
  `${RF_DESKTOP}\\`,
  `${RF_DOWNLOADS}\\`,
  `${RF_APPDATA}Old\\v`,
  `${RF_DOCUMENTS}Old\\v`,
  `${RF_DESKTOP}Old\\v`,
  `${RF_DOWNLOADS}Old\\v`,
  `${RF_PROFILE}\\AppData\\Roaming\\Mythos Writez\\v`,
  `${RF_PROFILE}\\Documentz\\v`,
  `${RF_PROFILE}\\Desktoq\\v`,
  `${RF_PROFILE}\\Downloadz\\v`,
  `${RF_PROFILE}\\Pictures\\${'a'.repeat(RF_APPDATA.length - RF_PROFILE.length - '\\Pictures\\'.length)}\\x`,
];

/**
 * Must still delete after the canonical step (Documents / Desktop / Downloads, plus the AppData root).
 * The last three have a `\` where the AppData root ends, so a Nop on the AppData prefix check would
 * hand them to the gate with the AppData root and lose them.
 */
export const CANON_MUST_DELETE_PATHS: readonly string[] = [
  ...[RF_DOCUMENTS, RF_DESKTOP, RF_DOWNLOADS].flatMap((root) =>
    ['My Vault', 'v1.2\\notes', 'a.b.c', 'v 1.2\\x'].map((tail) => `${root}\\${tail}`),
  ),
  `${RF_APPDATA}\\v`,
  ...[RF_DOCUMENTS, RF_DESKTOP, RF_DOWNLOADS].map(
    (root) => `${root}\\${'a'.repeat(RF_APPDATA.length - root.length - 1)}\\x`,
  ),
];

/** GFPN folds `/` so these are allowlist children, not leftover-`/` skips. */
export const ALLOWLIST_GFPN_SLASH_DELETE_PATHS: readonly { raw: string; deleted: string }[] = [
  RF_DOCUMENTS,
  RF_DESKTOP,
  RF_DOWNLOADS,
].map((root) => ({ raw: `${root}/MyVault`, deleted: `${root}\\MyVault` }));

/** Critic: root-equivalent rows the GetFullPathNameW gate ALONE must skip (each root, both separators). */
export const CANON_GATE_ROOT_SKIP_ROWS: readonly { path: string; root: string }[] = [
  RF_DOCUMENTS,
  RF_DESKTOP,
  RF_DOWNLOADS,
].flatMap((root) => [
  ...RF_SEPS.flatMap((sep) =>
    [sep + sep, sep.repeat(4), `${sep}.${sep}`, `${sep}x${sep}..${sep}`, `${sep} `].map((tail) => ({
      path: root + tail,
      root,
    })),
  ),
  { path: `${root}\\/`, root },
  { path: root, root },
]);

/** Must-delete rows for the gate alone, plus a case-folded path (StrCmp is case-insensitive). */
export const CANON_GATE_MUST_DELETE_ROWS: readonly { path: string; root: string }[] = [
  ...[RF_DOCUMENTS, RF_DESKTOP, RF_DOWNLOADS].flatMap((root) =>
    ['My Vault', 'v1.2\\notes', 'a.b.c', 'v 1.2\\x'].map((tail) => ({ path: `${root}\\${tail}`, root })),
  ),
  { path: 'c:\\users\\me\\documents\\v', root: RF_DOCUMENTS },
];

const RF_ALL_ROOTS: readonly string[] = [RF_DOCUMENTS, RF_DESKTOP, RF_DOWNLOADS, RF_APPDATA];

function rfParent(root: string): string {
  return root.slice(0, root.lastIndexOf('\\'));
}

/**
 * Siblings reached through `..`, for the gate alone (the scan rejects `..` first in the pipeline): a
 * same-length sibling needs the prefix compare, a longer one (`rootOld`) the `\` boundary after it.
 */
export const CANON_GATE_SIBLING_SKIP_ROWS: readonly { path: string; root: string }[] = RF_ALL_ROOTS.flatMap(
  (root) => {
    const name = root.slice(root.lastIndexOf('\\') + 1);
    const sameLength = `${name.slice(0, -1)}${name.endsWith('z') ? 'y' : 'z'}`;
    return RF_SEPS.flatMap((sep) =>
      [sameLength, `${name}Old`].map((sibling) => ({ path: `${root}${sep}..${sep}${sibling}${sep}v`, root })),
    );
  },
);

/** Roots spelled non-canonically: their children match only through the root's own GetFullPathNameW. */
export const CANON_GATE_NONCANONICAL_ROOT_DELETE_ROWS: readonly { path: string; root: string }[] = [
  { path: `${RF_PROFILE}\\.\\Documents\\v`, root: `${RF_PROFILE}\\.\\Documents` },
  { path: 'C:/Users/me/Desktop/v', root: 'C:/Users/me/Desktop' },
  { path: `${RF_PROFILE}\\x\\..\\Downloads\\v`, root: `${RF_PROFILE}\\x\\..\\Downloads` },
];

type CanonGateFaultRow = { path: string; root: string } & CanonGateOptions;

/**
 * GetFullPathNameW failing (0 or truncated return) on the path call and on the root call, per root.
 * Each path escapes its root through `..`, and the seeded output register holds a value that passes
 * the containment checks, so a gate that reads past a failed call deletes.
 */
export const CANON_GATE_FAULT_SKIP_ROWS: readonly CanonGateFaultRow[] = RF_ALL_ROOTS.flatMap((root) =>
  (['zero', 'truncate'] as const).flatMap((ret): CanonGateFaultRow[] => [
    { path: `${root}\\..\\x`, root, fault: { call: '$1', ret }, $3: `${root}\\x` },
    { path: `${root}\\..\\x`, root, fault: { call: '$5', ret }, $9: rfParent(root) },
  ]),
);

const RF6_LFCR = '\n\r';

/**
 * RF-6: an LF-then-CR line end must not bring back Critic's 21 rows (7 tails × 3 roots) or the six
 * RF-3 rows, and embedded control chars below 0x20 are rejected. Each entry is one sidecar line.
 */
export const SIDECAR_RF6_MUST_SKIP_LINES: readonly string[] = [
  ...[RF_DOCUMENTS, RF_DESKTOP, RF_DOWNLOADS].flatMap((root) =>
    ['.. ', `..${RF_TAB}`, '...', '. ', 'v.', 'v ', '. .'].map((tail) => `${root}\\${tail}${RF6_LFCR}`),
  ),
  ...['\\.. ', `\\..${RF_TAB}`, '\\...', '\\. ', '\\.. \\x', '/... '].map((tail) => `${RF_DOCUMENTS}${tail}${RF6_LFCR}`),
  `${RF_DOCUMENTS}\\.. \r\n\n`,
  `${RF_DOCUMENTS}\\.. \x01\r\n`,
  `${RF_DOCUMENTS}\\.. \x1f\r\n`,
  `${RF_DOCUMENTS}\\v\x01w\r\n`,
  `${RF_DOCUMENTS}\\v\x1fw\r\n`,
];

/** RF-6: a clean name with an LF-then-CR line end still deletes. */
export const SIDECAR_RF6_MUST_DELETE_LINE = { raw: `${RF_DOCUMENTS}\\ok\n\r`, deleted: `${RF_DOCUMENTS}\\ok` } as const;

/** Every scan-rejected RF-4 / RF-5 / root / S-5 row (one CRLF sidecar line each). */
const RF456_SCAN_REJECT_PATHS: readonly string[] = [
  ...TRAVERSAL_REJECT_RF4_COLON_PATHS,
  ...TRAVERSAL_REJECT_RF4_PREFIX_PATHS,
  ...TRAVERSAL_REJECT_RF5_EMPTY_SEGMENT_PATHS,
  ...TRAVERSAL_REJECT_RF5_FLIPPED_PATHS,
  ...TRAVERSAL_REJECT_ROOT_SCAN_PATHS,
  ...TRAVERSAL_REJECT_S5_LEADING_WS_PATHS,
];

function deletedFor(nsh: string, raw: string, env: SidecarNsisVarEnv): readonly string[] {
  return simulateSidecarDeleteReadLoop(nsh, [raw], env).deleted;
}

/**
 * RF-4 / RF-5 / RF-6 + canonical gate tables: the allowlist root guards alone, the gate alone, and
 * the full pipeline end to end (nothing deleted for any reject row; exactly the path for a must-delete).
 */
export function assertSidecarRf456Tables(
  nsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const path of ALLOWLIST_ROOT_GUARD_SKIP_PATHS) {
    const outcome = runSidecarAllowlistDeleteVmFromNsh(path, nsh, env);
    if (outcome !== 'skip_delete') {
      throw new Error(`allowlist root guard must skip ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  for (const path of CANON_MUST_DELETE_PATHS) {
    const outcome = runSidecarAllowlistDeleteVmFromNsh(path, nsh, env);
    if (outcome !== 'delete') {
      throw new Error(`allowlist must pass ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  for (const { raw } of ALLOWLIST_GFPN_SLASH_DELETE_PATHS) {
    const outcome = runSidecarAllowlistDeleteVmFromNsh(raw, nsh, env);
    if (outcome !== 'delete') {
      throw new Error(`allowlist must pass GFPN-folded ${JSON.stringify(raw)}, got ${outcome}`);
    }
  }
  const gate = canonGateBlockFromGuardRegion(extractSidecarGuardRegionForVm(nsh));
  for (const { path, root } of CANON_GATE_ROOT_SKIP_ROWS) {
    const outcome = executeCanonGateBlock(gate, path, root);
    if (outcome !== 'skip_delete') {
      throw new Error(`canonical gate must skip ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  for (const { path, root } of [...CANON_GATE_MUST_DELETE_ROWS, ...CANON_GATE_NONCANONICAL_ROOT_DELETE_ROWS]) {
    const outcome = executeCanonGateBlock(gate, path, root);
    if (outcome !== 'delete') {
      throw new Error(`canonical gate must delete ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  for (const { path, root, ...options } of [...CANON_GATE_SIBLING_SKIP_ROWS, ...CANON_GATE_FAULT_SKIP_ROWS]) {
    const outcome = executeCanonGateBlock(gate, path, root, options);
    if (outcome !== 'skip_delete') {
      throw new Error(`canonical gate must skip ${JSON.stringify({ path, root, ...options })}, got ${outcome}`);
    }
  }
  const mustSkip = [
    ...RF456_SCAN_REJECT_PATHS.map((path) => `${path}\r\n`),
    ...ALLOWLIST_ROOT_GUARD_SKIP_PATHS.map((path) => `${path}\r\n`),
    ...SIDECAR_RF6_MUST_SKIP_LINES,
  ];
  for (const raw of mustSkip) {
    const deleted = deletedFor(nsh, raw, env);
    if (deleted.length !== 0) {
      throw new Error(`must not delete for ${JSON.stringify(raw)}, deleted ${JSON.stringify(deleted)}`);
    }
  }
  for (const path of CANON_MUST_DELETE_PATHS) {
    const deleted = deletedFor(nsh, `${path}\r\n`, env);
    if (deleted.length !== 1 || deleted[0] !== path) {
      throw new Error(`must delete exactly ${JSON.stringify(path)}, deleted ${JSON.stringify(deleted)}`);
    }
  }
  for (const { raw, deleted: want } of ALLOWLIST_GFPN_SLASH_DELETE_PATHS) {
    const deleted = deletedFor(nsh, `${raw}\r\n`, env);
    if (deleted.length !== 1 || deleted[0] !== want) {
      throw new Error(`must delete GFPN-folded ${JSON.stringify(want)}, deleted ${JSON.stringify(deleted)}`);
    }
  }
  const lfcr = deletedFor(nsh, SIDECAR_RF6_MUST_DELETE_LINE.raw, env);
  if (lfcr.length !== 1 || lfcr[0] !== SIDECAR_RF6_MUST_DELETE_LINE.deleted) {
    throw new Error(`LF-CR clean line must delete ${SIDECAR_RF6_MUST_DELETE_LINE.deleted}, got ${JSON.stringify(lfcr)}`);
  }
}

/** Mode-2 parity on the same rows, layer by layer: a mutant must match canonical everywhere. */
export function assertSidecarRf456SweepParity(
  mutantNsh: string,
  canonicalNsh: string,
  env: SidecarNsisVarEnv = DEFAULT_SIDECAR_NSIS_VAR_ENV,
): void {
  for (const path of [
    ...ALLOWLIST_ROOT_GUARD_SKIP_PATHS,
    ...CANON_MUST_DELETE_PATHS,
    ...ALLOWLIST_GFPN_SLASH_DELETE_PATHS.map((r) => r.raw),
  ]) {
    const canonical = cachedSweepVmOutcome(canonicalNsh, `rf456-allow:${path}:${JSON.stringify(env)}`, () =>
      runSidecarAllowlistDeleteVmFromNsh(path, canonicalNsh, env),
    );
    const mutant = runSidecarAllowlistDeleteVmFromNsh(path, mutantNsh, env);
    if (mutant !== canonical) {
      throw new Error(`sweep parity allowlist root guard ${JSON.stringify(path)}: canonical ${canonical}, mutant ${mutant}`);
    }
  }
  const canonicalGate = canonGateBlockFromGuardRegion(extractSidecarGuardRegionForVm(canonicalNsh));
  const mutantGate = canonGateBlockFromGuardRegion(extractSidecarGuardRegionForVm(mutantNsh));
  const gateRows: readonly CanonGateFaultRow[] = [
    ...CANON_GATE_ROOT_SKIP_ROWS,
    ...CANON_GATE_MUST_DELETE_ROWS,
    ...CANON_GATE_SIBLING_SKIP_ROWS,
    ...CANON_GATE_NONCANONICAL_ROOT_DELETE_ROWS,
    ...CANON_GATE_FAULT_SKIP_ROWS,
  ];
  for (const { path, root, ...options } of gateRows) {
    const canonical = cachedSweepVmOutcome(
      canonicalNsh,
      `rf456-gate:${JSON.stringify({ path, root, ...options })}`,
      () => executeCanonGateBlock(canonicalGate, path, root, options),
    );
    const mutant = executeCanonGateBlock(mutantGate, path, root, options);
    if (mutant !== canonical) {
      throw new Error(
        `sweep parity canonical gate ${JSON.stringify({ path, root, ...options })}: canonical ${canonical}, mutant ${mutant}`,
      );
    }
  }
  const rows = [
    ...RF456_SCAN_REJECT_PATHS.map((path) => `${path}\r\n`),
    ...ALLOWLIST_ROOT_GUARD_SKIP_PATHS.map((path) => `${path}\r\n`),
    ...CANON_MUST_DELETE_PATHS.map((path) => `${path}\r\n`),
    ...ALLOWLIST_GFPN_SLASH_DELETE_PATHS.map((r) => `${r.raw}\r\n`),
    ...SIDECAR_RF6_MUST_SKIP_LINES,
    SIDECAR_RF6_MUST_DELETE_LINE.raw,
  ];
  for (const raw of rows) {
    const canonical = deletedFor(canonicalNsh, raw, env).join('\u0000');
    const mutant = deletedFor(mutantNsh, raw, env).join('\u0000');
    if (mutant !== canonical) {
      throw new Error(`sweep parity end to end ${JSON.stringify(raw)}: canonical ${JSON.stringify(canonical)}, mutant ${JSON.stringify(mutant)}`);
    }
  }
}

/** Critic S14 — label-swap mutants (pin sweep :74/:99/:93; VM witness for :93 fwd loop). */
export const TRAVERSAL_S14_FWD_LOOP_PATH = '//';

/** Witness: canonical completes; fwd label-swap on forward `.` check must not terminate on `//`. */
export const TRAVERSAL_S14_FWD_SWAP_FILE_LINE = 120;

export const TRAVERSAL_S14_LABEL_SWAP_MUTANTS: readonly {
  fileLine: number;
  path: string;
  jumpTarget: 'uninstall_vault_trav_ok' | 'mythos_trav_fwd';
}[] = [];

/** Documented pin-only / behaviour-equivalent S14 swaps (see guardRegionSweep equivalents :74/:99). */
export const TRAVERSAL_S14_TRAV_OK_SWAP_FILE_LINES: readonly number[] = [100, 126];

const SIDECAR_CRLF = '\r\n';

/** Long benign line then traversal — $7 must reset at StrCpy $7 0 (:53) between sidecar lines. */
export const SIDECAR_MULTILINE_TRAV_GUARD_ROWS: readonly {
  rawLines: readonly string[];
  expected: SidecarGuardPathOutcome;
}[] = [
  {
    rawLines: [
      `C:\\Users\\me\\Documents\\My Vault\\${'a'.repeat(120)}${SIDECAR_CRLF}`,
      `C:\\Users\\me\\Documents\\..\\..\\..\\Windows${SIDECAR_CRLF}`,
    ],
    expected: 'allowlist_continue',
  },
];

export const SIDECAR_MULTILINE_H7_DELETE_ROW: {
  rawLines: readonly string[];
  expectedDeleted: readonly string[];
  expectClosed: boolean;
} = {
  rawLines: [
    `C:\\Users\\me\\Documents\\My Vault\\carry-${'b'.repeat(80)}${SIDECAR_CRLF}`,
    `C:\\Users\\me\\Documents\\..\\..\\..\\Windows${SIDECAR_CRLF}`,
  ],
  expectedDeleted: [`C:\\Users\\me\\Documents\\My Vault\\carry-${'b'.repeat(80)}`],
  expectClosed: true,
};

/** Forge fix item 6 — NSIS keeps reading past a blocked line 2, so a valid line 3 still deletes. */
export const SIDECAR_MULTILINE_H7_LINE3_DELETE_ROW: {
  rawLines: readonly string[];
  expectedDeleted: readonly string[];
  expectClosed: boolean;
} = {
  rawLines: [
    `C:\\Users\\me\\Documents\\My Vault\\carry-${'b'.repeat(80)}${SIDECAR_CRLF}`,
    `C:\\Users\\me\\Documents\\..\\..\\..\\Windows${SIDECAR_CRLF}`,
    `C:\\Users\\me\\Documents\\My Vault\\after-block${SIDECAR_CRLF}`,
  ],
  expectedDeleted: [
    `C:\\Users\\me\\Documents\\My Vault\\carry-${'b'.repeat(80)}`,
    'C:\\Users\\me\\Documents\\My Vault\\after-block',
  ],
  expectClosed: true,
};

/**
 * A long CRLF line then an LF-only traversal line. On the LF line the `\r` trim is not taken, so a
 * `StrCmp $2 "$\r" 0 +2` offset widened to `+4`/`+6` (file :50) skips the :53 $7 reset; line 1 has
 * left $7 past line 2's end, so line 2's `..` is never scanned and it would be deleted. Canonical
 * rejects line 2 and deletes only line 1.
 */
export const SIDECAR_MULTILINE_LF_RESET_ROW: {
  rawLines: readonly string[];
  expectedDeleted: readonly string[];
  expectClosed: boolean;
} = {
  rawLines: [
    `C:\\Users\\me\\Documents\\${'a'.repeat(40)}${SIDECAR_CRLF}`,
    'C:\\Users\\me\\Documents\\..\\..\\..\\Windows\n',
  ],
  expectedDeleted: [`C:\\Users\\me\\Documents\\${'a'.repeat(40)}`],
  expectClosed: true,
};

/**
 * Line 2 is rejected only by the scan: GetFullPathNameW keeps a stream name (`v:x`) and collapses a
 * doubled separator, so both resolve inside Documents and pass the canonical gate. Only the :65 `$7`
 * reset makes the scan see line 2 after a longer line 1.
 */
export const SIDECAR_MULTILINE_H7_SCAN_ONLY_DELETE_ROWS: readonly {
  rawLines: readonly string[];
  expectedDeleted: readonly string[];
  expectClosed: boolean;
}[] = [
  {
    rawLines: [
      `C:\\Users\\me\\Documents\\My Vault\\carry-${'b'.repeat(80)}${SIDECAR_CRLF}`,
      `C:\\Users\\me\\Documents\\v:x${SIDECAR_CRLF}`,
    ],
    expectedDeleted: [`C:\\Users\\me\\Documents\\My Vault\\carry-${'b'.repeat(80)}`],
    expectClosed: true,
  },
  {
    rawLines: [
      `C:\\Users\\me\\Documents\\My Vault\\carry-${'b'.repeat(80)}${SIDECAR_CRLF}`,
      `C:\\Users\\me\\Documents\\v\\\\x${SIDECAR_CRLF}`,
    ],
    expectedDeleted: [`C:\\Users\\me\\Documents\\My Vault\\carry-${'b'.repeat(80)}`],
    expectClosed: true,
  },
];

const SIDECAR_MULTILINE_H7_DELETE_ROWS = [
  SIDECAR_MULTILINE_H7_DELETE_ROW,
  SIDECAR_MULTILINE_H7_LINE3_DELETE_ROW,
  SIDECAR_MULTILINE_LF_RESET_ROW,
  ...SIDECAR_MULTILINE_H7_SCAN_ONLY_DELETE_ROWS,
] as const;

/** Critic H6 — file lines for StrCpy $4 $3 $8 deny gates. */
export const DENY_PREFIX_STRCPY_ACCEPTANCE_FILE_LINES: readonly [164, 179, 194] = [164, 179, 194];

export type DenyPrefixStrcpyAcceptanceVariant =
  | 'nop'
  | 'delete'
  | 'goto_trav_inc'
  | 'reg_4_to_3'
  | 'reg_4_to_5'
  | 'reg_1_to_0'
  | 'reg_1_to_2'
  | 'reg_3_to_2'
  | 'reg_3_to_4'
  | 'len_1'
  | 'len_2'
  | 'len_0'
  | 'len_reg_5'
  | 'strcpy_4_from_5';

export const DENY_PREFIX_STRCPY_ACCEPTANCE_VARIANTS: readonly DenyPrefixStrcpyAcceptanceVariant[] = [
  'nop',
  'delete',
  'goto_trav_inc',
  'reg_4_to_3',
  'reg_4_to_5',
  'reg_1_to_0',
  'reg_1_to_2',
  'reg_3_to_2',
  'reg_3_to_4',
  'len_1',
  'len_2',
  'len_0',
  'len_reg_5',
  'strcpy_4_from_5',
];

function denyStrcpyReplacementLine(
  baseLine: string,
  variant: DenyPrefixStrcpyAcceptanceVariant,
): string | null {
  const indent = baseLine.match(/^\s*/)?.[0] ?? '        ';
  switch (variant) {
    case 'nop':
      return `${indent}Nop`;
    case 'delete':
      return null;
    case 'goto_trav_inc':
      return `${indent}Goto mythos_trav_inc`;
    case 'reg_4_to_3':
      return `${indent}StrCpy $3 $1 $3`;
    case 'reg_4_to_5':
      return `${indent}StrCpy $5 $1 $3`;
    case 'reg_1_to_0':
      return `${indent}StrCpy $4 $0 $3`;
    case 'reg_1_to_2':
      return `${indent}StrCpy $4 $2 $3`;
    case 'reg_3_to_2':
      return `${indent}StrCpy $4 $1 $2`;
    case 'reg_3_to_4':
      return `${indent}StrCpy $4 $1 $4`;
    case 'len_1':
      return `${indent}StrCpy $4 $1 1`;
    case 'len_2':
      return `${indent}StrCpy $4 $1 2`;
    case 'len_0':
      return `${indent}StrCpy $4 $1 0`;
    case 'len_reg_5':
      return `${indent}StrCpy $4 $1 $5`;
    case 'strcpy_4_from_5':
      return `${indent}StrCpy $4 $5`;
    default: {
      const _exhaustive: never = variant;
      throw new Error(`unknown deny strcpy variant: ${_exhaustive}`);
    }
  }
}

/** Critic H6 acceptance mutant on :114 / :117 / :120 StrCpy $4 $1 $3 (re-baseline deny VM must go red). */
export function mutantDenyPrefixStrcpyAcceptance(
  nsh: string,
  fileLine: (typeof DENY_PREFIX_STRCPY_ACCEPTANCE_FILE_LINES)[number],
  variant: DenyPrefixStrcpyAcceptanceVariant,
): string {
  const regionIndex = fileLine - SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
  const { lines } = locateSidecarGuardRegion(nsh);
  const baseLine = lines[regionIndex];
  if (baseLine === undefined || !/StrCpy \$4 \$3/.test(baseLine)) {
    throw new Error(`file :${fileLine} is not a deny StrCpy $4 $3 line`);
  }
  const replacement = denyStrcpyReplacementLine(baseLine, variant);
  if (replacement === null) {
    const next = lines.filter((_, i) => i !== regionIndex);
    return spliceSidecarGuardRegion(nsh, next);
  }
  return replaceSidecarGuardRegionLine(nsh, regionIndex, replacement);
}

export function mutantHardLabelSwapJumpTarget(
  nsh: string,
  fileLine: number,
  jumpTarget: 'uninstall_vault_trav_ok' | 'mythos_trav_fwd' | 'mythos_trav_sepcheck',
): string {
  const { lines } = locateSidecarGuardRegion(nsh);
  const regionIndex = fileLine - SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
  const line = lines[regionIndex];
  if (line === undefined) {
    throw new Error(`file :${fileLine} missing from guard region`);
  }
  const trimmed = line.trim();
  const indent = line.match(/^\s*/)?.[0] ?? '';
  if (/StrCmp \$4 "\." 0 mythos_trav_inc/.test(trimmed)) {
    return replaceSidecarGuardRegionLine(
      nsh,
      regionIndex,
      `${indent}StrCmp $4 "." 0 ${jumpTarget}`,
    );
  }
  if (/StrCmp \$4 "" uninstall_vault_read/.test(trimmed)) {
    return replaceSidecarGuardRegionLine(
      nsh,
      regionIndex,
      `${indent}StrCmp $4 "" ${jumpTarget}`,
    );
  }
  if (/StrCmp \$4 " " uninstall_vault_read/.test(trimmed)) {
    return replaceSidecarGuardRegionLine(
      nsh,
      regionIndex,
      `${indent}StrCmp $4 " " ${jumpTarget}`,
    );
  }
  if (/^StrCmp \$4 "\/" uninstall_vault_read$/.test(trimmed)) {
    return replaceSidecarGuardRegionLine(
      nsh,
      regionIndex,
      `${indent}StrCmp $4 "/" ${jumpTarget}`,
    );
  }
  throw new Error(`file :${fileLine} is not a hard label-swap line: ${trimmed}`);
}

export function mutantS14LabelSwapJumpTarget(
  nsh: string,
  fileLine: number,
  jumpTarget: 'uninstall_vault_trav_ok' | 'mythos_trav_fwd',
): string {
  const { lines } = locateSidecarGuardRegion(nsh);
  const regionIndex = fileLine - SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
  const line = lines[regionIndex];
  if (line === undefined || !/StrCmp \$4 "\." 0 mythos_trav_inc/.test(line.trim())) {
    throw new Error(`file :${fileLine} is not StrCmp $4 "." 0 mythos_trav_inc`);
  }
  const indent = line.match(/^\s*/)?.[0] ?? '';
  return replaceSidecarGuardRegionLine(
    nsh,
    regionIndex,
    `${indent}StrCmp $4 "." 0 ${jumpTarget}`,
  );
}

function isTraversalVmStepLimitError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(TRAVERSAL_VM_STEP_LIMIT_ERROR);
}

export function assertTraversalVmStepLimitIsFatal(): void {
  const loopBlock = ['        mythos_trav_scan:', '          Goto mythos_trav_scan'];
  try {
    executeTraversalScanBlockStateful(loopBlock, 'x', { $7: 0, $8: 0 }, { maxSteps: 32 });
    throw new Error('step cap did not fire for the synthetic self-referential loop block (fail-open)');
  } catch (err) {
    if (!isTraversalVmStepLimitError(err)) {
      throw err;
    }
  }
}

export function assertTraversalHardLabelSwapRejectTables(nsh: string): void {
  for (const path of TRAVERSAL_HARD_H4_H5_REJECT_PATHS) {
    const canonical = runTraversalVmFromNsh(path, nsh);
    if (canonical !== 'vault_read') {
      throw new Error(
        `H-4/H-5 path must be vault_read on canonical nsh: ${JSON.stringify(path)}, got ${canonical}`,
      );
    }
  }
  const h6Canonical = runTraversalVmFromNsh(TRAVERSAL_HARD_H6_PATH, nsh);
  if (h6Canonical !== 'vault_read') {
    throw new Error(
      `H-6 path must be vault_read on canonical nsh: ${JSON.stringify(TRAVERSAL_HARD_H6_PATH)}, got ${h6Canonical}`,
    );
  }

  const h4Mutant = mutantHardLabelSwapJumpTarget(
    nsh,
    TRAVERSAL_HARD_H4_TRAV_OK_SWAP_FILE_LINE,
    'uninstall_vault_trav_ok',
  );
  const h5Mutant = mutantHardLabelSwapJumpTarget(
    nsh,
    TRAVERSAL_HARD_H5_TRAV_OK_SWAP_FILE_LINE,
    'uninstall_vault_trav_ok',
  );
  const h4Guard = runSidecarGuardOutcomeOnPath(TRAVERSAL_HARD_H4_H5_REJECT_PATHS[0]!, h4Mutant);
  if (h4Guard !== 'allowlist_continue') {
    throw new Error(`H-4 trav_ok swap must bypass guard on backslash path, got ${h4Guard}`);
  }
  const h5Guard = runSidecarGuardOutcomeOnPath(TRAVERSAL_HARD_H4_H5_REJECT_PATHS[1]!, h5Mutant);
  if (h5Guard !== 'allowlist_continue') {
    throw new Error(`H-5 trav_ok swap must bypass guard on forward path, got ${h5Guard}`);
  }

  assertTraversalVmStepLimitIsFatal();
  const h6LoopMutant = mutantHardLabelSwapJumpTarget(
    nsh,
    TRAVERSAL_HARD_H6_FWD_SWAP_FILE_LINE,
    'mythos_trav_sepcheck',
  );
  const travBlock = travBlockFromGuardRegion(extractSidecarGuardRegionForVm(h6LoopMutant));
  try {
    executeTraversalScanBlockStateful(
      travBlock,
      TRAVERSAL_HARD_H6_FWD_LOOP_PATH,
      { $7: 0, $8: 0 },
      { maxSteps: 8000 },
    );
    throw new Error(
      `H-6 fwd swap did not loop (step cap failed open) on ${JSON.stringify(TRAVERSAL_HARD_H6_FWD_LOOP_PATH)}`,
    );
  } catch (err) {
    if (!isTraversalVmStepLimitError(err)) {
      throw err;
    }
  }

  const h7Mutant = replaceSidecarGuardFileLine(nsh, TRAVERSAL_HARD_H7_STRCPY7_RESET_FILE_LINE, '        Nop');
  try {
    assertSidecarDeleteReadLoopTables(h7Mutant);
    throw new Error('H-7 :65 StrCpy $7 0 removal must fail delete read-loop tables');
  } catch (err) {
    if (err instanceof Error && err.message.includes('H-7 :65')) {
      throw err;
    }
    if (err instanceof Error && err.message.includes('H-7 read-loop delete set')) {
      return;
    }
    throw err;
  }
}

export function assertTraversalS14LabelSwapRejectTables(nsh: string): void {
  for (const { fileLine, path, jumpTarget } of TRAVERSAL_S14_LABEL_SWAP_MUTANTS) {
    const canonical = runTraversalVmFromNsh(path, nsh);
    const mutant = mutantHardLabelSwapJumpTarget(nsh, fileLine, jumpTarget);
    try {
      const outcome = runTraversalVmFromNsh(path, mutant);
      if (outcome === canonical) {
        throw new Error(
          `S14 label-swap :${fileLine} must change traversal outcome on ${JSON.stringify(path)} (canonical ${canonical}, mutant ${outcome})`,
        );
      }
    } catch (err) {
      if (isTraversalVmStepLimitError(err)) {
        continue;
      }
      throw err;
    }
  }
  for (const fileLine of TRAVERSAL_S14_TRAV_OK_SWAP_FILE_LINES) {
    const mutant = mutantS14LabelSwapJumpTarget(nsh, fileLine, 'uninstall_vault_trav_ok');
    if (mutant === nsh) {
      throw new Error(`S14 :${fileLine} trav_ok swap mutant did not change nsh`);
    }
  }
}

export function assertTraversalS16CanonicalOnlyRejectPins(nsh: string): void {
  for (const path of TRAVERSAL_REJECT_S16_CANONICAL_ONLY_PATHS) {
    const outcome = runTraversalVmFromNsh(path, nsh);
    if (outcome !== 'vault_read') {
      throw new Error(
        `expected vault_read for S16 canonical-only traversal path ${JSON.stringify(path)}, got ${outcome}`,
      );
    }
  }
}

export function assertTraversalRejectAllowTables(nsh: string): void {
  for (const path of TRAVERSAL_REJECT_PATHS) {
    const outcome = runTraversalVmFromNsh(path, nsh);
    if (outcome !== 'vault_read') {
      throw new Error(`expected vault_read for traversal path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
  assertTraversalS16CanonicalOnlyRejectPins(nsh);
  for (const path of TRAVERSAL_ALLOW_PATHS) {
    const outcome = runTraversalVmFromNsh(path, nsh);
    if (outcome !== 'trav_ok') {
      throw new Error(`expected trav_ok for traversal path ${JSON.stringify(path)}, got ${outcome}`);
    }
  }
}

export const TRAV_BACKSLASH_ENTRY = String.raw`StrCmp $4 "\" 0 mythos_trav_fwd`;
export const TRAV_FWD_LABEL = 'mythos_trav_fwd:';

export const NSH_BACKSLASH_DOT_CHECK = String.raw`StrCmp $4 "." 0 mythos_trav_inc`;
export const NSH_BACKSLASH_DOT_BACKSLASH_REJECT = String.raw`StrCmp $4 "\" uninstall_vault_read`;
export const NSH_BACKSLASH_DOT_DOT_EMPTY_REJECT = String.raw`StrCmp $4 "" uninstall_vault_read`;
export const NSH_FWD_SLASH_DOT_CHECK = String.raw`StrCmp $4 "/" 0 mythos_trav_inc`;
export const NSH_FWD_DOT_SLASH_REJECT = String.raw`StrCmp $4 "/" uninstall_vault_read`;
export const NSH_FWD_DOT_BACKSLASH_REJECT = String.raw`StrCmp $4 "\" uninstall_vault_read`;

export function extractBackslashTraversalBranch(executable: string): string {
  const start = executable.indexOf(TRAV_BACKSLASH_ENTRY);
  const end = executable.indexOf(TRAV_FWD_LABEL, start);
  if (start < 0 || end <= start) {
    throw new Error('backslash traversal branch missing in uninstall nsh');
  }
  return executable.slice(start, end);
}

export function extractForwardTraversalBranch(executable: string): string {
  const start = executable.indexOf(TRAV_FWD_LABEL);
  const end = executable.indexOf('mythos_trav_inc:', start);
  if (start < 0 || end <= start) {
    throw new Error('forward-slash traversal branch missing in uninstall nsh');
  }
  return executable.slice(start, end);
}

export function nshFileLines(nsh: string): string[] {
  return nsh.split(/\r?\n/);
}

export function replaceNshLine(nsh: string, lineOneBased: number, newLine: string): string {
  const lines = nshFileLines(nsh);
  if (lineOneBased < 1 || lineOneBased > lines.length) {
    throw new Error(`line ${lineOneBased} out of range (${lines.length} lines)`);
  }
  const out = [...lines];
  out[lineOneBased - 1] = newLine;
  return out.join('\n');
}

/** Shield gotoinc: replace one exact line inside the marker block with Goto mythos_trav_inc */
export function mutantGotoTravIncAtBlockLine(nsh: string, exactLine: string, occurrence = 0): string {
  const { lines } = locateTraversalScanBlock(nsh);
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === exactLine) {
      seen += 1;
      if (seen === occurrence) {
        const indent = lines[i]!.match(/^\s*/)?.[0] ?? '';
        return replaceTraversalScanBlockLine(nsh, i, `${indent}Goto mythos_trav_inc`);
      }
    }
  }
  throw new Error(`block line not found for gotoinc: ${exactLine}`);
}

/** Probe nopl: StrCmp target uninstall_vault_read -> mythos_trav_inc on one block line */
export function mutantNeutralizeVaultReadAtBlockLine(
  nsh: string,
  exactLine: string,
  occurrence = 0,
): string {
  const { lines } = locateTraversalScanBlock(nsh);
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === exactLine) {
      seen += 1;
      if (seen === occurrence) {
        return replaceTraversalScanBlockLine(
          nsh,
          i,
          lines[i]!.replace('uninstall_vault_read', 'mythos_trav_inc'),
        );
      }
    }
  }
  throw new Error(`block line not found for neutralize: ${exactLine}`);
}

export function assertTraversalBranchBehaviourPins(nsh: string): void {
  const executable = nshExecutableLines(nsh);
  const travStart = executable.indexOf('mythos_trav_scan');
  const travOk = executable.indexOf('uninstall_vault_trav_ok:');
  if (travStart < 0 || travOk <= travStart) {
    throw new Error('mythos_trav_scan region missing');
  }
  assertSidecarGuardRegionExact(nsh);
  if (executable.indexOf(TRAV_BACKSLASH_ENTRY) < 0) {
    throw new Error('backslash traversal entry missing');
  }
  if (executable.indexOf(TRAV_FWD_LABEL) < 0) {
    throw new Error('forward traversal label mythos_trav_fwd: missing');
  }
}

export const WINDIR_DENY_STRCMP = '        StrCmp $4 $5 uninstall_vault_read 0';
export const PROGRAMFILES_DENY_STRCMP = '        StrCmp $4 $5 uninstall_vault_read 0';
export const PROGRAMFILES64_DENY_STRCMP = '        StrCmp $4 $5 uninstall_vault_read 0';

export function assertWindirProgramFilesDenyBehaviourPins(nsh: string): void {
  assertSidecarGuardRegionExact(nsh);
}

export function nshReplaceFileLine(nsh: string, fileLineOneBased: number, text: string): string {
  const next = nsh.split('\n');
  const indent = next[fileLineOneBased - 1]!.match(/^\s*/)?.[0] ?? '';
  next[fileLineOneBased - 1] = `${indent}${text}`;
  return next.join('\n');
}

/** Primary sweep mutant for one S-19 fallback helper line (:542–:582). */
export function mutantSidecarFallbackSweepLine(nsh: string, fileLineOneBased: number): string {
  if (
    fileLineOneBased < SIDECAR_FALLBACK_REGION_FILE_LINE_FIRST ||
    fileLineOneBased > SIDECAR_FALLBACK_REGION_FILE_LINE_LAST
  ) {
    throw new Error(`file line ${fileLineOneBased} outside fallback region`);
  }
  const line = nsh.split('\n')[fileLineOneBased - 1];
  if (line === undefined) {
    throw new Error(`fallback file line ${fileLineOneBased} missing`);
  }
  const trimmed = line.trim();
  if (/^\w+:\s*$/.test(trimmed)) {
    return nshReplaceFileLine(nsh, fileLineOneBased, trimmed.replace(':', 'X:'));
  }
  return nshReplaceFileLine(nsh, fileLineOneBased, 'Nop');
}

/** `IntCmp $4 ${NSIS_MAX_STRLEN} dest 0 dest` → equal-branch fall-through (`tgt1->0`). */
export function mutantSidecarIntCmpMaxTgt1To0(nsh: string, fileLineOneBased: number): string {
  const line = nsh.split('\n')[fileLineOneBased - 1];
  if (line === undefined) {
    throw new Error(`file line ${fileLineOneBased} missing`);
  }
  const trimmed = line.trim();
  const m = trimmed.match(/^IntCmp \$4 \$\{NSIS_MAX_STRLEN\} (\S+) 0 \1$/);
  if (m === null) {
    throw new Error(`:${fileLineOneBased} is not a MAX IntCmp with equal/greater → same dest: ${trimmed}`);
  }
  return nshReplaceFileLine(nsh, fileLineOneBased, `IntCmp $4 \${NSIS_MAX_STRLEN} 0 0 ${m[1]}`);
}

/** `IntCmp $4 0 h3 h3 0` → equal-branch fall-through (`tgt1->0`). */
export function mutantSidecarFallbackIntCmpTgt1To0(nsh: string, fileLineOneBased: number): string {
  const line = nsh.split('\n')[fileLineOneBased - 1];
  if (line === undefined) {
    throw new Error(`file line ${fileLineOneBased} missing`);
  }
  const trimmed = line.trim();
  const m = trimmed.match(/^IntCmp \$4 0 (\S+) \1 0$/);
  if (m === null) {
    throw new Error(`:${fileLineOneBased} is not fallback IntCmp $4 0 h3 h3 0: ${trimmed}`);
  }
  return nshReplaceFileLine(nsh, fileLineOneBased, `IntCmp $4 0 0 ${m[1]} 0`);
}

/** :567 `Goto mythos_al_deny` → `Goto uninstall_vault_read` (al_deny is that Goto). */
export function mutantSidecar567GotoRead(nsh: string): string {
  const line = nsh.split('\n')[566];
  if (line === undefined || !line.includes('Goto mythos_al_deny')) {
    throw new Error(`:567 is not Goto mythos_al_deny: ${line?.trim() ?? 'missing'}`);
  }
  return nshReplaceFileLine(nsh, 567, 'Goto uninstall_vault_read');
}

/** `IntCmp $4 ${NSIS_MAX_STRLEN} dest 0 dest` → greater-branch fall-through (`tgt3->0`). */
export function mutantSidecarIntCmpMaxTgt3To0(nsh: string, fileLineOneBased: number): string {
  const line = nsh.split('\n')[fileLineOneBased - 1];
  if (line === undefined) {
    throw new Error(`file line ${fileLineOneBased} missing`);
  }
  const trimmed = line.trim();
  const m = trimmed.match(/^IntCmp \$4 \$\{NSIS_MAX_STRLEN\} (\S+) 0 \1$/);
  if (m === null) {
    throw new Error(`:${fileLineOneBased} is not a MAX IntCmp with equal/greater → same dest: ${trimmed}`);
  }
  return nshReplaceFileLine(nsh, fileLineOneBased, `IntCmp $4 \${NSIS_MAX_STRLEN} ${m[1]} 0 0`);
}

export type SidecarTgt3MaxlenSpec = Readonly<{
  intCmpLine: number;
  callLine: number;
  name: string;
  path: string;
  env: SidecarNsisVarEnv;
  options: Omit<SidecarNsisRunOptions, 'env'>;
  callApi: 'GetFullPathNameW' | 'GetLongPathNameW';
}>;

export const SIDECAR_NSIS_LONG_DOCUMENTS_ROOT = `C:\\Users\\me\\${'D'.repeat(1024)}`;
/** 8.3 alias of the long-path constant leaf (`LONGDO~1` → 1024 `D`s). */
export const SIDECAR_NSIS_LONG_8_3 = 'C:\\Users\\me\\LONGDO~1';
/** Long path under Documents so a truncated dest still allow-matches. */
export const SIDECAR_NSIS_LONG_UNDER_DOCUMENTS = `C:\\Users\\me\\Documents\\${'D'.repeat(1024)}`;
const APPDATA_DESCENDANT_VAULT = 'C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\Docs\\v';
const DOCUMENTS_VAULT = 'C:\\Users\\me\\Documents\\MyVault';
const DESKTOP_VAULT = 'C:\\Users\\me\\Desktop\\v';
const DOWNLOADS_VAULT = 'C:\\Users\\me\\Downloads\\v';

function noOversizeHooks(options: Omit<SidecarNsisRunOptions, 'env'>): Omit<SidecarNsisRunOptions, 'env'> {
  if (
    options.gfpnOversizePaths !== undefined ||
    options.gfpnOversizeNth !== undefined ||
    options.gfpnOversizeFileLines !== undefined ||
    options.glpnOversizePaths !== undefined ||
    options.glpnOversizeNth !== undefined ||
    options.glpnOversizeFileLines !== undefined
  ) {
    throw new Error('oversize specs must use a real long path, not *Oversize* fakes');
  }
  return options;
}

/**
 * Ivy's 8 MAX IntCmp sites. Each row keeps the folder; `tgt3->0` deletes.
 * Resolved / env paths are longer than `NSIS_MAX_STRLEN` (the long-path constant
 * or its 8.3 alias). No `*Oversize*` fakes on short leftover registers.
 */
export const SIDECAR_TGT3_EIGHT_SPECS: readonly SidecarTgt3MaxlenSpec[] = [
  {
    intCmpLine: 320,
    callLine: 318,
    name: 'canon $1 GFPN',
    path: DOCUMENTS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetFullPathNameW',
    options: noOversizeHooks({ gfpnResolvedPathFileLines: { 318: SIDECAR_NSIS_LONG_DOCUMENTS_ROOT } }),
  },
  {
    intCmpLine: 331,
    callLine: 329,
    name: 'canon $5 GFPN',
    path: DOCUMENTS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetFullPathNameW',
    options: noOversizeHooks({ gfpnResolvedPathFileLines: { 329: SIDECAR_NSIS_LONG_DOCUMENTS_ROOT } }),
  },
  {
    intCmpLine: 362,
    callLine: 360,
    name: 'nested AppData GFPN',
    path: DOCUMENTS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetFullPathNameW',
    options: noOversizeHooks({ gfpnResolvedPathFileLines: { 360: SIDECAR_NSIS_LONG_DOCUMENTS_ROOT } }),
  },
  {
    intCmpLine: 388,
    callLine: 386,
    name: 'nested Documents GFPN',
    path: APPDATA_DESCENDANT_VAULT,
    env: { ...HARD12_ENV_E1, DOCUMENTS: SIDECAR_NSIS_LONG_DOCUMENTS_ROOT },
    callApi: 'GetFullPathNameW',
    options: noOversizeHooks({}),
  },
  {
    intCmpLine: 414,
    callLine: 412,
    name: 'nested Desktop GFPN',
    path: DOCUMENTS_VAULT,
    env: { ...HARD12_ENV_E1, DESKTOP: SIDECAR_NSIS_LONG_DOCUMENTS_ROOT },
    callApi: 'GetFullPathNameW',
    options: noOversizeHooks({}),
  },
  {
    intCmpLine: 418,
    callLine: 415,
    name: 'nested Desktop GLP',
    path: DOCUMENTS_VAULT,
    env: { ...HARD12_ENV_E1, DESKTOP: SIDECAR_NSIS_LONG_8_3 },
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({}),
  },
  {
    intCmpLine: 440,
    callLine: 438,
    name: 'nested Downloads GFPN',
    path: DOCUMENTS_VAULT,
    env: { ...HARD12_ENV_E1, PROFILE: SIDECAR_NSIS_LONG_DOCUMENTS_ROOT },
    callApi: 'GetFullPathNameW',
    options: noOversizeHooks({}),
  },
  {
    intCmpLine: 444,
    callLine: 441,
    name: 'nested Downloads GLP',
    path: DOCUMENTS_VAULT,
    env: { ...HARD12_ENV_E1, PROFILE: SIDECAR_NSIS_LONG_8_3 },
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({}),
  },
];

/**
 * 12 GLP MAX IntCmp sites. Each row uses a required-size &gt; NSIS_MAX_STRLEN
 * (real long path or 8.3→long-path-constant) so `tgt3->0` is live. Canonical
 * keeps the folder and never Deletes the truncated prefix.
 */
export const SIDECAR_TGT3_MAXLEN_SPECS: readonly SidecarTgt3MaxlenSpec[] = [
  {
    intCmpLine: 145,
    callLine: 143,
    name: 'line GLP',
    path: DOCUMENTS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({ glpnResolvedPathFileLines: { 143: SIDECAR_NSIS_LONG_UNDER_DOCUMENTS } }),
  },
  {
    intCmpLine: 157,
    callLine: 155,
    name: 'WINDIR GLP',
    path: DOCUMENTS_VAULT,
    env: { ...HARD12_ENV_E1, WINDIR: SIDECAR_NSIS_LONG_8_3 },
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({}),
  },
  {
    intCmpLine: 172,
    callLine: 170,
    name: 'PROGRAMFILES GLP',
    path: DOCUMENTS_VAULT,
    env: { ...HARD12_ENV_E1, PROGRAMFILES: SIDECAR_NSIS_LONG_8_3 },
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({}),
  },
  {
    intCmpLine: 187,
    callLine: 185,
    name: 'PROGRAMFILES64 GLP',
    path: DOCUMENTS_VAULT,
    env: { ...HARD12_ENV_E1, PROGRAMFILES64: SIDECAR_NSIS_LONG_8_3 },
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({}),
  },
  {
    intCmpLine: 203,
    callLine: 200,
    name: 'APPDATA allow GLP',
    path: DOCUMENTS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({ glpnResolvedPathFileLines: { 200: SIDECAR_NSIS_LONG_UNDER_DOCUMENTS } }),
  },
  {
    intCmpLine: 233,
    callLine: 230,
    name: 'Documents allow GLP',
    path: DESKTOP_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({ glpnResolvedPathFileLines: { 230: SIDECAR_NSIS_LONG_DOCUMENTS_ROOT } }),
  },
  {
    intCmpLine: 263,
    callLine: 260,
    name: 'Desktop allow GLP',
    path: DOWNLOADS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({ glpnResolvedPathFileLines: { 260: SIDECAR_NSIS_LONG_DOCUMENTS_ROOT } }),
  },
  {
    intCmpLine: 293,
    callLine: 290,
    name: 'Downloads allow GLP',
    path: DOWNLOADS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({ glpnResolvedPathFileLines: { 290: `C:\\Users\\me\\Downloads\\${'D'.repeat(1024)}` } }),
  },
  {
    intCmpLine: 323,
    callLine: 321,
    name: 'canon $3 GLP',
    path: DOCUMENTS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({ glpnResolvedPathFileLines: { 321: SIDECAR_NSIS_LONG_UNDER_DOCUMENTS } }),
  },
  {
    intCmpLine: 334,
    callLine: 332,
    name: 'canon $9 GLP',
    path: DOCUMENTS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({ glpnResolvedPathFileLines: { 332: SIDECAR_NSIS_LONG_UNDER_DOCUMENTS } }),
  },
  {
    intCmpLine: 366,
    callLine: 363,
    name: 'nested AppData GLP',
    path: DOCUMENTS_VAULT,
    env: HARD12_ENV_E1,
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({ glpnResolvedPathFileLines: { 363: SIDECAR_NSIS_LONG_DOCUMENTS_ROOT } }),
  },
  {
    intCmpLine: 392,
    callLine: 389,
    name: 'nested Documents GLP',
    path: APPDATA_DESCENDANT_VAULT,
    env: { ...HARD12_ENV_E1, DOCUMENTS: SIDECAR_NSIS_LONG_8_3 },
    callApi: 'GetLongPathNameW',
    options: noOversizeHooks({}),
  },
];

export function sidecarTgt3SpecToHardARow(spec: SidecarTgt3MaxlenSpec): SidecarHardARow {
  return {
    name: `${spec.name} oversize (required size > NSIS_MAX_STRLEN) keeps folder (kills :${spec.intCmpLine} Nop / tgt3->0)`,
    path: spec.path,
    env: spec.env,
    expect: 'skip',
    // Vault leftover is short; do not call nsisTruncatedPrefix here — its
    // default `SIDECAR_NSIS_MAX_STRLEN` is in TDZ when vm loads this module.
    mustNotDelete: [spec.path],
    options: spec.options,
    killsFileLine: spec.intCmpLine,
  };
}

export function sidecarTgt3HardARows(): readonly SidecarHardARow[] {
  return [...SIDECAR_TGT3_EIGHT_SPECS, ...SIDECAR_TGT3_MAXLEN_SPECS].map(sidecarTgt3SpecToHardARow);
}

export function sidecarHardAAllRows(): readonly SidecarHardARow[] {
  return [...SIDECAR_HARD_A_ROWS, ...SIDECAR_ERRNO3_HARD_A_ROWS, ...sidecarTgt3HardARows()];
}

/** Primary sweep mutant for one guard-region file line (:43–:376). */
export function mutantSidecarGuardRegionSweepLine(nsh: string, fileLineOneBased: number): string {
  const { lines } = locateSidecarGuardRegion(nsh);
  const regionIndex = fileLineOneBased - SIDECAR_GUARD_REGION_FILE_LINE_FIRST;
  const line = lines[regionIndex];
  if (line === undefined) {
    throw new Error(`guard region file line ${fileLineOneBased} missing`);
  }
  const trimmed = line.trim();
  if (trimmed === 'IfErrors uninstall_vault_close') {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}Goto uninstall_vault_close`);
  }
  if (trimmed === 'StrCmp $2 "$\\n" 0 +2') {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}StrCmp $2 "$\\r" 0 +2`);
  }
  if (trimmed === 'StrCmp $2 "$\\r" 0 +2') {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}StrCmp $2 "$\\n" 0 +2`);
  }
  if (trimmed === 'FileRead $0 $1') {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}Nop`);
  }
  if (trimmed === 'StrCpy $7 0') {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}Nop`);
  }
  if (/^\w+:\s*$/.test(trimmed)) {
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}${trimmed.replace(':', 'X:')}`);
  }
  const intOpPlus1 = line.match(/^(\s*)IntOp (\$\d+) (\$\d+) \+ 1$/);
  if (intOpPlus1) {
    return replaceSidecarGuardRegionLine(
      nsh,
      regionIndex,
      `${intOpPlus1[1]}IntOp ${intOpPlus1[2]} ${intOpPlus1[3]} + 2`,
    );
  }
  const strCpyIdx = line.match(/^(\s*)StrCpy \$4 \$1 1 \$(\d+)$/);
  if (strCpyIdx) {
    const swapped = strCpyIdx[2] === '7' ? '8' : '7';
    return replaceSidecarGuardRegionLine(
      nsh,
      regionIndex,
      `${strCpyIdx[1]}StrCpy $4 $1 1 $${swapped}`,
    );
  }
  const strCpyLen = line.match(/^(\s*)StrCpy \$4 \$1 \$(\d+)$/);
  if (strCpyLen) {
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${strCpyLen[1]}StrCpy $4 $1 1`);
  }
  const gotoScan = line.match(/^(\s*)Goto mythos_trav_scan$/);
  if (gotoScan) {
    return replaceSidecarGuardRegionLine(nsh, regionIndex, `${gotoScan[1]}Goto mythos_trav_inc`);
  }
  const indent = line.match(/^\s*/)?.[0] ?? '';
  return replaceSidecarGuardRegionLine(nsh, regionIndex, `${indent}Nop`);
}

export function applyNshReplaceOnce(source: string, needle: string, replacement: string): string {
  const at = source.indexOf(needle);
  if (at < 0) {
    throw new Error(`mutant needle missing: ${needle.slice(0, 60)}`);
  }
  return source.slice(0, at) + replacement + source.slice(at + needle.length);
}

export function applyNshReplaceAll(source: string, needle: string, replacement: string): string {
  return source.split(needle).join(replacement);
}

const TRAV_INC_NOP = String.raw`StrCmp $4 "\" mythos_trav_inc`;

export function mutantMB1_neutralizeBackslashDotBackslashReject(nsh: string): string {
  return replaceInBackslashBranch(nsh, NSH_BACKSLASH_DOT_BACKSLASH_REJECT, TRAV_INC_NOP, 0);
}

export function mutantMB2_neutralizeBackslashDotDotBackslashReject(nsh: string): string {
  return replaceInBackslashBranch(nsh, NSH_BACKSLASH_DOT_BACKSLASH_REJECT, TRAV_INC_NOP, 1);
}

export function mutantMB3_deleteBackslashDotDotRejectPair(nsh: string): string {
  const block =
    '                StrCmp $4 "" uninstall_vault_read\n' +
    String.raw`                StrCmp $4 "\" uninstall_vault_read` +
    '\n                StrCmp $4 "/" uninstall_vault_read\n' +
    '                Goto mythos_trav_inc';
  if (!nsh.includes(block)) {
    throw new Error('M-B3 block missing from nsh');
  }
  return nsh.replace(block, '                Goto mythos_trav_inc');
}

export function mutantMB4_neutralizeAllBackslashTravRejects(nsh: string): string {
  let mutant = nsh;
  const back = extractBackslashTraversalBranch(nshExecutableLines(mutant));
  const backslashRejects = back.match(/StrCmp \$4 "\\" uninstall_vault_read/g) ?? [];
  for (let i = backslashRejects.length - 1; i >= 0; i--) {
    mutant = replaceInBackslashBranch(mutant, NSH_BACKSLASH_DOT_BACKSLASH_REJECT, TRAV_INC_NOP, i);
  }
  const emptyRejects = back.match(/StrCmp \$4 "" uninstall_vault_read/g) ?? [];
  for (let i = emptyRejects.length - 1; i >= 0; i--) {
    mutant = replaceInBackslashBranch(
      mutant,
      NSH_BACKSLASH_DOT_DOT_EMPTY_REJECT,
      String.raw`StrCmp $4 "" mythos_trav_inc`,
      i,
    );
  }
  return mutant;
}

export function mutantMB5_neutralizeBackslashDotCheck(nsh: string): string {
  return replaceInBackslashBranch(
    nsh,
    NSH_BACKSLASH_DOT_CHECK,
    String.raw`StrCmp $4 "." mythos_trav_inc`,
    0,
  );
}

export function mutantMB6_neutralizeForwardSlashTravRejects(nsh: string): string {
  let mutant = nsh;
  const fwd = extractForwardTraversalBranch(nshExecutableLines(mutant));
  const slashRejects = fwd.match(/StrCmp \$4 "\/" uninstall_vault_read/g) ?? [];
  for (let i = slashRejects.length - 1; i >= 0; i--) {
    mutant = replaceInForwardBranch(mutant, NSH_FWD_DOT_SLASH_REJECT, String.raw`StrCmp $4 "/" mythos_trav_inc`, i);
  }
  const backslashInFwd = fwd.match(/StrCmp \$4 "\\" uninstall_vault_read/g) ?? [];
  for (let i = backslashInFwd.length - 1; i >= 0; i--) {
    mutant = replaceInForwardBranch(
      mutant,
      NSH_FWD_DOT_BACKSLASH_REJECT,
      TRAV_INC_NOP,
      i,
    );
  }
  return mutant;
}

export function mutantWindirDenyDrop(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, WINDIR_DENY_STRCMP, '        Nop', 0);
}

export function mutantProgramFilesDenyDrop(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, PROGRAMFILES_DENY_STRCMP, '        Nop', 1);
}

export function mutantProgramFiles64DenyDrop(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, PROGRAMFILES64_DENY_STRCMP, '        Nop', 2);
}

/** Shield F11 — StrCpy $4 $3 $8 -> StrCpy $4 $3 1 (WINDIR deny broken). */
export function mutantF11_strcpy4Windir(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, '        StrCpy $4 $3 $8', '        StrCpy $4 $3 1', 0);
}

export function mutantF11_strcpy4ProgramFiles(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, '        StrCpy $4 $3 $8', '        StrCpy $4 $3 1', 1);
}

export function mutantF11_strcpy4ProgramFiles64(nsh: string): string {
  return replaceDenyPrefixBlockLineByExact(nsh, '        StrCpy $4 $3 $8', '        StrCpy $4 $3 1', 2);
}

export function mutantXF1_gotoIncLine79(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '              StrCmp $4 "/" uninstall_vault_read', 0);
}

export function mutantXF2_gotoIncLine80(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(
    nsh,
    String.raw`              StrCmp $4 "\" uninstall_vault_read`,
    0,
  );
}

export function mutantXF3_gotoIncLine85(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '                StrCmp $4 "/" uninstall_vault_read', 0);
}

export function mutantXF4_gotoIncLine86(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(
    nsh,
    String.raw`                StrCmp $4 "\" uninstall_vault_read`,
    0,
  );
}

export function mutantXF5_gotoIncLine75(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '            StrCmp $4 "." 0 mythos_trav_inc', 0);
}

export function mutantXF6_gotoIncLine81(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '              StrCmp $4 "." 0 mythos_trav_inc', 1);
}

export function mutantXB7_gotoIncLine65(nsh: string): string {
  return mutantGotoTravIncAtBlockLine(nsh, '              StrCmp $4 "." 0 mythos_trav_inc', 0);
}

export function mutantMB5a_neutralizeLine78(nsh: string): string {
  return mutantNeutralizeVaultReadAtBlockLine(nsh, '              StrCmp $4 "" uninstall_vault_read', 1);
}

export function mutantMB6a_neutralizeLine84(nsh: string): string {
  return mutantNeutralizeVaultReadAtBlockLine(nsh, '                StrCmp $4 "" uninstall_vault_read', 0);
}

/** Shield N1: forward `/` check disabled (`|`). */
export function mutantN1_forwardSlashCheckPipe(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          StrCmp $4 "/" 0 mythos_trav_inc',
    '          StrCmp $4 "|" 0 mythos_trav_inc',
  );
}

/** Shield N2: first IntOp $8 $7 + 1 -> +2 (backslash branch). */
export function mutantN2_intOpLine58Plus2(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '            IntOp $8 $7 + 1',
    '            IntOp $8 $7 + 2',
    0,
  );
}

/** Shield N3: second IntOp $8 $7 + 1 -> +2 (forward branch). */
export function mutantN3_intOpLine73Plus2(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '            IntOp $8 $7 + 1',
    '            IntOp $8 $7 + 2',
    1,
  );
}

/** Probe U1 — same as N2 (file :58 IntOp +1 -> +2). */
export function mutantU1_intOp58Plus2(nsh: string): string {
  return mutantN2_intOpLine58Plus2(nsh);
}

/** Probe U3 — empty-char scan exit disabled (:56). */
export function mutantU3_disableEmptyEndCheck(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          StrCmp $4 "" uninstall_vault_trav_ok',
    '          Nop',
  );
}

/** Probe U4 — char load uses wrong index (:55 early end). */
export function mutantU4_strcpy4Uses8(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          StrCpy $4 $1 1 $7',
    '          StrCpy $4 $1 1 $8',
  );
}

/** Probe U5 — forward `/` branch never taken (:72). */
export function mutantU5_forwardSlashPipe(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          StrCmp $4 "/" 0 mythos_trav_inc',
    '          StrCmp $4 "|" 0 mythos_trav_inc',
  );
}

/** Probe U6 — scan start index past path end (:53). */
export function mutantU6_strcpy7PastEnd(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, TRAVERSAL_SCAN_BLOCK_PREP_LINE, '        StrCpy $7 99999');
}

/** Probe U7 — loop increment +1 -> +3 (:88). */
export function mutantU7_intOp7Plus3(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '          IntOp $7 $7 + 1',
    '          IntOp $7 $7 + 3',
  );
}

/** Critic E-58: first IntOp $8 $7 + 1 neutralised. */
export function mutantE58_intOpFirstPlus1(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, '            IntOp $8 $7 + 1', '            Nop', 0);
}

/** Critic E-59: first StrCpy $4 $1 1 $8 uses $7 (bad index). */
export function mutantE59_strcpyUse7(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '            StrCpy $4 $1 1 $8',
    '            StrCpy $4 $1 1 $7',
    0,
  );
}

export function mutantE61_intOp8Plus1(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, '              IntOp $8 $8 + 1', '              IntOp $8 $8 + 2', 0);
}

export function mutantE62_strcpySecondUse7(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '              StrCpy $4 $1 1 $8',
    '              StrCpy $4 $1 1 $7',
    0,
  );
}

export function mutantE67_intOp8Plus1Second(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, '                IntOp $8 $8 + 1', '                IntOp $8 $8 + 2', 0);
}

export function mutantE74_strcpyFwdBranch(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '            StrCpy $4 $1 1 $8',
    '            StrCpy $4 $1 1 $7',
    1,
  );
}

export function mutantE77_intOpFwdInner(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(nsh, '              IntOp $8 $8 + 1', '              IntOp $8 $8 + 2', 1);
}

export function mutantE83_strcpyFwdInner(nsh: string): string {
  return replaceTraversalScanBlockLineByExact(
    nsh,
    '                StrCpy $4 $1 1 $8',
    '                StrCpy $4 $1 1 $7',
    0,
  );
}
