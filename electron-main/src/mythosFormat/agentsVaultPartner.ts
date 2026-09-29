// Slice D — Agents Vault partner.md + hand identity files.
// Under each Mythos vault's Agent Vault/: partner.md, writer.md, analyst.md,
// archivist.md. Settings › Writing partner binds/syncs to these files.
// Clear agent memory clears chat/session machine state under Agent Vault
// without wiping partner/hand identity files.

import fs from 'node:fs';
import path from 'node:path';
import { AGENT_VAULT_DIRNAME, agentVaultRootFor } from './mythosJson.js';
import { writeFileAtomic } from '../vault.js';

export const PARTNER_MD = 'partner.md';
export const HAND_FILES = ['writer.md', 'analyst.md', 'archivist.md'] as const;
export type HandFileName = (typeof HAND_FILES)[number];

export const AGENTS_PARTNER_FILES = [PARTNER_MD, ...HAND_FILES] as const;

const DEFAULT_PARTNER_MD = `# Writing partner

name: Mythos
icon: sparkle

Bound by Mythos Writer Settings › Writing partner.
`;

const DEFAULT_HAND_MD: Record<HandFileName, string> = {
  'writer.md': `# Writer hand

Craft-focused coaching and manuscript help.
`,
  'analyst.md': `# Analyst hand

Structure, continuity, and beta-style reads.
`,
  'archivist.md': `# Archivist hand

Notes, vault search, and continuity index.
`,
};

export function agentsPartnerDir(mythosRoot: string): string {
  return agentVaultRootFor(mythosRoot);
}

export function partnerFilePath(mythosRoot: string, file: string): string {
  return path.join(agentsPartnerDir(mythosRoot), file);
}

/** Ensure Agent Vault exists and partner/hand identity files are present (never wipe). */
export function ensureAgentsPartnerFiles(mythosRoot: string): {
  ok: true;
  created: string[];
  agentVaultPath: string;
} {
  const agentRoot = agentsPartnerDir(mythosRoot);
  fs.mkdirSync(agentRoot, { recursive: true });
  const created: string[] = [];
  for (const file of AGENTS_PARTNER_FILES) {
    const abs = path.join(agentRoot, file);
    if (!fs.existsSync(abs)) {
      const body = file === PARTNER_MD ? DEFAULT_PARTNER_MD : DEFAULT_HAND_MD[file as HandFileName];
      writeFileAtomic(abs, body);
      created.push(file);
    }
  }
  return { ok: true, created, agentVaultPath: agentRoot };
}

export function readPartnerMd(mythosRoot: string): string | null {
  try {
    return fs.readFileSync(partnerFilePath(mythosRoot, PARTNER_MD), 'utf-8');
  } catch {
    return null;
  }
}

export function writePartnerMd(mythosRoot: string, content: string): void {
  ensureAgentsPartnerFiles(mythosRoot);
  writeFileAtomic(partnerFilePath(mythosRoot, PARTNER_MD), content);
}

/** Sync identity fields into partner.md (preserves unknown body lines). */
export function syncPartnerIdentityToFile(
  mythosRoot: string,
  identity: { name: string; icon: string },
): void {
  ensureAgentsPartnerFiles(mythosRoot);
  const abs = partnerFilePath(mythosRoot, PARTNER_MD);
  let body = '';
  try {
    body = fs.readFileSync(abs, 'utf-8');
  } catch {
    body = DEFAULT_PARTNER_MD;
  }
  const lines = body.split(/\r?\n/);
  let sawName = false;
  let sawIcon = false;
  const next = lines.map((line) => {
    if (/^name:\s*/i.test(line)) {
      sawName = true;
      return `name: ${identity.name}`;
    }
    if (/^icon:\s*/i.test(line)) {
      sawIcon = true;
      return `icon: ${identity.icon}`;
    }
    return line;
  });
  if (!sawName) next.splice(2, 0, `name: ${identity.name}`);
  if (!sawIcon) next.splice(sawName ? 3 : 3, 0, `icon: ${identity.icon}`);
  writeFileAtomic(abs, `${next.join('\n').replace(/\n+$/, '')}\n`);
}

export function parsePartnerIdentityFromFile(mythosRoot: string): { name: string | null; icon: string | null } {
  const body = readPartnerMd(mythosRoot);
  if (!body) return { name: null, icon: null };
  let name: string | null = null;
  let icon: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const nm = line.match(/^name:\s*(.+)\s*$/i);
    if (nm) name = nm[1].trim();
    const ic = line.match(/^icon:\s*(.+)\s*$/i);
    if (ic) icon = ic[1].trim();
  }
  return { name, icon };
}

/**
 * Clear agent memory: remove session/board/machine artifacts under Agent Vault
 * while keeping partner.md + hand identity files.
 */
export function clearAgentMemory(mythosRoot: string): {
  ok: true;
  removed: string[];
} | { ok: false; error: string } {
  const agentRoot = agentsPartnerDir(mythosRoot);
  if (!fs.existsSync(agentRoot)) {
    ensureAgentsPartnerFiles(mythosRoot);
    return { ok: true, removed: [] };
  }
  const keep = new Set<string>(AGENTS_PARTNER_FILES);
  const removed: string[] = [];
  try {
    for (const entry of fs.readdirSync(agentRoot, { withFileTypes: true })) {
      if (keep.has(entry.name)) continue;
      const abs = path.join(agentRoot, entry.name);
      fs.rmSync(abs, { recursive: true, force: true });
      removed.push(entry.name);
    }
    ensureAgentsPartnerFiles(mythosRoot);
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function listAgentsVaultStats(mythosRoot: string): {
  path: string;
  name: string;
  files: number;
  chips: string[];
} {
  const agentRoot = agentsPartnerDir(mythosRoot);
  ensureAgentsPartnerFiles(mythosRoot);
  let files = 0;
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else files += 1;
    }
  };
  try {
    walk(agentRoot);
  } catch {
    /* empty */
  }
  const chips: string[] = ['partner.md', 'Writer', 'Analyst', 'Archivist'];
  if (fs.existsSync(path.join(agentRoot, 'Sessions'))) chips.push('Chat history');
  return {
    path: agentRoot,
    name: AGENT_VAULT_DIRNAME,
    files,
    chips,
  };
}
