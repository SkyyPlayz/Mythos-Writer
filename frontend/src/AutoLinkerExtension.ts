import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { changedRanges, expandToTextblocks } from './editor/changedRanges';

export type AutoLinkerMode = 'off' | 'suggest' | 'auto';

export const AUTO_LINKER_META = 'autoLinkerMeta';

// ─── Pure helpers (exported for unit testing) ──────────────────────────────

export interface EntityTerm {
  text: string;
  entityId: string;
  canonicalName: string;
}

export interface EntityMatch {
  from: number;
  to: number;
  anchorText: string;
  entityId: string;
  canonicalName: string;
}

/** Flatten entity canonical names + aliases into a sorted term list. */
export function buildEntityTerms(entities: EntityEntry[]): EntityTerm[] {
  return entities
    .filter((e) => !e.properties?.noAutoLink)
    .flatMap((e) => [
      { text: e.name, entityId: e.id, canonicalName: e.name },
      ...(e.aliases ?? []).map((alias) => ({
        text: alias,
        entityId: e.id,
        canonicalName: e.name,
      })),
    ])
    .filter((t) => t.text.trim().length >= 2)
    .sort((a, b) => b.text.length - a.text.length); // longest first to avoid partial shadowing
}

/**
 * Scan a plain-text string for entity term matches.
 * Enforces word boundaries and non-overlapping matches.
 */
export function findEntityMentions(text: string, terms: EntityTerm[]): EntityMatch[] {
  const matches: EntityMatch[] = [];
  const textLower = text.toLowerCase();
  const occupied = new Set<number>();

  for (const term of terms) {
    const needle = term.text.toLowerCase();
    if (needle.length < 2) continue;

    let start = 0;
    let idx: number;
    while ((idx = textLower.indexOf(needle, start)) >= 0) {
      const end = idx + needle.length;
      start = idx + 1;

      // Word-boundary check
      const prevChar = idx > 0 ? text[idx - 1] : '\0';
      const nextChar = end < text.length ? text[end] : '\0';
      if (/\w/.test(prevChar) || /\w/.test(nextChar)) continue;

      // No overlap with already-claimed ranges
      let overlaps = false;
      for (let i = idx; i < end; i++) {
        if (occupied.has(i)) { overlaps = true; break; }
      }
      if (overlaps) continue;

      for (let i = idx; i < end; i++) occupied.add(i);
      matches.push({
        from: idx,
        to: end,
        anchorText: text.slice(idx, end),
        entityId: term.entityId,
        canonicalName: term.canonicalName,
      });
    }
  }

  return matches;
}

// ─── ProseMirror plugin ────────────────────────────────────────────────────

interface AutoLinkerPluginState {
  entities: EntityEntry[];
  mode: AutoLinkerMode;
  decos: DecorationSet;
}

const autoLinkerKey = new PluginKey<AutoLinkerPluginState>('autoLinker');

/** Collect autolink decorations for the nodes overlapping [from, to] only. */
function collectDecorationsInRange(
  doc: PMNode,
  terms: EntityTerm[],
  from: number,
  to: number,
): Decoration[] {
  const decos: Decoration[] = [];

  doc.nodesBetween(from, to, (node, pos) => {
    // Skip these node types entirely (don't descend into them)
    if (
      node.type.name === 'codeBlock' ||
      node.type.name === 'blockquote' ||
      node.type.name === 'wikiLink'
    ) {
      return false;
    }

    if (!node.isText || !node.text) return true;

    // Skip inline code marks
    if (node.marks.some((m) => m.type.name === 'code')) return true;

    const text = node.text;
    const matches = findEntityMentions(text, terms);

    for (const m of matches) {
      decos.push(
        Decoration.inline(pos + m.from, pos + m.to, {
          class: 'archive-wl-hint',
          'data-wl-id': `autolink:${m.entityId}`,
          'data-wl-link': `[[${m.canonicalName}]]`,
          'data-wl-anchor': m.anchorText,
        }),
      );
    }

    return true;
  });

  return decos;
}

function buildDecorations(
  doc: PMNode,
  entities: EntityEntry[],
  mode: AutoLinkerMode,
): DecorationSet {
  if (mode === 'off' || entities.length === 0) return DecorationSet.empty;

  const terms = buildEntityTerms(entities);
  if (terms.length === 0) return DecorationSet.empty;

  return DecorationSet.create(doc, collectDecorationsInRange(doc, terms, 0, doc.content.size));
}

export const AutoLinkerExtension = Extension.create({
  name: 'autoLinker',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: autoLinkerKey,
        state: {
          init() {
            return {
              entities: [] as EntityEntry[],
              mode: 'suggest' as AutoLinkerMode,
              decos: DecorationSet.empty,
            };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(AUTO_LINKER_META) as
              | { entities?: EntityEntry[]; mode?: AutoLinkerMode }
              | undefined;

            // Entity list or mode changed (rare: settings/vault update) — full rebuild,
            // matches can appear/disappear anywhere in the document.
            if (meta !== undefined) {
              const entities = meta.entities ?? prev.entities;
              const mode = meta.mode ?? prev.mode;
              return { entities, mode, decos: buildDecorations(tr.doc, entities, mode) };
            }

            if (!tr.docChanged) return prev;

            // Per-keystroke path: only rescan the textblock(s) the edit touched,
            // not the whole document (SKY-8224 — was O(doc size) per keystroke).
            if (prev.mode === 'off' || prev.entities.length === 0) {
              return { ...prev, decos: prev.decos.map(tr.mapping, tr.doc) };
            }

            const changed = changedRanges(tr);
            if (!changed) return { ...prev, decos: prev.decos.map(tr.mapping, tr.doc) };

            const { from, to } = expandToTextblocks(tr.doc, changed.from, changed.to);
            const mapped = prev.decos.map(tr.mapping, tr.doc);
            const stale = mapped.find(from, to);
            const terms = buildEntityTerms(prev.entities);
            const fresh = terms.length === 0 ? [] : collectDecorationsInRange(tr.doc, terms, from, to);

            return { ...prev, decos: mapped.remove(stale).add(tr.doc, fresh) };
          },
        },
        props: {
          decorations(state) {
            return autoLinkerKey.getState(state)?.decos;
          },
        },
      }),
    ];
  },
});

/** Read current auto-linker plugin state from any ProseMirror EditorState. */
export function getAutoLinkerState(state: EditorState): AutoLinkerPluginState | undefined {
  return autoLinkerKey.getState(state) ?? undefined;
}

/**
 * Collect all current entity match ranges from the document.
 * Used by the "auto on save" apply path in BlockEditor.
 */
export function collectAutoLinkerRanges(
  doc: import('@tiptap/pm/model').Node,
  entities: EntityEntry[],
): Array<{ from: number; to: number; target: string }> {
  const terms = buildEntityTerms(entities);
  if (terms.length === 0) return [];

  const result: Array<{ from: number; to: number; target: string }> = [];

  doc.descendants((node, pos) => {
    if (
      node.type.name === 'codeBlock' ||
      node.type.name === 'blockquote' ||
      node.type.name === 'wikiLink'
    ) {
      return false;
    }
    if (!node.isText || !node.text) return true;
    if (node.marks.some((m) => m.type.name === 'code')) return true;

    const matches = findEntityMentions(node.text, terms);
    for (const m of matches) {
      result.push({ from: pos + m.from, to: pos + m.to, target: m.canonicalName });
    }
    return true;
  });

  return result;
}
