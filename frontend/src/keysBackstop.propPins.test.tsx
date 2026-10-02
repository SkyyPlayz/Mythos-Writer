/**
 * KEYS-B test riders: pin keyReentryPaths props through the real panel wiring.
 * Each prop dropped alone must fail (source pins). Anchored per element so a
 * later keyReentryPaths= elsewhere cannot keep a mutant green (Critic T8).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return fs.readFileSync(path.join(here, rel), 'utf-8');
}

/** First self-closing JSX tag starting at `tag` — stops at its own `/>`. */
function firstSelfClosingTag(src: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?/>`);
  const m = src.match(re);
  expect(m, `${tag} self-closing tag`).toBeTruthy();
  return m![0]!;
}

describe('KEYS-B — keyReentryPaths prop pins through real panel', () => {
  it('SettingsPanel → ProviderSection receives settings.keyReentryPaths', () => {
    const tag = firstSelfClosingTag(read('SettingsPanel.tsx'), 'ProviderSection');
    expect(tag).toMatch(/keyReentryPaths=\{settings\.keyReentryPaths\}/);
  });

  it('SettingsPanel → ApiKeySection receives settings.keyReentryPaths', () => {
    const tag = firstSelfClosingTag(read('SettingsPanel.tsx'), 'ApiKeySection');
    expect(tag).toMatch(/keyReentryPaths=\{settings\.keyReentryPaths\}/);
  });

  it('keyIsConfigured excludes apiKey when flagged in keyReentryPaths', () => {
    const src = read('SettingsPanel.tsx');
    expect(src).toMatch(
      /keyIsConfigured\s*=\s*Boolean\(settings\.apiKey\)\s*&&\s*!\(settings\.keyReentryPaths\s*\?\?\s*\[\]\)\.includes\('apiKey'\)/,
    );
  });

  it('AgentsSection → writingAssistant AgentProviderSection gets keyReentryPaths', () => {
    const src = read('components/SettingsPanel/sections/AgentsSection.tsx');
    // Anchor on writingAssistant onTest so a brainstorm-only prop cannot satisfy this pin.
    expect(src).toMatch(
      /onTest=\{\(\)\s*=>\s*onAgentTest\('writingAssistant'\)\}\s*\n\s*keyReentryPaths=\{settings\.keyReentryPaths\}/,
    );
  });

  it('AgentsSection → brainstorm AgentProviderSection gets keyReentryPaths', () => {
    const src = read('components/SettingsPanel/sections/AgentsSection.tsx');
    expect(src).toMatch(
      /onTest=\{\(\)\s*=>\s*onAgentTest\('brainstorm'\)\}\s*\n\s*keyReentryPaths=\{settings\.keyReentryPaths\}/,
    );
  });
});
