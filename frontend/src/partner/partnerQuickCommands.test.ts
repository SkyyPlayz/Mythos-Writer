import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  PARTNER_QUICK_COMMANDS,
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

describe('runPartnerQuickCommand continuity', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      api: {
        settingsGet: vi.fn().mockResolvedValue({
          provider: { kind: 'anthropic', model: 'm', apiKey: 'k' },
          agents: {
            archive: { enabled: true, model: 'm' },
            betaReader: { enabled: true, model: 'm' },
            writingAssistant: { enabled: true, model: 'm' },
            brainstorm: { enabled: true, model: 'm' },
          },
        }),
        archiveScanContinuity: vi.fn().mockResolvedValue({ ok: true }),
        jobs: { enqueue: vi.fn().mockResolvedValue({ ok: true }) },
      },
    });
  });

  it('starts continuity scan for the active scene', async () => {
    const scene = story.chapters[0].scenes[0] as Scene;
    const out = await runPartnerQuickCommand('continuity', { scene, story: null });
    expect(out.kind).toBe('card');
    expect(window.api.archiveScanContinuity).toHaveBeenCalled();
  });
});
