import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import TimelineSpreadsheet, { sortScenes, groupScenes, indexProposals } from './TimelineSpreadsheet';
import type { SpreadsheetScene, SceneGroup } from './TimelineSpreadsheet';
import type { TimelineAIProposal } from './types';

// ─── Fixtures ───

const ARC_A = { id: 'arc-alpha', title: 'Alpha Arc', color: '#7c6af7' };
const ARC_B = { id: 'arc-beta', title: 'Beta Arc', color: '#00f0ff' };
const CHAR_A = { id: 'char-1', name: 'Alice' };
const CHAR_B = { id: 'char-2', name: 'Bob' };

function makeScene(overrides: Partial<SpreadsheetScene> = {}): SpreadsheetScene {
  return {
    id: crypto.randomUUID(),
    title: 'Scene',
    chapterId: 'ch-1',
    date: '',
    pov: '',
    arcIds: [],
    characterIds: [],
    wordCount: null,
    mood: '',
    locationId: '',
    ...overrides,
  };
}

// ─── sortScenes ───

describe('sortScenes', () => {
  it('sorts by date ascending', () => {
    const scenes = [
      makeScene({ date: '1990-06-01' }),
      makeScene({ date: '1985-01-15' }),
      makeScene({ date: '2000-12-31' }),
    ];
    const result = sortScenes(scenes, 'date', 'asc');
    expect(result[0].date).toBe('1985-01-15');
    expect(result[1].date).toBe('1990-06-01');
    expect(result[2].date).toBe('2000-12-31');
  });

  it('sorts by date descending', () => {
    const scenes = [
      makeScene({ date: '1990-06-01' }),
      makeScene({ date: '2000-12-31' }),
    ];
    const result = sortScenes(scenes, 'date', 'desc');
    expect(result[0].date).toBe('2000-12-31');
    expect(result[1].date).toBe('1990-06-01');
  });

  it('sorts by pov ascending', () => {
    const scenes = [
      makeScene({ pov: 'third-limited' }),
      makeScene({ pov: 'first-person' }),
      makeScene({ pov: 'omniscient' }),
    ];
    const result = sortScenes(scenes, 'pov', 'asc');
    expect(result[0].pov).toBe('first-person');
    expect(result[1].pov).toBe('omniscient');
    expect(result[2].pov).toBe('third-limited');
  });

  it('sorts by arc ascending using first arc id', () => {
    const scenes = [
      makeScene({ arcIds: ['arc-beta'] }),
      makeScene({ arcIds: ['arc-alpha'] }),
      makeScene({ arcIds: [] }),
    ];
    const result = sortScenes(scenes, 'arc', 'asc');
    expect(result[0].arcIds[0]).toBeUndefined();
    expect(result[1].arcIds[0]).toBe('arc-alpha');
    expect(result[2].arcIds[0]).toBe('arc-beta');
  });

  it('does not mutate original array', () => {
    const scenes = [makeScene({ date: '2000-01-01' }), makeScene({ date: '1999-01-01' })];
    const original = [...scenes];
    sortScenes(scenes, 'date', 'asc');
    expect(scenes[0].date).toBe(original[0].date);
  });
});

// ─── groupScenes ───

