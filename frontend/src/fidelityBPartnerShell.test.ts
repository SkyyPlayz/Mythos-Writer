/**
 * Slice B — ship-set regression locks (unified partner shell).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return fs.readFileSync(path.join(here, rel), 'utf8');
}

describe('B — four-agent hub gone', () => {
  it('AgentHubPanel has no AGENTS card / agent rows', () => {
    const src = read('AgentHubPanel.tsx');
    expect(src).not.toMatch(/aria-label="Agents"/);
    expect(src).not.toMatch(/ahp-agent-row-/);
    expect(src).toMatch(/data-partner-shell/);
    expect(src).toMatch(/PartnerCallChrome/);
    expect(src).toMatch(/QuestionsForYou/);
  });
});

describe('B — story strip Editor · Book · Structure', () => {
  it('Coach tab removed from StorySubViewBar', () => {
    const src = read('StorySubViewBar.tsx');
    expect(src).not.toMatch(/label: 'Coach'/);
    expect(src).toMatch(/label: 'Editor'/);
    expect(src).toMatch(/label: 'Book'/);
    expect(src).toMatch(/label: 'Structure'/);
  });
});

describe('B — Quick Entry stays absent (A2 regress)', () => {
  it('EntriesQuickAdd still gone', () => {
    expect(fs.existsSync(path.join(here, 'EntriesQuickAdd.tsx'))).toBe(false);
    const bs = read('BrainstormPage.tsx');
    expect(bs).not.toMatch(/EntriesQuickAdd/);
    expect(bs).not.toMatch(/Quick Entry/);
  });
});

describe('B — default Full Book zoom', () => {
  it('DesktopShell cold-loads viewDepth book', () => {
    const src = read('DesktopShell.tsx');
    expect(src).toMatch(/useState<ZoomLevel>\('book'\)/);
  });
});

describe('B — Partner rail Agent Chat | Idea Board', () => {
  it('BrainstormPage keeps mode labels and uses partner name', () => {
    const src = read('BrainstormPage.tsx');
    expect(src).toMatch(/Agent Chat/);
    expect(src).toMatch(/Idea Board/);
    expect(src).toMatch(/resolvePartnerDisplayName/);
    expect(src).not.toMatch(/Brainstorm Agent/);
  });
});

describe('B — soft-FAIL keep: no Demo / Welcome wizard-replay / rail M', () => {
  it('TourModal / Demo toggle stay absent', () => {
    expect(fs.existsSync(path.join(here, 'TourModal.tsx'))).toBe(false);
    const chrome = read('components/ui/WindowChrome.tsx');
    expect(chrome).not.toMatch(/Demo on/);
  });
});
