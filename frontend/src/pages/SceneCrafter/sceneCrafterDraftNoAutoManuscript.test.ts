// Beta 4 / M19 — Scene Crafter agent-contract lock (§7.1 AC#6): generated
// prose NEVER enters the manuscript; the writer lifts it onto the canvas
// board by hand via "Add to scene board" (B4-9).
//
// Mirrors frontend/src/coach/coachNoGhostwriting.test.ts. A static denylist
// over every source file under pages/SceneCrafter/ — no file in this
// directory may reference a manuscript/scene write surface. Board mutation
// (sceneCrafter* lane/card IPC, Notes-Vault board persistence) is untouched
// by this lock; only the manuscript-write entry points are forbidden.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CRAFTER_DIR = path.resolve(__dirname);

/**
 * Manuscript/scene write surfaces (preload names + renderer/IPC helpers).
 * None of these may appear anywhere under pages/SceneCrafter/.
 */
const FORBIDDEN_PATTERNS = [
  /\bsceneSave\b/,
  /\bsaveScene\b/,
  /\bsession:saveScene\b/,
  /\bwriteManifest\b/,
  /\bwriteManifestRaw\b/,
  /\bwriteVaultFileAtomic\b/,
  /\bpersistSceneMarkdown\b/,
  /\bupdateScene\b/,
  /\bcreateScene\b/,
  /\bsceneAppend/,
  /\binsertIntoManuscript\b/i,
  /\bdocument\.execCommand\b/,
];

function crafterSourceFiles(): string[] {
  return fs
    .readdirSync(CRAFTER_DIR)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.'))
    .map((f) => path.join(CRAFTER_DIR, f));
}

describe('M19 §7.1 AC#6 — no manuscript-prose write path from Scene Crafter', () => {
  it('scene crafter sources exist', () => {
    expect(crafterSourceFiles().length).toBeGreaterThan(0);
  });

  it('no source under pages/SceneCrafter/ references a manuscript-write surface', () => {
    for (const file of crafterSourceFiles()) {
      const src = fs.readFileSync(file, 'utf-8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(
          pattern.test(src),
          `${path.basename(file)} matches forbidden pattern ${pattern} — Scene Crafter must ` +
          'never write generated prose into the manuscript (§7.1 AC#6).',
        ).toBe(false);
      }
    }
  });

  it('crafterDraft.ts calls no window.api / IPC surface at all (pure generation shaping)', () => {
    const src = fs.readFileSync(path.join(CRAFTER_DIR, 'crafterDraft.ts'), 'utf-8');
    expect(src).not.toMatch(/window\.api/);
    expect(src).not.toMatch(/ipcRenderer/);
  });

  it('the draft-review path in SceneCrafterPage only reaches agentWritingAssistant and board persistence', () => {
    const src = fs.readFileSync(path.join(CRAFTER_DIR, 'SceneCrafterPage.tsx'), 'utf-8');
    // The generation call itself: advisory text only, same surface the
    // Writing Coach uses (frontend/src/coach/useCoachConversation.ts).
    expect(src).toContain('window.api.agentWritingAssistant');
    // "Add to scene board" persists through the Notes-Vault board store —
    // never through a manuscript/scene save call.
    expect(src).toContain('persistBoard');
  });
});
