// SKY-20: Brainstorm routing memory + destination resolution.
//
// Default-mode vaults (SKY-15 seeded layout) write straight into the canonical
// per-category folder under the seeded example universe. Blank-mode vaults
// have no implicit taxonomy — the agent asks the user once per category where
// it should drop that kind of note, then reuses the choice for every later
// note in the same category.
//
// Persisted in `userData/brainstorm-settings.json`. Decoupled from
// `vault-settings.json` (the vault root + layoutMode lives there) so a
// blank-mode user can move to a different vault without losing their routing
// memory for the categories they have already classified.
//
// No Electron import here — the IPC layer injects `userDataPath` and the
// `VaultLayoutMode` lookup so this module stays fully unit-testable.

import fs from 'fs';
import path from 'path';
import type { FactType } from './brainstormAgent.js';
import {
  NOTES_VAULT_EXAMPLE_UNIVERSE,
  type VaultLayoutMode,
} from './vault.js';

/** Per-category routing memory. Keys are FactTypes; values are vault-relative
 *  POSIX paths (no leading slash, forward slashes, no `..`). */
export type NotesRouting = Partial<Record<FactType, string>>;

export interface BrainstormSettings {
  /** Schema version — bump when adding fields so existing installs migrate. */
  v: 1;
  /** Per-category folder choices remembered by the agent in Blank mode. */
  notesRouting: NotesRouting;
}

const DEFAULT_SETTINGS: BrainstormSettings = { v: 1, notesRouting: {} };

const SETTINGS_FILE = 'brainstorm-settings.json';

export function getBrainstormSettingsPath(userDataPath: string): string {
  return path.join(userDataPath, SETTINGS_FILE);
}

