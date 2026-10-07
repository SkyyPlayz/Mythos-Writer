import { describe, expect, it, vi } from 'vitest';
import {
  PARTNER_QUICK_COMMANDS,
  archiveContinuityEnabledFromSettings,
  resolveQuickCommandPrompt,
  runPartnerQuickCommand,
} from './partnerQuickCommands';
import type { Scene, Story } from '../types';

const story: Story = {
  id: 'st1',
  title: 'Story',
  path: 'Manuscript/Story',
  chapters: [{
    id: 'ch1',
    title: 'Ch1',
    order: 0,
    path: 'ch1',
    createdAt: '',
    updatedAt: '',
    scenes: [{
      id: 'sc1',
      title: 'Scene',
      order: 0,
      blocks: [{ id: 'b1', type: 'prose', content: 'Prose here.', order: 0 }],
      path: 'sc.md',
    } as Scene],
  }],
  createdAt: '',
  updatedAt: '',
};

describe('PARTNER_QUICK_COMMANDS (FD-4)', () => {
  it('ships the four v2.6 quick-command labels', () => {
    expect(PARTNER_QUICK_COMMANDS.map((c) => c.label)).toEqual([
      'Beta read',
      'Continuity',
      'Notes→timeline',
      'Timeline→notes',
    ]);
  });
});

describe('resolveQuickCommandPrompt', () => {
  it('uses advanced override when set (60:50)', () => {
    const custom = 'Custom structure prompt';
    expect(resolveQuickCommandPrompt('timeline-to-notes', { 'timeline-to-notes': custom })).toBe(custom);
  });
});

function stubWindowApi(opts?: {
  settingsGet?: ReturnType<typeof vi.fn>;
  archiveScanContinuity?: ReturnType<typeof vi.fn>;
  enqueue?: ReturnType<typeof vi.fn>;
}) {
  const settingsGet = opts?.settingsGet ?? vi.fn().mockResolvedValue({
    archiveContinuityEnabled: true,
    agents: { archive: { enabled: true } },
  });
  const archiveScanContinuity = opts?.archiveScanContinuity
    ?? vi.fn().mockResolvedValue([]);
  const enqueue = opts?.enqueue ?? vi.fn().mockResolvedValue({});
  vi.stubGlobal('window', {
    api: {
      settingsGet,
      archiveScanContinuity,
      jobs: { enqueue },
    },
  });
  return { settingsGet, archiveScanContinuity, enqueue };
}

describe('archiveContinuityEnabledFromSettings', () => {
  it('matches ContinuityPanel gate', () => {
    expect(archiveContinuityEnabledFromSettings({ archiveContinuityEnabled: true, agents: { archive: { enabled: true } } })).toBe(true);
    expect(archiveContinuityEnabledFromSettings({ archiveContinuityEnabled: false, agents: { archive: { enabled: true } } })).toBe(false);
    expect(archiveContinuityEnabledFromSettings({ archiveContinuityEnabled: true, agents: { archive: { enabled: false } } })).toBe(false);
  });
});

describe('runPartnerQuickCommand continuity', () => {
  const scene = story.chapters[0].scenes[0] as Scene;

  it('starts continuity scan when archive continuity is enabled', async () => {
    const { archiveScanContinuity, enqueue } = stubWindowApi({});
    const out = await runPartnerQuickCommand('continuity', { scene, story: null });
    expect(out.kind).toBe('card');
    expect(out.text).toContain('started');
    expect(archiveScanContinuity).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalled();
  });

  it('does not claim success when archive agent is disabled (M1)', async () => {
    const { archiveScanContinuity } = stubWindowApi({
      settingsGet: vi.fn().mockResolvedValue({
        archiveContinuityEnabled: true,
        agents: { archive: { enabled: false } },
      }),
    });
    const out = await runPartnerQuickCommand('continuity', { scene, story: null });
    expect(out.kind).toBe('card');
    expect(out.text).not.toMatch(/started/i);
    expect(out.text).toContain('Archive Agent is disabled');
    expect(archiveScanContinuity).not.toHaveBeenCalled();
  });

  it('does not claim success when continuity feature toggle is off', async () => {
    stubWindowApi({
      settingsGet: vi.fn().mockResolvedValue({
        archiveContinuityEnabled: false,
        agents: { archive: { enabled: true } },
      }),
    });
    const out = await runPartnerQuickCommand('continuity', { scene, story: null });
    expect(out.text).not.toMatch(/started/i);
    expect(out.text).toContain('Continuity checking is turned off');
  });

  it('surfaces enqueue errors instead of success (M2)', async () => {
    stubWindowApi({
      enqueue: vi.fn().mockResolvedValue({ error: 'queue full' }),
    });
    const out = await runPartnerQuickCommand('continuity', { scene, story: null });
    expect(out.text).not.toMatch(/started/i);
    expect(out.text).toContain('queue full');
  });
});
