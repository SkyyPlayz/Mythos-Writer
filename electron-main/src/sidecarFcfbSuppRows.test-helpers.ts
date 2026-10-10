/**
 * Supplemental fcfb rows (Forge rows_supp_979f.json). Field-identical to the upload:
 * id, lines, fault, env, expectedDeleted (= expectedDeleted_K == expectedDeleted_W).
 */

import type { FcfbOracleRow } from './sidecarFcfbOracleRows.test-helpers.js';

export const SIDECAR_FCFB_SUPP_ROWS: readonly FcfbOracleRow[] = [
  {
    id: "K:116:reg2:$1->$3",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v/ a/x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:91:num3:1->-1",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\\ a\\x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:148:StrCmp->StrCmpS",
    group: "supp",
    lines: [
      "C:\\PROGRAM FILES\\DESK\\v\r\n",
    ],
    fault: null,
    env: "E2",
    expectedDeleted: [],
  },
  {
    id: "K:142:tgt3:uninstall_vault_read->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Windows\\prof\\Downloads\\My Vault\r\n",
    ],
    fault: null,
    env: "E2",
    expectedDeleted: [],
  },
  {
    id: "K:74:reg1:$4->$3",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v/\\x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:88:tgt3:uninstall_vault_read->uninstall_vault_fallback",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\n",
      "C:\\Users\\me\\Documents\\v\\.. \\x\n",
      "C:\\Users\\me\\Documents\\w\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "C:\\Users\\me\\Documents\\w"],
  },
  {
    id: "K:152:tgt3:0->+4",
    group: "supp",
    lines: [
      "C:\\Users\\me\\AppData\\Roaming\\Mythos Writer/v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\v"],
  },
  {
    id: "K:165:tgt4:0->+5",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents/v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\v"],
  },
  {
    id: "GFW2trunc",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\My Vault\r\n",
    ],
    fault: "g2trunc",
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:151:reg2:$1->$5",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\deep\\s0\\s1\\s2\\s3\\s4\\s5\\s6\\s7\\s8\\s9\\s10\\s11\\s12\\s13\\s14\\s15\\s16\\s17\\s18\\s19\\s20\\s21\\s22\\s23\\s24\\s25\\s26\\s27\\s28\\s29\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\deep\\s0\\s1\\s2\\s3\\s4\\s5\\s6\\s7\\s8\\s9\\s10\\s11\\s12\\s13\\s14\\s15\\s16\\s17\\s18\\s19\\s20\\s21\\s22\\s23\\s24\\s25\\s26\\s27\\s28\\s29"],
  },
  {
    id: "GFK1trunc",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Desktop\\My Vault\r\n",
    ],
    fault: "g1trunc",
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "E1c",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v:x\r\n",
      "C:\\Users\\me\\Documents\\ok\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\ok"],
  },
  {
    id: "X1b",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u001bx\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X09",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\tx\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "E3x",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\ok\r\n",
      "C:\\Users\\me\\Documents\\v\u0001\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\ok"],
  },
  {
    id: "X13",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0013x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X1c",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u001cx\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X06",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0006x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X11",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0011x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X0f",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u000fx\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X02",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0002x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X12",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0012x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X07",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0007x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X10",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0010x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X0e",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u000ex\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X05",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0005x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X19",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0019x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "GFA1truncP",
    group: "supp",
    lines: [
      "C:\\Users\\me\\AppData\\Roaming\\Mythos Writer\\My Vault\r\n",
    ],
    fault: "g1truncP",
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X14",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0014x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X08",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\bx\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X18",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0018x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X0b",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u000bx\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X0c",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\fx\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X15",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0015x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X1d",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u001dx\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X17",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0017x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X1a",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u001ax\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X16",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0016x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X04",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0004x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X1e",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u001ex\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "X03",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\u0003x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:87:tgt3:uninstall_vault_read->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\v.\\x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:142:tgt3:uninstall_vault_read->uninstall_vault_close",
    group: "supp",
    lines: [
      "C:\\Windows\\x\r\n",
      "C:\\Users\\me\\Documents\\My Vault\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\My Vault"],
  },
  {
    id: "K:142:StrCmp->StrCmpS",
    group: "supp",
    lines: [
      "C:\\WINDOWS\\SYSTEM32\\CONFIG\\SYSTEMPROFILE\\APPDATA\\ROAMING\\MYTHOS WRITER\\v\r\n",
    ],
    fault: null,
    env: "E2",
    expectedDeleted: [],
  },
  {
    id: "K:98:tgt3:uninstall_vault_read->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\.\\v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:104:tgt3:uninstall_vault_read->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\x\\..\\v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:137:tgt3:uninstall_vault_read->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\v.\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:138:tgt3:uninstall_vault_read->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\x\\.. \r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:130:tgt3:uninstall_vault_read->uninstall_vault_close",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\n",
      "C:\\Users\\me\\Documents/../../../Windows\n",
      "C:\\Users\\me\\Documents\\w\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "C:\\Users\\me\\Documents\\w"],
  },
  {
    id: "K:88:tgt3:uninstall_vault_read->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\v \\x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:104:tgt3:uninstall_vault_read->uninstall_vault_close",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\n",
      "C:\\Users\\me\\Documents\\..\\..\\..\\Windows\r\n",
      "C:\\Users\\me\\Documents\\w\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "C:\\Users\\me\\Documents\\w"],
  },
  {
    id: "K:79:tgt3:uninstall_vault_read->uninstall_vault_fallback",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\\\v\r\n",
      "C:\\Users\\me\\Documents\\My Vault\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\My Vault"],
  },
  {
    id: "K:70:tgt4:0->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\..::$INDEX_ALLOCATION\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:80:tgt3:uninstall_vault_read->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\/v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:79:tgt3:uninstall_vault_read->mythos_al_not_desktop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\\\v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "GFW1trunc",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\My Vault\r\n",
    ],
    fault: "g1trunc",
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "E2s",
    group: "supp",
    lines: [
      "C:\\Users\\me\\DocumentsOld\\v\r\n",
      "C:\\Users\\me\\Documents\\ok\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\ok"],
  },
  {
    id: "LONG1023",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv"],
  },
  {
    id: "K:98:tgt3:uninstall_vault_read->mythos_trim_chop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\.\\..\\Windows\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:138:tgt3:uninstall_vault_read->uninstall_vault_close",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\aaaaaaaaaa \r\n",
      "C:\\Users\\me\\Documents\\w\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\w"],
  },
  {
    id: "K:145:tgt3:uninstall_vault_read->mythos_trim_chop",
    group: "supp",
    lines: [
      "C:\\Program Files\\System32\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:170:lit2:\"\"->\"x\"",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\x"],
  },
  {
    id: "K:78:num3:1->-1",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\\\\\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:148:tgt3:uninstall_vault_read->mythos_trim_chop",
    group: "supp",
    lines: [
      "C:\\Program Files\\Desk\\v1.2\\notes\r\n",
    ],
    fault: null,
    env: "E2",
    expectedDeleted: [],
  },
  {
    id: "K:112:tgt3:uninstall_vault_read->mythos_trim_chop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\.. ./Windows\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:70:tgt4:0->mythos_canon_gate",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\My Vault\r\n",
      "C:\\Users\\me\\Documents\\v:x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\My Vault"],
  },
  {
    id: "K:176:StrCmp->StrCmpS",
    group: "supp",
    lines: [
      "C:\\USERS\\ME\\DESKTOP\\v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\USERS\\ME\\DESKTOP\\v"],
  },
  {
    id: "K:164:StrCmp->StrCmpS",
    group: "supp",
    lines: [
      "C:\\USERS\\ME\\DOCUMENTS\\v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\USERS\\ME\\DOCUMENTS\\v"],
  },
  {
    id: "K:152:StrCmp->StrCmpS",
    group: "supp",
    lines: [
      "C:\\USERS\\ME\\APPDATA\\ROAMING\\MYTHOS WRITER\\v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\USERS\\ME\\APPDATA\\ROAMING\\MYTHOS WRITER\\v"],
  },
  {
    id: "K:88:tgt3:uninstall_vault_read->mythos_trim_chop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\.. \\Windows\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:79:tgt3:uninstall_vault_read->mythos_canon_gate",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\My Vault\r\n",
      "C:\\Users\\me\\Documents\\\\v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\Users\\me\\Documents\\My Vault"],
  },
  {
    id: "K:188:StrCmp->StrCmpS",
    group: "supp",
    lines: [
      "C:\\USERS\\ME\\DOWNLOADS\\v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: ["C:\\USERS\\ME\\DOWNLOADS\\v"],
  },
  {
    id: "K:80:tgt3:uninstall_vault_read->mythos_trim_chop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\v\\/x\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:99:tgt3:uninstall_vault_read->mythos_trim_chop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\./Windows",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "K:87:tgt3:uninstall_vault_read->mythos_trim_chop",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Documents\\.. .\\Windows\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "N1",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\ v\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
  {
    id: "N3",
    group: "supp",
    lines: [
      "C:\\Users\\me\\Downloads\\x\\x\\..\r\n",
    ],
    fault: null,
    env: "E1",
    expectedDeleted: [],
  },
];

