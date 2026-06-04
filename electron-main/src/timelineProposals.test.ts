// SKY-796: timeline AI auto-population — engine + store unit tests.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildProposalsForScene,
  estimateDate,
  detectCharacters,
  estimateMood,
  mergeProposals,
  pendingForScenes,
  readProposalStore,
  writeProposalStore,
  resolveProposalInStore,
  type ProposalEngineInput,
} from './timelineProposals.js';
import type { TimelineAIProposal } from './ipc.js';

const NOW = '2026-06-04T00:00:00.000Z';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-proposals-'));
}

function cleanDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── estimateDate ───

describe('estimateDate', () => {
  it('matches ISO 8601 dates', () => {
    const r = estimateDate('At 2340-06-15, Eira reached the gate.');
    expect(r?.value).toBe('2340-06-15');
    expect(r?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('matches long-form English dates', () => {
    const r = estimateDate('It was June 15, 2340.');
    expect(r?.value).toBe('June 15, 2340');
    expect(r?.reason).toContain('date phrase');
  });

  it('matches in-world year markers like "Year 42"', () => {
    const r = estimateDate('In Year 42 of the Empire, peace fell.');
    expect(r?.value).toContain('Year 42');
    expect(r?.confidence).toBeGreaterThan(0.5);
  });

  it('returns null when no date cue is present', () => {
    expect(estimateDate('Nothing in particular happens.')).toBeNull();
  });
});

// ─── detectCharacters ───

describe('detectCharacters', () => {
  const characters = [
    { id: 'c1', name: 'Eira', aliases: ['the captain'] },
    { id: 'c2', name: 'Renn' },
    { id: 'c3', name: 'Beira' },  // overlaps with "Eira" but should not match
  ];

  it('word-boundary matches the canonical name', () => {
    const r = detectCharacters('Eira gripped her sword.', characters);
    expect(r.find(m => m.id === 'c1')?.count).toBe(1);
    expect(r.find(m => m.id === 'c3')).toBeUndefined();
  });

  it('matches aliases', () => {
    const r = detectCharacters('the captain nodded to the captain.', characters);
    expect(r.find(m => m.id === 'c1')?.count).toBe(2);
    expect(r.find(m => m.id === 'c1')?.matchedAs).toBe('the captain');
  });

  it('orders by hit count (POV signal)', () => {
    const r = detectCharacters('Eira Eira Eira Renn.', characters);
    expect(r[0].id).toBe('c1');
    expect(r[1].id).toBe('c2');
  });

  it('does not match characters that aren’t in prose', () => {
    expect(detectCharacters('Empty scene.', characters)).toEqual([]);
  });
});

// ─── estimateMood ───

describe('estimateMood', () => {
  it('returns tense for tense lexicon hits', () => {
    const r = estimateMood('Her heart pounded. She gripped the knife and whispered.');
    expect(r?.mood).toBe('tense');
  });

  it('returns revelatory when realization cues dominate', () => {
    const r = estimateMood('Then she realized the truth — she had remembered everything.');
    expect(r?.mood).toBe('revelatory');
  });

  it('returns melancholic on grief cues', () => {
    const r = estimateMood('She wept. The hall was empty. He was gone, lost to her.');
    expect(r?.mood).toBe('melancholic');
  });

  it('returns null when no cues match', () => {
    expect(estimateMood('A perfectly neutral sentence.')).toBeNull();
  });

  it('caps confidence at 0.7', () => {
    const r = estimateMood('knife knife knife knife knife knife knife');
    expect(r?.confidence).toBeLessThanOrEqual(0.7);
  });
});

// ─── buildProposalsForScene: end-to-end shape ───

describe('buildProposalsForScene', () => {
  const baseInput: ProposalEngineInput = {
    scene: {
      sceneId: 'scene-1',
      text: 'In Year 42 of the Empire, Eira gripped her blade. Her heart pounded.',
      current: { dateIsUserSet: false, characterIds: [] },
    },
    characters: [{ id: 'c1', name: 'Eira' }],
  };

  it('emits date + characters + mood for a rich scene', () => {
    const ps = buildProposalsForScene(baseInput, NOW);
    const kinds = ps.map(p => p.kind);
    expect(kinds).toContain('date');
    expect(kinds).toContain('characters');
    expect(kinds).toContain('mood');
    for (const p of ps) {
      expect(p.source).toBe('ai');
      expect(p.isEstimated).toBe(true);
      expect(p.status).toBe('pending');
      expect(p.confidence).toBeGreaterThan(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
      expect(p.createdAt).toBe(NOW);
    }
  });

  it('never proposes a date when the user already set one', () => {
    const ps = buildProposalsForScene(
      { ...baseInput, scene: { ...baseInput.scene, current: { dateIsUserSet: true, characterIds: [] } } },
      NOW,
    );
    expect(ps.find(p => p.kind === 'date')).toBeUndefined();
  });

  it('never proposes a mood when the user already set one', () => {
    const ps = buildProposalsForScene(
      { ...baseInput, scene: { ...baseInput.scene, current: { dateIsUserSet: false, characterIds: [], mood: 'noir' } } },
      NOW,
    );
    expect(ps.find(p => p.kind === 'mood')).toBeUndefined();
  });

  it('omits characters already credited', () => {
    const ps = buildProposalsForScene(
      { ...baseInput, scene: { ...baseInput.scene, current: { dateIsUserSet: false, characterIds: ['c1'] } } },
      NOW,
    );
    expect(ps.find(p => p.kind === 'characters')).toBeUndefined();
  });

  it('proposes POV when a clear front-runner emerges', () => {
    const ps = buildProposalsForScene(
      {
        scene: {
          sceneId: 'scene-2',
          text: 'Eira Eira Eira moved through the corridor. Renn followed.',
          current: { dateIsUserSet: true, characterIds: [] },
        },
        characters: [{ id: 'c1', name: 'Eira' }, { id: 'c2', name: 'Renn' }],
      },
      NOW,
    );
    const pov = ps.find(p => p.kind === 'characters' && p.value.startsWith('pov:'));
    expect(pov?.value).toBe('pov:c1');
    expect(pov?.confidence).toBeGreaterThan(0.5);
  });

  it('does not propose POV when the user already set one', () => {
    const ps = buildProposalsForScene(
      {
        scene: {
          sceneId: 'scene-3',
          text: 'Eira Eira Eira moved.',
          current: { dateIsUserSet: true, characterIds: [], pov: 'c-other' },
        },
        characters: [{ id: 'c1', name: 'Eira' }],
      },
      NOW,
    );
    expect(ps.find(p => p.value.startsWith('pov:'))).toBeUndefined();
  });

  it('produces stable ids — same scene + value yields same proposal id', () => {
    const a = buildProposalsForScene(baseInput, NOW);
    const b = buildProposalsForScene(baseInput, '2027-01-01T00:00:00.000Z');
    const aIds = new Set(a.map(p => p.id));
    const bIds = new Set(b.map(p => p.id));
    expect(aIds).toEqual(bIds);
  });
});

// ─── mergeProposals — re-running must respect resolved proposals ───

describe('mergeProposals', () => {
  const base: TimelineAIProposal = {
    id: 'p1',
    sceneId: 's1',
    kind: 'date',
    value: '2340-06-15',
    reason: 'ISO date in prose',
    confidence: 0.85,
    source: 'ai',
    isEstimated: true,
    status: 'pending',
    createdAt: NOW,
  };

  it('keeps a rejected proposal rejected even when the engine re-emits it', () => {
    const rejected: TimelineAIProposal = { ...base, status: 'rejected' };
    const out = mergeProposals([rejected], [base]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('rejected');
  });

  it('keeps an accepted proposal accepted', () => {
    const accepted: TimelineAIProposal = { ...base, status: 'accepted' };
    const out = mergeProposals([accepted], [base]);
    expect(out[0].status).toBe('accepted');
  });

  it('appends genuinely new proposals', () => {
    const fresh: TimelineAIProposal = { ...base, id: 'p2' };
    const out = mergeProposals([base], [fresh]);
    expect(out).toHaveLength(2);
  });
});

// ─── store persistence ───

describe('proposal store round-trip', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { cleanDir(tmpDir); });

  const sample: TimelineAIProposal = {
    id: 'p1',
    sceneId: 's1',
    kind: 'mood',
    value: 'tense',
    reason: '2 tense cues',
    confidence: 0.55,
    source: 'ai',
    isEstimated: true,
    status: 'pending',
    createdAt: NOW,
  };

  it('returns empty store when file absent', () => {
    expect(readProposalStore(tmpDir).proposals).toEqual([]);
  });

  it('round-trips a single proposal', () => {
    writeProposalStore(tmpDir, { proposals: [sample] });
    const back = readProposalStore(tmpDir);
    expect(back.proposals).toHaveLength(1);
    expect(back.proposals[0].value).toBe('tense');
  });

  it('returns empty store when JSON is corrupt', () => {
    fs.writeFileSync(path.join(tmpDir, 'timeline-proposals.json'), '{not json', 'utf-8');
    expect(readProposalStore(tmpDir).proposals).toEqual([]);
  });
});

// ─── pendingForScenes ───

describe('pendingForScenes', () => {
  const base: TimelineAIProposal = {
    id: 'p1',
    sceneId: 's1',
    kind: 'date',
    value: 'X',
    reason: '',
    confidence: 0.6,
    source: 'ai',
    isEstimated: true,
    status: 'pending',
    createdAt: NOW,
  };

  it('drops resolved proposals and unknown scenes', () => {
    const list: TimelineAIProposal[] = [
      base,
      { ...base, id: 'p2', status: 'accepted' },
      { ...base, id: 'p3', sceneId: 'unknown' },
    ];
    const out = pendingForScenes(list, new Set(['s1']));
    expect(out.map(p => p.id)).toEqual(['p1']);
  });
});

// ─── resolveProposalInStore ───

describe('resolveProposalInStore', () => {
  const base: TimelineAIProposal = {
    id: 'p1',
    sceneId: 's1',
    kind: 'date',
    value: 'X',
    reason: '',
    confidence: 0.6,
    source: 'ai',
    isEstimated: true,
    status: 'pending',
    createdAt: NOW,
  };

  it('transitions status and stamps resolvedAt', () => {
    const store = { proposals: [base] };
    const updated = resolveProposalInStore(store, 'p1', 'rejected', '2026-06-04T01:00:00.000Z');
    expect(updated?.status).toBe('rejected');
    expect(updated?.resolvedAt).toBe('2026-06-04T01:00:00.000Z');
    expect(store.proposals[0].status).toBe('rejected');
  });

  it('returns null for unknown ids', () => {
    expect(resolveProposalInStore({ proposals: [base] }, 'nope', 'accepted', NOW)).toBeNull();
  });
});
