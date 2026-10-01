/**
 * KEYS-B test riders: pin keyReentryPaths props through the real panel wiring.
 * Each prop dropped alone must fail (source pins).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return fs.readFileSync(path.join(here, rel), 'utf-8');
}

describe('KEYS-B — keyReentryPaths prop pins through real panel', () => {
  it('SettingsPanel → ProviderSection receives settings.keyReentryPaths', () => {
    const src = read('SettingsPanel.tsx');
    // ProviderSection block must pass the prop from settings.
    expect(src).toMatch(/<ProviderSection[\s\S]*?keyReentryPaths=\{settings\.keyReentryPaths\}/);
  });

  it('SettingsPanel → ApiKeySection receives settings.keyReentryPaths', () => {
    const src = read('SettingsPanel.tsx');
    expect(src).toMatch(/<ApiKeySection[\s\S]*?keyReentryPaths=\{settings\.keyReentryPaths\}/);
  });

  it('keyIsConfigured excludes apiKey when flagged in keyReentryPaths', () => {
    const src = read('SettingsPanel.tsx');
    expect(src).toMatch(
      /keyIsConfigured\s*=\s*Boolean\(settings\.apiKey\)\s*&&\s*!\(settings\.keyReentryPaths\s*\?\?\s*\[\]\)\.includes\('apiKey'\)/,
    );
  });

  it('AgentsSection → writingAssistant AgentProviderSection gets keyReentryPaths', () => {
    const src = read('components/SettingsPanel/sections/AgentsSection.tsx');
    // writingAssistant block (first AgentProviderSection) passes the prop.
    expect(src).toMatch(
      /writingAssistant[\s\S]*?<AgentProviderSection[\s\S]*?keyReentryPaths=\{settings\.keyReentryPaths\}/,
    );
  });

  it('AgentsSection → brainstorm AgentProviderSection gets keyReentryPaths', () => {
    const src = read('components/SettingsPanel/sections/AgentsSection.tsx');
    expect(src).toMatch(
      /brainstorm[\s\S]*?<AgentProviderSection[\s\S]*?keyReentryPaths=\{settings\.keyReentryPaths\}/,
    );
  });
});