describe('groupScenes', () => {
  it('groups by arc and uses arc titles', () => {
    const scenes = [
      makeScene({ arcIds: ['arc-alpha'] }),
      makeScene({ arcIds: ['arc-beta'] }),
      makeScene({ arcIds: ['arc-alpha'] }),
    ];
    const groups: SceneGroup[] = groupScenes(scenes, 'arc', [ARC_A, ARC_B], []);
    const titles = groups.map(g => g.label);
    expect(titles).toContain('Alpha Arc');
    expect(titles).toContain('Beta Arc');
    const alpha = groups.find(g => g.key === 'arc-alpha')!;
    expect(alpha.scenes).toHaveLength(2);
  });

  it('places multi-arc scene in each matching group', () => {
    const scene = makeScene({ arcIds: ['arc-alpha', 'arc-beta'] });
    const groups = groupScenes([scene], 'arc', [ARC_A, ARC_B], []);
    expect(groups).toHaveLength(2);
    expect(groups[0].scenes[0]).toBe(scene);
    expect(groups[1].scenes[0]).toBe(scene);
  });

  it('creates "No Arc" group for unassigned scenes', () => {
    const scene = makeScene({ arcIds: [] });
    const groups = groupScenes([scene], 'arc', [ARC_A], []);
    const noArc = groups.find(g => g.key === '__unassigned__');
    expect(noArc).toBeDefined();
    expect(noArc!.label).toBe('No Arc');
    expect(noArc!.scenes[0]).toBe(scene);
  });

  it('groups by first character', () => {
    const scene1 = makeScene({ characterIds: ['char-1'] });
    const scene2 = makeScene({ characterIds: ['char-2'] });
    const groups = groupScenes([scene1, scene2], 'character', [], [CHAR_A, CHAR_B]);
    const aliceGroup = groups.find(g => g.key === 'char-1')!;
    const bobGroup = groups.find(g => g.key === 'char-2')!;
    expect(aliceGroup.label).toBe('Alice');
    expect(bobGroup.label).toBe('Bob');
    expect(aliceGroup.scenes[0]).toBe(scene1);
    expect(bobGroup.scenes[0]).toBe(scene2);
  });

  it('creates "No Character" group for unassigned scenes', () => {
    const scene = makeScene({ characterIds: [] });
    const groups = groupScenes([scene], 'character', [], []);
    expect(groups[0].label).toBe('No Character');
    expect(groups[0].key).toBe('__unassigned__');
  });

  it('includes arc color on arc groups', () => {
    const scene = makeScene({ arcIds: ['arc-alpha'] });
    const groups = groupScenes([scene], 'arc', [ARC_A], []);
    expect(groups[0].color).toBe('#7c6af7');
  });

  it('sorts Unassigned group last', () => {
    const scenes = [
      makeScene({ arcIds: [] }),
      makeScene({ arcIds: ['arc-alpha'] }),
    ];
    const groups = groupScenes(scenes, 'arc', [ARC_A], []);
    expect(groups[groups.length - 1].key).toBe('__unassigned__');
  });
});

// ─── Component tests ───

const MOCK_SCENE_ENTRY = {
  id: 'scene-1',
  title: 'The Beginning',
  chapterId: 'ch-1',
  path: 'stories/ch1/scene1.md',
  order: 0,
  blocks: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  chronologicalTime: { date: '1990-06-01', isEstimated: false, confidence: 1, source: 'explicit_marker' },
  entityLinks: { arcs: ['arc-alpha'], characterIds: ['char-1'], locationId: '' },
  timelineMetadata: { pov: 'first-person', mood: 'tense', wordCount: 1200 },
};

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    timelineGetScenes: vi.fn().mockResolvedValue({ scenes: [MOCK_SCENE_ENTRY] }),
    timelineListArcs: vi.fn().mockResolvedValue({ arcs: [ARC_A, ARC_B] }),
    entityList: vi.fn().mockResolvedValue({ entities: [CHAR_A, CHAR_B] }),
    timelineUpdateScene: vi.fn().mockImplementation(async (payload: { sceneId: string }) => ({
      scene: { ...MOCK_SCENE_ENTRY, id: payload.sceneId },
    })),
    // SKY-796: AI proposals — default mocks return empty so legacy tests don't
    // see badges. Suites that exercise proposal UI override these explicitly.
    timelineProposalsList: vi.fn().mockResolvedValue({ proposals: [] }),
    timelineProposalsGenerate: vi.fn().mockResolvedValue({ proposals: [] }),
    timelineProposalResolve: vi.fn().mockResolvedValue({ proposal: null }),
    ...overrides,
  };
}

const STORY = {
  id: 'story-1',
  title: 'My Novel',
  path: 'stories/my-novel',
  chapters: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  (window as unknown as { api: unknown }).api = makeApi();
});

async function renderSheet(story = STORY) {
  const result = render(<TimelineSpreadsheet story={story} />);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  return result;
}

describe('TimelineSpreadsheet — empty states', () => {
  it('shows "Select a story to view its timeline." when story is null', () => {
    render(<TimelineSpreadsheet story={null} />);
    expect(screen.getByText('Select a story to view its timeline.')).toBeInTheDocument();
  });

  it('shows "Create scenes in your story to see them here." when API returns empty list', async () => {
    (window as any).api.timelineGetScenes = vi.fn().mockResolvedValue({ scenes: [] });
    render(<TimelineSpreadsheet story={STORY} />);
    await waitFor(() => expect(screen.getByText('Create scenes in your story to see them here.')).toBeInTheDocument());
  });
});