export function loadBrainstormSettings(userDataPath: string): BrainstormSettings {
  const file = getBrainstormSettingsPath(userDataPath);
  if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<BrainstormSettings>;
    return {
      v: 1,
      notesRouting: { ...(raw.notesRouting ?? {}) },
    };
  } catch {
    // Corrupt file → fall back to defaults rather than crash boot. The next
    // save rewrites it.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveBrainstormSettings(
  userDataPath: string,
  updates: Partial<BrainstormSettings>,
): BrainstormSettings {
  const current = loadBrainstormSettings(userDataPath);
  const merged: BrainstormSettings = {
    v: 1,
    notesRouting: { ...current.notesRouting, ...(updates.notesRouting ?? {}) },
  };
  fs.writeFileSync(getBrainstormSettingsPath(userDataPath), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

/** Set or clear a single category's routing destination. Passing `null`
 *  clears it (i.e. re-prompt on next note of that type). */
export function setCategoryRouting(
  userDataPath: string,
  category: FactType,
  destination: string | null,
): BrainstormSettings {
  const current = loadBrainstormSettings(userDataPath);
  const next: NotesRouting = { ...current.notesRouting };
  if (destination === null) {
    delete next[category];
  } else {
    next[category] = normalizeRoutingDestination(destination);
  }
  const merged: BrainstormSettings = { v: 1, notesRouting: next };
  fs.writeFileSync(getBrainstormSettingsPath(userDataPath), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

/** Normalize a user-chosen destination into a vault-relative POSIX path.
 *  Strips leading slashes, collapses backslashes, and rejects `..` traversal.
 *  Empty string maps to the vault root. */
export function normalizeRoutingDestination(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') return '';
  // realSafePath in vault.ts does the deep validation at write time; this is
  // a cheap structural guard so a junk value isn't persisted and then re-read.
  if (trimmed.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new Error(`Invalid routing destination: ${raw}`);
  }
  return trimmed;
}

// ─── Destination resolution ──────────────────────────────────────────────

export type DestinationResolution =
  | { kind: 'resolved'; relativeDir: string; reason: 'default-layout' | 'remembered' }
  | { kind: 'needs_user_choice'; category: FactType };

/**
 * Decide where a brainstorm-extracted fact of `category` should land in the
 * Notes Vault, given the user's `layoutMode` and any remembered choices.
 *
 * Default mode → canonical SKY-15 seeded paths under the example universe
 * (`Universes/My First Universe/<Category>/`) for character/location/item;
 * `note` lands in `Inbox/` because the plan reserves Inbox for unclassified
 * brainstorm dumps. Default-mode behavior is fully deterministic so the SKY-9
 * seeding contract is preserved end-to-end.
 *
 * Blank mode (and `imported`, which is treated as blank for routing
 * purposes) → consult the per-category memory. Hit → resolved. Miss →
 * the caller must prompt the user.
 */
export function resolveDestination(
  category: FactType,
  layoutMode: VaultLayoutMode | 'imported',
  routing: NotesRouting,
): DestinationResolution {
  if (layoutMode === 'default') {
    return { kind: 'resolved', relativeDir: defaultLayoutDirFor(category), reason: 'default-layout' };
  }
  const remembered = routing[category];
  if (typeof remembered === 'string') {
    return { kind: 'resolved', relativeDir: remembered, reason: 'remembered' };
  }
  return { kind: 'needs_user_choice', category };
}

/** SKY-15 default-mode destination map. Kept in this module (not vault.ts)
 *  because it is a brainstorm-routing concern, not a seeding one — the
 *  seeded folders exist either way; the agent just picks which one. */
export function defaultLayoutDirFor(category: FactType): string {
  switch (category) {
    case 'character':
      return `Universes/${NOTES_VAULT_EXAMPLE_UNIVERSE}/Characters`;
    case 'location':
      return `Universes/${NOTES_VAULT_EXAMPLE_UNIVERSE}/Locations`;
    case 'item':
      return `Universes/${NOTES_VAULT_EXAMPLE_UNIVERSE}/Items`;
    case 'faction':
      return `Universes/${NOTES_VAULT_EXAMPLE_UNIVERSE}/Factions`;
    case 'scene_card':
      return `Universes/${NOTES_VAULT_EXAMPLE_UNIVERSE}/Scenes`;
    case 'inbox':
      return 'Inbox';
  }
}

/** Where to stage a blank-mode note while the renderer prompts the user. The
 *  file is written to disk immediately so it survives a renderer crash; the
 *  user's choice then moves it to its final home. `Inbox/` is the SKY-15
 *  catch-all and is seeded in default mode — in blank mode the caller is
 *  expected to mkdir it on demand. The leading dot keeps the staging dir
 *  out of the user's vault browser by convention. */
export const BLANK_MODE_STAGING_DIR = '.brainstorm-staging';

// ─── Context selection (SKY-196) ─────────────────────────────────────────────

/** Default token budget for vault context injected into a Brainstorm request.
 *  4 000 tokens leaves ample headroom inside a 200 k context window. Callers
 *  can override by passing `tokenBudget` to {@link selectContext}. */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 4_000;

/** Coarse token estimate — 4 characters per token.  Fast and
 *  framework-agnostic; accurate enough for budget gating. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A vault note fed to {@link selectContext} as a candidate for context injection. */
export interface ContextCandidate {
  path: string;
  name: string;
  type: FactType;
  content: string;
}

/** A candidate that has been scored, with a human-readable inclusion reason. */
export interface ContextItem extends ContextCandidate {
  /** Approximate token cost of name + content. */
  estimatedTokens: number;
  /** Why this item was (or was not) sent to Claude. */
  whyIncluded: string;
}

export interface ContextSelectionResult {
  /** Items that fit inside the token budget and were included in the prompt. */
  included: ContextItem[];
  /** Items that were candidates but pushed past the budget limit. */
  excluded: ContextItem[];
  /** Total tokens consumed by the included items. */
  usedTokens: number;
  /** The budget ceiling that was applied. */
  budgetTokens: number;
}

/**
 * Select vault notes to include in the Brainstorm AI context, staying within
 * `tokenBudget` tokens.  Priority order:
 *
 *   1. Name appears in the current user message   (score 3)
 *   2. Name appears anywhere in conversation history (score 2)
 *   3. Background filler, ordered by type then name  (score 1)
 *
 * Each returned item carries a `whyIncluded` string for the "Context used"
 * panel in the UI.  Candidates that exceed the budget go to `excluded` with
 * reason `"Budget limit reached"`.
 */
export function selectContext(args: {
  candidates: ContextCandidate[];
  userMessage: string;
  conversationText: string;
  tokenBudget?: number;
}): ContextSelectionResult {
  const budget = args.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET;
  const userLow = args.userMessage.toLowerCase();
  const convLow = args.conversationText.toLowerCase();

  const TYPE_ORDER: Record<FactType, number> = { character: 0, location: 1, item: 2, faction: 3, scene_card: 4, inbox: 5 };

  type Scored = ContextCandidate & { estimatedTokens: number; whyIncluded: string; _score: number };

  const scored: Scored[] = args.candidates.map((c) => {
    const nameLow = c.name.toLowerCase();
    const inUser = userLow.includes(nameLow);
    const inConv = !inUser && convLow.includes(nameLow);
    const _score = inUser ? 3 : inConv ? 2 : 1;
    const whyIncluded = inUser
      ? 'Mentioned in your message'
      : inConv
        ? 'Referenced in conversation'
        : `Background ${c.type} context`;
    const estimatedTokens = estimateTokens(`${c.name}\n${c.content}`);
    return { ...c, estimatedTokens, whyIncluded, _score };
  });

  scored.sort(
    (a, b) =>
      b._score - a._score ||
      (TYPE_ORDER[a.type] ?? 4) - (TYPE_ORDER[b.type] ?? 4) ||
      a.name.localeCompare(b.name),
  );

  const included: ContextItem[] = [];
  const excluded: ContextItem[] = [];
  let usedTokens = 0;

  for (const { _score: _ignored, ...item } of scored) {
    if (usedTokens + item.estimatedTokens <= budget) {
      included.push(item);
      usedTokens += item.estimatedTokens;
    } else {
      excluded.push({ ...item, whyIncluded: 'Budget limit reached' });
    }
  }

  return { included, excluded, usedTokens, budgetTokens: budget };
}

// ─── Notes Vault folder listing for the picker ───

/** A folder entry suitable for the routing picker UI. Vault-relative POSIX
 *  paths so the renderer can pass them straight back to RESOLVE_ROUTING. */
export interface NotesFolderEntry {
  path: string;
  label: string;
}

/** Walk the Notes Vault and return its folder tree, depth-limited so the
 *  picker stays usable on large vaults. Hidden dirs (leading `.`) — including
 *  the staging dir — are skipped. Sorted alphabetically by path. */
export function listNotesVaultFolders(
  notesVaultRoot: string,
  maxDepth = 3,
): NotesFolderEntry[] {
  const out: NotesFolderEntry[] = [];
  if (!fs.existsSync(notesVaultRoot)) return out;
  // The vault root itself is a valid pick — it means "put it at the top".
  out.push({ path: '', label: '/ (vault root)' });
  walkDir(notesVaultRoot, '', 0, maxDepth, out);
  return out;
}

function walkDir(
  rootAbs: string,
  relSoFar: string,
  depth: number,
  maxDepth: number,
  out: NotesFolderEntry[],
): void {
  if (depth >= maxDepth) return;
  const dirAbs = path.join(rootAbs, relSoFar);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of dirs) {
    const childRel = relSoFar ? `${relSoFar}/${entry.name}` : entry.name;
    out.push({ path: childRel, label: childRel });
    walkDir(rootAbs, childRel, depth + 1, maxDepth, out);
  }
}
