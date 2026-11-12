/**
 * PLAN-058 Lane A — Writing Coach switch pins (A-1…A-5).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SETTINGS_CATEGORIES } from './settingsCategories';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(here, rel), 'utf8');

describe('PLAN-058 Lane A — Writing Coach settings', () => {
  it('A-1: coach switch mounts on Writing partner above personality (teaching modes)', () => {
    const partner = read('partner/WritingPartnerSection.tsx');
    const coachIdx = partner.indexOf('<WritingCoachSettingsSection');
    const personalityIdx = partner.indexOf('section-personality');
    expect(coachIdx).toBeGreaterThan(-1);
    expect(personalityIdx).toBeGreaterThan(coachIdx);
    const coach = read('components/SettingsPanel/sections/WritingCoachSettingsSection.tsx');
    expect(coach).toMatch(/agents\.writingAssistant\.enabled/);
    expect(coach).toMatch(/aria-label="Enable Writing Coach"/);
  });

  it('A-2: Teacher + Assistant modes are a native radio pick behind the Coaching opt-in', () => {
    const coach = read('components/SettingsPanel/sections/WritingCoachSettingsSection.tsx');
    expect(coach).toMatch(/Coaching mode/);
    expect(coach).toMatch(/Teacher/);
    expect(coach).toMatch(/Assistant/);
    expect(coach).not.toMatch(/writingAssistantScan|agentWritingAssistant|writingScan/);
    expect(coach).toMatch(/waEnabled:\s*enabled/);
    expect(coach).not.toMatch(/useState/);
    expect(coach).not.toMatch(/aria-pressed/);
    expect(coach).not.toMatch(/<button/);
    // PLAN-COACHING-OPT-IN cut check — the inert chrome cannot come back.
    expect(coach).not.toMatch(/Mode behavior coming soon/);
    expect(coach).not.toMatch(/TEACHING_MODE_LABELS/);
    expect(coach).toMatch(/type="radio"/);
    expect(coach).toMatch(/<fieldset/);
    expect(coach).toMatch(/aria-label="Enable coaching"/);
    // Mode applies only while Coaching is on.
    expect(coach).toMatch(/disabled=\{!coaching\.optIn\}/);
  });

  it('A-3: disabled panel copy points at Writing partner settings', () => {
    const panel = read('WritingAssistantPanel.tsx');
    expect(panel).toMatch(/Settings → Writing partner/);
    expect(panel).not.toMatch(/Enable it in Settings\./);
  });

  it('A-4: AI_DISABLED_MESSAGE references Model & keys', () => {
    const provider = fs.readFileSync(
      path.join(here, '../../electron-main/src/provider.ts'),
      'utf8',
    );
    expect(provider).toMatch(/Settings → Model & keys/);
    expect(provider).not.toMatch(/Settings → AI Agents/);
  });

  it('A-5: section registered on Writing partner only', () => {
    const wp = SETTINGS_CATEGORIES.find((c) => c.id === 'writingPartner');
    expect(wp?.sectionIds).toContain('section-writing-coach');
    const coachIdx = wp!.sectionIds.indexOf('section-writing-coach');
    const personalityIdx = wp!.sectionIds.indexOf('section-personality');
    expect(coachIdx).toBeGreaterThan(-1);
    expect(personalityIdx).toBeGreaterThan(coachIdx);
    expect(read('SettingsPanel.tsx')).not.toMatch(/<AgentsSection/);
  });
});