describe('TimelineSpreadsheet — rendering', () => {
  it('renders the story title in the toolbar', async () => {
    await renderSheet();
    expect(screen.getByText('My Novel')).toBeInTheDocument();
  });

  it('renders a row for the fixture scene', async () => {
    await renderSheet();
    expect(screen.getByTestId('row-scene-1')).toBeInTheDocument();
  });

  it('renders scene title in the title column', async () => {
    await renderSheet();
    expect(screen.getByText('The Beginning')).toBeInTheDocument();
  });

  it('renders date from chronologicalTime', async () => {
    await renderSheet();
    expect(screen.getByTestId('cell-scene-1-date').textContent).toContain('1990-06-01');
  });

  it('renders POV from timelineMetadata', async () => {
    await renderSheet();
    expect(screen.getByTestId('cell-scene-1-pov').textContent).toContain('first-person');
  });

  it('renders arc pill using arc title', async () => {
    await renderSheet();
    expect(screen.getByTestId('cell-scene-1-arc').textContent).toContain('Alpha Arc');
  });

  it('renders word count', async () => {
    await renderSheet();
    expect(screen.getByTestId('cell-scene-1-wordCount').textContent).toContain('1200');
  });
});

describe('TimelineSpreadsheet — inline edit', () => {
  it('shows input on double-click of date cell', async () => {
    await renderSheet();
    fireEvent.dblClick(screen.getByTestId('cell-scene-1-date'));
    expect(screen.getByTestId('cell-edit-scene-1-date')).toBeInTheDocument();
  });

  it('shows input on double-click of pov cell', async () => {
    await renderSheet();
    fireEvent.dblClick(screen.getByTestId('cell-scene-1-pov'));
    expect(screen.getByTestId('cell-edit-scene-1-pov')).toBeInTheDocument();
  });

  it('shows select on double-click of arc cell', async () => {
    await renderSheet();
    fireEvent.dblClick(screen.getByTestId('cell-scene-1-arc'));
    expect(screen.getByTestId('cell-edit-scene-1-arc')).toBeInTheDocument();
  });

  it('calls timelineUpdateScene on Enter key in edit input', async () => {
    await renderSheet();
    fireEvent.dblClick(screen.getByTestId('cell-scene-1-pov'));
    const input = screen.getByTestId('cell-edit-scene-1-pov');
    fireEvent.change(input, { target: { value: 'omniscient' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect((window as any).api.timelineUpdateScene).toHaveBeenCalledWith(
        expect.objectContaining({
          sceneId: 'scene-1',
          timelineMetadata: expect.objectContaining({ pov: 'omniscient' }),
        }),
      );
    });
  });

  it('cancels edit on Escape key', async () => {
    await renderSheet();
    fireEvent.dblClick(screen.getByTestId('cell-scene-1-pov'));
    const input = screen.getByTestId('cell-edit-scene-1-pov');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('cell-edit-scene-1-pov')).not.toBeInTheDocument();
  });
});

