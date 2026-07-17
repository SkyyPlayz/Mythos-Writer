// Beta 4 M12 — agent-contract lock (§2, §14.6): the Writing Coach TEACHES.
// "No manuscript-prose generation path from Coach surfaces" is a binding
// acceptance clause: nothing under frontend/src/coach/ may reach any IPC or
// helper that writes prose into scenes, notes, or vault files.
//
// This is a static allowlist over the coach module's `window.api` surface plus
// a denylist of manuscript-write entry points. If a future change needs a new
// API from a Coach surface, it must be added to ALLOWED_API_CALLS after
// checking it cannot insert generated prose into the manuscript.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const COACH_DIR = path.resolve(__dirname);

/** Renderer APIs a Coach surface may touch: advisory text + session persistence + read-only suggestion feed. */
const ALLOWED_API_CALLS = new Set([
  'agentWritingAssistant',
  'agentSessions',
  'suggestionsUnifiedList',
]);

/**
 * Manuscript/vault write surfaces (preload names + renderer helpers). None of
 * these may appear in coach sources — the coach never writes prose anywhere.
 */
const FORBIDDEN_PATTERNS = [
  /\bwriteVault\b/,
  /\bwriteManifest\b/,
  /\bsuggestionApply\b/,
  /\bsuggestionsApply\b/,
  /\bsceneAppend/,
  /\bpersistSceneMarkdown\b/,
  /\bupdateScene\b/,
  /\bcreateScene\b/,
  /\bsceneCrafter/i,
  /\binsertIntoManuscript\b/i,
  /\bdocument\.execCommand\b/,
];

function coachSourceFiles(): string[] {
  return fs
    .readdirSync(COACH_DIR)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.'))
    .map((f) => path.join(COACH_DIR, f));
}

describe('M12 §14.6 — no manuscript-prose generation path from Coach surfaces', () => {
  it('coach sources exist', () => {
    expect(coachSourceFiles().length).toBeGreaterThan(0);
  });

  it('coach sources only use the allowed window.api surface', () => {
    for (const file of coachSourceFiles()) {
      const src = fs.readFileSync(file, 'utf-8');
      // Collect every member accessed off `window.api` / the local `api` alias.
      const apiCalls = new Set<string>();
      for (const m of src.matchAll(/\bwindow\.api\??\.(\w+)/g)) apiCalls.add(m[1]);
      for (const m of src.matchAll(/\bapi\??\.(\w+)/g)) apiCalls.add(m[1]);
      for (const call of apiCalls) {
        expect(
          ALLOWED_API_CALLS.has(call),
          `${path.basename(file)} touches window.api.${call} — not in the Coach allowlist. ` +
          'The Writing Coach must never gain a path that writes prose into the manuscript (§14.6).',
        ).toBe(true);
      }
    }
  });

  it('coach sources reference no manuscript-write surface', () => {
    for (const file of coachSourceFiles()) {
      const src = fs.readFileSync(file, 'utf-8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(
          pattern.test(src),
          `${path.basename(file)} matches forbidden pattern ${pattern} — Coach surfaces must not write prose (§14.6).`,
        ).toBe(false);
      }
    }
  });

  it('the send path persists to the session store only (source-level)', () => {
    const src = fs.readFileSync(path.join(COACH_DIR, 'useCoachConversation.ts'), 'utf-8');
    // The conversation's only writes are appendTurns on the session store.
    expect(src).toContain('appendTurns');
    expect(src).not.toMatch(/writeVault|writeManifest|saveScene|updateScene/);
  });
});
