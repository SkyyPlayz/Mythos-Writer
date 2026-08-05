// SKY-9203: grounded **Relationships:** wikilink blocks for agent-created notes.
//
// Every agent note-creation path was writing plain prose with zero [[wikilinks]],
// so agent-populated vaults graphed to ~0 edges (parent bug SKY-8893). This module
// derives Relationships blocks under two HARD de-risk constraints (CEO-set on
// SKY-8945):
//   1. Only link to notes that ALREADY EXIST in the Notes Vault at write time —
//      never emit a forward-link to a non-existent note.
//   2. Only assert what is explicitly present in the material being written: a
//      link is emitted only for a verbatim mention of an existing note's name.
//      No inferred or speculative relationships.
//
// The rendered block matches the SKY-8943 sample-pack convention
// (`**Relationships:**` + `- <label> [[Name]]` bullets), so edges render
// identically in the Vault Graph (vaultGraph.ts resolves [[stems]] to files).

import fs from 'fs';
import path from 'path';
import { SESSIONS_DIRNAME } from './mythosFormat/agentSessions.js';

/**
 * Lowercased note stem → canonical stem (the filename spelling on disk).
 * Last writer wins on stem collision — same resolution rule as vaultGraph.ts.
 */
export type KnownNoteNames = Map<string, string>;

/**
 * Walk the Notes Vault and collect every markdown note's stem. Hidden
 * directories (leading `.`) are skipped, as is the top-level agent-session
 * transcript dir — session files are excluded from the graph (vaultGraph.ts),
 * so a link to one would be a dead edge.
 */
export function collectNotesVaultNoteNames(notesVaultRoot: string): KnownNoteNames {
  const names: KnownNoteNames = new Map();
  function walk(absDir: string, depth: number): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (depth === 0 && entry.isDirectory() && entry.name === SESSIONS_DIRNAME) continue;
      if (entry.isDirectory()) {
        walk(path.join(absDir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stem = entry.name.slice(0, -3);
        names.set(stem.toLowerCase(), stem);
      }
    }
  }
  if (fs.existsSync(notesVaultRoot)) walk(notesVaultRoot, 0);
  return names;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return the canonical names of known notes that appear verbatim (whole-word,
 * case-insensitive) in `text`, ordered by first occurrence. `excludeName` drops
 * the note's own name so a note never lists itself as a relationship.
 */
export function findExplicitMentions(
  text: string,
  known: KnownNoteNames,
  excludeName?: string,
): string[] {
  const excludeLower = excludeName?.toLowerCase();
  const hits: Array<{ index: number; name: string }> = [];
  for (const [lower, canonical] of known) {
    if (lower === excludeLower) continue;
    const re = new RegExp(`(?<![\\w])${escapeRegExp(canonical)}(?![\\w])`, 'i');
    const m = re.exec(text);
    if (m) hits.push({ index: m.index, name: canonical });
  }
  hits.sort((a, b) => a.index - b.index || a.name.localeCompare(b.name));
  return hits.map((h) => h.name);
}

// Same shape as vaultGraph.ts's WIKI_LINK_RE, but capturing the |alias / #heading
// tail so an unresolvable link can be unwrapped to its display text.
const WIKI_LINK_UNWRAP_RE = /\[\[([^\]|#\n]+?)(?:([|#])([^\]\n]*))?\]\]/g;

/**
 * Enforce de-risk constraint 1 on free text: any [[wikilink]] whose target does
 * not resolve to an existing note is unwrapped to plain text (the alias when
 * one is given, otherwise the target itself). LLM output passes through here
 * before it is written to disk, so a hallucinated link can never persist.
 */
export function sanitizeWikilinks(text: string, known: KnownNoteNames): string {
  return text.replace(WIKI_LINK_UNWRAP_RE, (whole, target: string, sep?: string, tail?: string) => {
    // [[folder/stem]] resolves by its last path segment, same as vaultGraph.ts.
    const stem = path.basename(target.trim(), '.md').toLowerCase();
    if (known.has(stem)) return whole;
    if (sep === '|' && tail?.trim()) return tail.trim();
    return target.trim();
  });
}

/**
 * Render the SKY-8943-style Relationships block. The "References" label asserts
 * only the (verbatim, provable) mention itself — never a semantic relationship
 * the source material didn't state.
 */
export function renderRelationshipsBlock(names: string[]): string {
  if (names.length === 0) return '';
  return ['**Relationships:**', ...names.map((n) => `- References [[${n}]]`)].join('\n');
}
