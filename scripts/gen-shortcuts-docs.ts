/**
 * Generates docs/shortcuts.md from frontend/src/shortcuts/manifest.ts.
 * Run: npm run docs:shortcuts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import MANIFEST, { type ShortcutEntry } from '../frontend/src/shortcuts/manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GROUP_LABELS: Record<string, string> = {
  modes:      'Writing Modes',
  navigation: 'Navigation',
  vault:      'Vault & Tree',
  editor:     'Editor (native shortcuts)',
  brainstorm: 'Brainstorm & Writing Assistant',
  dialogs:    'Dialogs & Inline Actions',
  help:       'Help',
};

function comboLabel(combo: ShortcutEntry['keys'][number]): string {
  const mods = Array.isArray(combo.mod) ? combo.mod : combo.mod ? [combo.mod] : [];
  const parts = mods.map((m) => {
    if (m === 'cmd-or-ctrl') return '⌘/Ctrl';
    if (m === 'shift') return 'Shift';
    if (m === 'alt') return 'Alt/⌥';
    return m;
  });
  parts.push(combo.key);
  return parts.join('+');
}

function keysLabel(entry: ShortcutEntry): string {
  return entry.keys.map(comboLabel).join(' or ');
}

const byGroup: Record<string, ShortcutEntry[]> = {};
for (const e of MANIFEST) {
  if (!byGroup[e.group]) byGroup[e.group] = [];
  byGroup[e.group].push(e);
}

const lines: string[] = [
  '# Keyboard Shortcuts',
  '',
  '> **Generated from** `frontend/src/shortcuts/manifest.ts`.',
  '> To update: edit the manifest, then run `npm run docs:shortcuts`.',
  '',
  '---',
  '',
];

for (const [group, label] of Object.entries(GROUP_LABELS)) {
  const entries = byGroup[group];
  if (!entries?.length) continue;

  lines.push(`## ${label}`, '');
  lines.push('| Keys | Scope | Action | Notes |');
  lines.push('|------|-------|--------|-------|');
  for (const e of entries) {
    const keys = `\`${keysLabel(e)}\``;
    const notes = e.whenDisabled ?? '';
    lines.push(`| ${keys} | ${e.scope} | ${e.label} | ${notes} |`);
  }
  lines.push('');
}

lines.push('---', '');
lines.push('## Collision Notes', '');
lines.push(
  'No collisions found in audit. ' +
  'Scope-isolated shortcuts (e.g. `Enter` in a list vs. a dialog) fire only within their focus scope — no ambiguity.', '');
lines.push('### Intentionally absent');
lines.push('- `⌘/Ctrl+S` — autosave is always on; no explicit shortcut needed.');
lines.push('- `⌘/Ctrl+N` — new note available only from toolbar.');
lines.push('- `⌘/Ctrl+F` — global find relies on SearchBar focus affordance.');
lines.push('');

mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs/shortcuts.md'), lines.join('\n'));
console.log(`docs/shortcuts.md written — ${MANIFEST.length} shortcuts across ${Object.keys(byGroup).length} groups.`);
