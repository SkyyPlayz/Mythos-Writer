// W0.2 (Beta 4 "Refine", GAP-REPORT-v2 P0#2): the single shared frontmatter
// splitter every Rich/preview renderer routes through.
//
// FULL-SPEC §6 hard rule: YAML frontmatter NEVER renders in Rich/preview
// views — it is shown only in Source mode. Kanban board files additionally
// hide their `%% kanban:settings %%` trailer in Rich display.
//
// Contract:
//   raw === frontmatter + body                      (splitFrontmatter)
//   body === displayBody + kanbanSettings           (splitKanbanSettings)
// Both chunks are verbatim slices of the input, so editors can hold them
// aside during editing and reassemble the file byte-for-byte on save.
//
// This module deliberately does NOT parse YAML — parsing/editing lives in
// `noteFrontmatter.ts` (Properties tab) and `electron-main/src/vault.ts`.

export interface FrontmatterSplit {
  /**
   * The verbatim frontmatter block — opening `---` line through the closing
   * `---` line inclusive (with its trailing newline when present). Empty
   * string when the file has no frontmatter.
   */
  frontmatter: string;
  /** Everything after the frontmatter block; the whole input when none. */
  body: string;
}

const OPEN_FENCE_RE = /^---[ \t]*\r?\n/;
const CLOSE_FENCE_LINE_RE = /^---[ \t]*\r?$/;

/**
 * Split `raw` into its leading YAML frontmatter block and the body after it.
 *
 * Tolerant by design:
 * - `\r\n` line endings are accepted on both fences and inner lines.
 * - No opening `---` on the very first line → no frontmatter, body = raw.
 * - Unterminated fence (opening `---` but no closing `---` line) → treated
 *   as body, never silently swallowed: body = raw.
 * - An empty block (`---\n---\n`) is valid frontmatter.
 */
export function splitFrontmatter(raw: string): FrontmatterSplit {
  const open = raw.match(OPEN_FENCE_RE);
  if (!open) return { frontmatter: '', body: raw };

  let offset = open[0].length;
  while (offset <= raw.length) {
    const lineEnd = raw.indexOf('\n', offset);
    const line = lineEnd === -1 ? raw.slice(offset) : raw.slice(offset, lineEnd);
    if (CLOSE_FENCE_LINE_RE.test(line)) {
      const end = lineEnd === -1 ? raw.length : lineEnd + 1;
      return { frontmatter: raw.slice(0, end), body: raw.slice(end) };
    }
    if (lineEnd === -1) break; // last line reached without a closing fence
    offset = lineEnd + 1;
  }
  // Unterminated fence → the safest read is "this file has no frontmatter".
  return { frontmatter: '', body: raw };
}

export interface KanbanSettingsSplit {
  /** The body with the trailing `%% kanban:settings %%` block removed. */
  body: string;
  /**
   * The verbatim settings trailer, including the newline that separated it
   * from the body. Empty string when the note has none.
   */
  kanbanSettings: string;
}

// Obsidian-Kanban writes its settings as the LAST thing in the file:
//   %% kanban:settings
//   ```json
//   { ... }
//   ```
//   %%
// The opener `%% kanban:settings`, lazily up to a closing `%%` line (or EOF
// when unterminated). Matched at start-of-body or after a newline.
const KANBAN_SETTINGS_RE =
  /(?:^|\r?\n)%%[ \t]*kanban:settings\b[\s\S]*?(?:\r?\n%%[ \t]*(?=\r?\n|$)|$)/;

/**
 * Extract a trailing `%% kanban:settings %%` block from a note body.
 *
 * Only a block with nothing but whitespace after it is extracted — that is
 * the only shape the Kanban plugin writes, and it guarantees
 * `body === displayBody + kanbanSettings` reassembles the file exactly.
 */
export function splitKanbanSettings(body: string): KanbanSettingsSplit {
  const m = body.match(KANBAN_SETTINGS_RE);
  if (!m || m.index === undefined) return { body, kanbanSettings: '' };
  const closeEnd = m.index + m[0].length;
  if (body.slice(closeEnd).trim() !== '') return { body, kanbanSettings: '' };
  return { body: body.slice(0, m.index), kanbanSettings: body.slice(m.index) };
}

/**
 * What Rich/preview surfaces render: the note body with YAML frontmatter and
 * any trailing `%% kanban:settings %%` block removed (FULL-SPEC §6).
 * Source/raw-markdown views must NOT use this — they keep showing everything.
 */
export function stripHiddenBlocks(raw: string): string {
  return splitKanbanSettings(splitFrontmatter(raw).body).body;
}

/**
 * Rebuild a full note file after a Rich-mode edit: the previous file's
 * verbatim frontmatter block and kanban-settings trailer are spliced back
 * around the newly serialized display body. Inverse of `stripHiddenBlocks`:
 * `replaceDisplayBody(raw, stripHiddenBlocks(raw)) === raw`.
 */
export function replaceDisplayBody(raw: string, newDisplayBody: string): string {
  const { frontmatter, body } = splitFrontmatter(raw);
  const { kanbanSettings } = splitKanbanSettings(body);
  return frontmatter + newDisplayBody + kanbanSettings;
}
