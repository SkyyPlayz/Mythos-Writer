/**
 * PLAN-058 L7 — red-on-revert pins (AI / Partner).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARTNER_QUICK_COMMANDS } from './partner/partnerQuickCommands';

describe('PLAN-058 L7 pins', () => {
  it('FD-4 hub exposes four quick-command chips (not legacy Writer Scan row)', () => {
    const hub = readFileSync(resolve(__dirname, 'AgentHubPanel.tsx'), 'utf8');
    expect(hub).toContain('PARTNER_QUICK_COMMANDS');
    expect(hub).not.toMatch(/PARTNER_ACTIONS\.map/);
    expect(PARTNER_QUICK_COMMANDS).toHaveLength(4);
  });

  it('09:01 compact partner panel class + collapsed tips default', () => {
    const hub = readFileSync(resolve(__dirname, 'AgentHubPanel.tsx'), 'utf8');
    expect(hub).toContain('ahp-partner--compact');
    expect(hub).toMatch(/showWriterTips.*useState\(false\)/);
    expect(hub).toContain('ahp-open-writer-tips');
    expect(readFileSync(resolve(__dirname, 'AgentHubPanel.css'), 'utf8')).toContain('.ahp-partner--compact');
  });

  it('62:30 continuity scan scene picker in ContinuityPanel', () => {
    const cp = readFileSync(resolve(__dirname, 'ContinuityPanel.tsx'), 'utf8');
    expect(cp).toContain('cp-scan-scene-picker');
    expect(cp).toContain('story?: Story | null');
  });

  it('62:53 editor continuity scan button', () => {
    const msv = readFileSync(resolve(__dirname, 'story/ManuscriptView.tsx'), 'utf8');
    expect(msv).toContain('msv-continuity-scan-btn');
    expect(msv).toContain('onContinuityScan');
  });

  it('63:13 prebuilt composer quick actions wired in hub', () => {
    const hub = readFileSync(resolve(__dirname, 'AgentHubPanel.tsx'), 'utf8');
    expect(hub).toContain('ComposerQuickActions');
    expect(hub).toContain('generateQuickActionChips');
  });

  it('60:50 advanced preset prompt in Writing partner settings', () => {
    const wp = readFileSync(resolve(__dirname, 'partner/WritingPartnerSection.tsx'), 'utf8');
    expect(wp).toContain('wp-quick-command-advanced');
    expect(wp).toContain('wp-prompt-timeline-to-notes');
  });

  it('09:09 teaching mode chrome remains Lane A only (no invented behavior)', () => {
    const coach = readFileSync(resolve(__dirname, 'components/SettingsPanel/sections/WritingCoachSettingsSection.tsx'), 'utf8');
    expect(coach).toContain('Mode behavior coming soon');
    expect(coach).not.toContain('setTeachingMode');
  });
});