describe('TimelineSpreadsheet — selection', () => {
  it('selects a row on checkbox change', async () => {
    await renderSheet();
    const checkbox = screen.getByLabelText('Select scene The Beginning');
    fireEvent.click(checkbox);
    expect(screen.getByTestId('row-scene-1')).toHaveAttribute('aria-selected', 'true');
  });

  it('selects all rows via header checkbox', async () => {
    await renderSheet();
    const allCheck = screen.getByLabelText('Select all scenes');
    fireEvent.click(allCheck);
    expect(screen.getByTestId('row-scene-1')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('TimelineSpreadsheet — groupBy', () => {
  it('shows group rows when grouping by arc', async () => {
    await renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Arc' }));
    await waitFor(() => {
      // Group header row should appear (may share label text with arc pills)
      const groupLabels = document.querySelectorAll('.tls-group-label');
      const labelTexts = Array.from(groupLabels).map(el => el.textContent);
      expect(labelTexts).toContain('Alpha Arc');
    });
  });

  it('resets to no grouping', async () => {
    await renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Arc' }));
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    // Group header row should be gone; scene row still present
    expect(screen.getByTestId('row-scene-1')).toBeInTheDocument();
  });
});

// ─── SKY-796: AI auto-population proposals ───

function proposal(over: Partial<TimelineAIProposal> = {}): TimelineAIProposal {
  return {
    id: 'p-date-1',
    sceneId: 'scene-1',
    kind: 'date',
    value: 'Year 42',
    reason: 'in-world year: “Year 42”',
    confidence: 0.7,
    source: 'ai',
    isEstimated: true,
    status: 'pending',
    createdAt: '2026-06-04T00:00:00.000Z',
    ...over,
  };
}

describe('indexProposals', () => {
  it('routes date proposals to the date column', () => {
    const idx = indexProposals([proposal({ kind: 'date' })]);
    expect(idx.get('scene-1')?.date?.[0].kind).toBe('date');
  });

  it('routes mood proposals to the mood column', () => {
    const idx = indexProposals([proposal({ id: 'p-mood', kind: 'mood', value: 'tense' })]);
    expect(idx.get('scene-1')?.mood?.[0].value).toBe('tense');
  });

  it('routes character proposals to the pov column', () => {
    const idx = indexProposals([proposal({ id: 'p-chars', kind: 'characters', value: 'char-1' })]);
    expect(idx.get('scene-1')?.pov?.[0].kind).toBe('characters');
  });

  it('skips non-pending proposals', () => {
    const idx = indexProposals([proposal({ status: 'accepted' })]);
    expect(idx.size).toBe(0);
  });
});

describe('TimelineSpreadsheet — AI proposals', () => {
  it('renders a date badge when a pending date proposal exists', async () => {
    (window as any).api.timelineProposalsList = vi
      .fn()
      .mockResolvedValue({ proposals: [proposal()] });
    render(<TimelineSpreadsheet story={STORY} />);
    await waitFor(() => expect(screen.getByTestId('proposal-badge-p-date-1')).toBeInTheDocument());
  });

  it('opens the accept/reject popover when the badge is clicked', async () => {
    (window as any).api.timelineProposalsList = vi
      .fn()
      .mockResolvedValue({ proposals: [proposal()] });
    render(<TimelineSpreadsheet story={STORY} />);
    const badge = await screen.findByTestId('proposal-badge-p-date-1');
    fireEvent.click(badge);
    expect(screen.getByTestId('proposal-popover-p-date-1')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-accept-p-date-1')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-reject-p-date-1')).toBeInTheDocument();
  });

  it('calls timelineProposalResolve with accept', async () => {
    const p = proposal();
    (window as any).api.timelineProposalsList = vi.fn().mockResolvedValue({ proposals: [p] });
    (window as any).api.timelineProposalResolve = vi
      .fn()
      .mockResolvedValue({ proposal: { ...p, status: 'accepted' }, scene: undefined });
    render(<TimelineSpreadsheet story={STORY} />);
    fireEvent.click(await screen.findByTestId('proposal-badge-p-date-1'));
    fireEvent.click(screen.getByTestId('proposal-accept-p-date-1'));
    await waitFor(() => {
      expect((window as any).api.timelineProposalResolve).toHaveBeenCalledWith(
        'p-date-1',
        'accept',
      );
    });
  });

  it('calls timelineProposalResolve with reject and removes the badge', async () => {
    const p = proposal({ id: 'p-mood-1', kind: 'mood', value: 'melancholic' });
    (window as any).api.timelineProposalsList = vi.fn().mockResolvedValue({ proposals: [p] });
    (window as any).api.timelineProposalResolve = vi
      .fn()
      .mockResolvedValue({ proposal: { ...p, status: 'rejected' } });
    render(<TimelineSpreadsheet story={STORY} />);
    fireEvent.click(await screen.findByTestId('proposal-badge-p-mood-1'));
    fireEvent.click(screen.getByTestId('proposal-reject-p-mood-1'));
    await waitFor(() => {
      expect((window as any).api.timelineProposalResolve).toHaveBeenCalledWith(
        'p-mood-1',
        'reject',
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId('proposal-badge-p-mood-1')).not.toBeInTheDocument();
    });
  });

  it('regenerates proposals on toolbar button click', async () => {
    (window as any).api.timelineProposalsGenerate = vi
      .fn()
      .mockResolvedValue({ proposals: [proposal({ id: 'p-fresh-1' })] });
    render(<TimelineSpreadsheet story={STORY} />);
    await waitFor(() => expect(screen.getByTestId('ai-suggest-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('ai-suggest-btn'));
    await waitFor(() => {
      expect((window as any).api.timelineProposalsGenerate).toHaveBeenCalledWith('story-1');
    });
    await waitFor(() => expect(screen.getByTestId('proposal-badge-p-fresh-1')).toBeInTheDocument());
  });

  it('shows pending count in the toolbar button label', async () => {
    (window as any).api.timelineProposalsList = vi.fn().mockResolvedValue({
      proposals: [
        proposal({ id: 'a' }),
        proposal({ id: 'b', kind: 'mood', value: 'tense' }),
      ],
    });
    render(<TimelineSpreadsheet story={STORY} />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-suggest-btn').textContent).toContain('(2)');
    });
  });
});
