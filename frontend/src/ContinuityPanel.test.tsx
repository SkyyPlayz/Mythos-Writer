import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ContinuityPanel from './ContinuityPanel';
import type { InconsistencyItem } from './InconsistencyCard';
import { setAiEnabled, __resetAiEnabledForTests } from './hooks/useAiEnabled';
import type { Scene } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Callback = (...args: any[]) => void;

let onStartCb: (() => void) | null = null;
let onResultCb: ((data: { items: InconsistencyItem[]; tokenUsed: number; partial?: boolean }) => void) | null = null;
let onErrorCb: ((data: { error: string }) => void) | null = null;

const mockArchiveListContinuity = vi.fn();
const mockArchiveScanContinuity = vi.fn();
const mockArchiveResolveContinuity = vi.fn();
const mockOnArchiveContScanStart = vi.fn((cb: Callback) => { onStartCb = cb; return vi.fn(); });
const mockOnArchiveContScanResult = vi.fn((cb: Callback) => { onResultCb = cb; return vi.fn(); });
const mockOnArchiveContScanError = vi.fn((cb: Callback) => { onErrorCb = cb; return vi.fn(); });
const mockSettingsGet = vi.fn();
const mockSettingsSet = vi.fn();


async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderContinuity(ui: ReactElement) {
  const result = render(ui);
  await flushAsyncEffects();
  return result;
}

function setApi(overrides: Record<string, unknown> = {}) {
  (window as unknown as { api: unknown }).api = {
    archiveListContinuity: mockArchiveListContinuity,
    archiveScanContinuity: mockArchiveScanContinuity,
    archiveResolveContinuity: mockArchiveResolveContinuity,
    onArchiveContScanStart: mockOnArchiveContScanStart,
    onArchiveContScanResult: mockOnArchiveContScanResult,
    onArchiveContScanError: mockOnArchiveContScanError,
    settingsGet: mockSettingsGet,
    settingsSet: mockSettingsSet,
    ...overrides,
  };
}

function makeItem(overrides: Partial<InconsistencyItem> = {}): InconsistencyItem {
  return {
    id: 'inc-1',
    scope: 'story_vault',
    category: 'character_attribute_drift',
    severity: 'high',
    manuscriptAnchor: { sceneId: 'sc-1', offset: 0, excerpt: 'Her eyes were green' },
    vaultAnchor: { notePath: 'characters/Aria.md', line: 12, excerpt: 'eyes: blue' },
    rationale: 'Manuscript says green but vault says blue.',
    proposedResolution: {
      matchArchiveToStory: 'Update vault to say eyes: green',
      suggestStoryChange: 'Change "green" to "blue"',
    },
    status: 'open',
    resolvedAt: null,
    resolvedAction: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const mockScene: Scene = {
  id: 'sc-1',
  title: 'Scene One',
  path: 'scenes/sc-1.md',
  order: 0,
  blocks: [{ id: 'b1', type: 'prose', order: 0, content: 'Her eyes were green.', updatedAt: '' }],
  createdAt: '',
  updatedAt: '',
};

beforeEach(() => {
  vi.resetAllMocks();
  __resetAiEnabledForTests();
  onStartCb = null;
  onResultCb = null;
  onErrorCb = null;
  mockArchiveListContinuity.mockResolvedValue({ items: [] });
  mockArchiveScanContinuity.mockResolvedValue({});
  mockArchiveResolveContinuity.mockResolvedValue({});
  mockSettingsGet.mockResolvedValue({});
  mockSettingsSet.mockResolvedValue({});
  setApi();
});

describe('ContinuityPanel — disabled state', () => {
  it('shows disabled message when enabled=false', async () => {
    await renderContinuity(<ContinuityPanel scene={mockScene} enabled={false} />);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/archive agent is disabled/i),
    );
  });

  // SKY-9022/M6 (GAP-6): `enabled` is a conjunction of the Archive Agent
  // toggle and the "Enable continuity checking" feature toggle — the message
  // must name whichever flag is actually off.
  it('names the agent when disabledReason="agent"', async () => {
    await renderContinuity(<ContinuityPanel scene={mockScene} enabled={false} disabledReason="agent" />);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Archive Agent is disabled. Enable it in Settings.'),
    );
  });

  it('names the feature when disabledReason="feature" (agent on, continuity checking off)', async () => {
    await renderContinuity(<ContinuityPanel scene={mockScene} enabled={false} disabledReason="feature" />);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Continuity checking is turned off. Enable it in Settings.'),
    );
    expect(screen.queryByText(/archive agent is disabled/i)).not.toBeInTheDocument();
  });
});

describe('ContinuityPanel — loading state', () => {
  it('shows loading spinner while archiveListContinuity is pending', async () => {
    let resolve: (v: unknown) => void;
    mockArchiveListContinuity.mockReturnValue(new Promise((r) => { resolve = r; }));
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => expect(screen.getByLabelText(/loading continuity issues/i)).toBeInTheDocument());
    await act(async () => {
      resolve!({ items: [] });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /scan now/i })).toBeInTheDocument());
  });
});

describe('ContinuityPanel — not_scanned state', () => {
  it('shows "Scan now" button when no items are loaded', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /scan now/i })).toBeInTheDocument(),
    );
  });

  it('passes sceneId to archiveListContinuity (AC-A-09)', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => expect(mockArchiveListContinuity).toHaveBeenCalled());
    expect(mockArchiveListContinuity).toHaveBeenCalledWith({ sceneId: 'sc-1' });
  });

  it('passes sceneId=undefined when scene is null', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={null} />);
    await waitFor(() => expect(mockArchiveListContinuity).toHaveBeenCalled());
    expect(mockArchiveListContinuity).toHaveBeenCalledWith({ sceneId: undefined });
  });

  it('Scan now button is disabled when scene is null', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={null} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /scan now/i })).toBeDisabled(),
    );
  });
});

describe('ContinuityPanel — scanning state', () => {
  it('shows scanning banner when scan start event fires', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => screen.getByRole('button', { name: /scan now/i }));

    act(() => { onStartCb?.(); });
    // The visible banner and sr-only status region both contain "scanning" —
    // check the visible cp-scanning-banner element exists
    expect(document.querySelector('.cp-scanning-banner')).not.toBeNull();
  });
});

describe('ContinuityPanel — empty state', () => {
  it('shows "All consistent" after scan result with zero open items', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => screen.getByRole('button', { name: /scan now/i }));

    act(() => {
      onResultCb?.({ items: [], tokenUsed: 420, partial: false });
    });

    expect(screen.getByText(/all consistent/i)).toBeInTheDocument();
  });
});

describe('ContinuityPanel — partial state', () => {
  it('shows partial warning banner when partial=true', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => screen.getByRole('button', { name: /scan now/i }));

    act(() => {
      onResultCb?.({ items: [makeItem()], tokenUsed: 9999, partial: true });
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/token budget/i);
  });
});

describe('ContinuityPanel — error_llm state', () => {
  it('shows provider error banner on LLM error', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => screen.getByRole('button', { name: /scan now/i }));

    act(() => { onErrorCb?.({ error: 'rate limit exceeded by provider' }); });

    expect(screen.getByRole('alert')).toHaveTextContent(/provider settings/i);
  });
});

describe('ContinuityPanel — error_vault state', () => {
  it('shows vault error banner on vault read error', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => screen.getByRole('button', { name: /scan now/i }));

    act(() => { onErrorCb?.({ error: 'could not read vault file' }); });

    expect(screen.getByRole('alert')).toHaveTextContent(/could not read vault/i);
  });
});

describe('ContinuityPanel — open_issues state', () => {
  it('shows items list when items loaded from archiveListContinuity', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [makeItem()] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    // Use rationale text which is NOT wrapped in curly-quote entities
    await waitFor(() =>
      expect(screen.getByText(/Manuscript says green but vault says blue/i)).toBeInTheDocument(),
    );
  });

  it('renders role="list" for the issues container', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [makeItem()] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => screen.getByText(/Manuscript says green but vault says blue/i));
    const lists = screen.getAllByRole('list');
    expect(lists.length).toBeGreaterThan(0);
  });
});

describe('ContinuityPanel — grouped list rendering', () => {
  it('groups items into Critical / High / Low / Ignored sections', async () => {
    const items = [
      makeItem({ id: 'c1', severity: 'critical' }),
      makeItem({ id: 'h1', severity: 'high' }),
      makeItem({ id: 'l1', severity: 'low' }),
      makeItem({ id: 'i1', severity: 'low', status: 'ignored' }),
    ];
    mockArchiveListContinuity.mockResolvedValue({ items });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);

    await waitFor(() => screen.getByRole('region', { name: /critical issues/i }));
    expect(screen.getByRole('region', { name: /high issues/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /low issues/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /ignored issues/i })).toBeInTheDocument();
  });

  it('collapses Low group by default when critical items exist', async () => {
    const items = [
      makeItem({ id: 'c1', severity: 'critical' }),
      makeItem({ id: 'l1', severity: 'low' }),
    ];
    mockArchiveListContinuity.mockResolvedValue({ items });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);

    await waitFor(() => screen.getByRole('region', { name: /low issues/i }));
    // Button accessible name: "Low 1 issue" (third span has aria-label="1 issue")
    const lowHeader = screen.getByRole('button', { name: /low.*1 issue/i });
    expect(lowHeader).toHaveAttribute('aria-expanded', 'false');
  });

  it('expanding a group header shows its items', async () => {
    const items = [
      makeItem({ id: 'c1', severity: 'critical' }),
      makeItem({ id: 'l1', severity: 'low' }),
    ];
    mockArchiveListContinuity.mockResolvedValue({ items });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);

    await waitFor(() => screen.getByRole('button', { name: /low.*1 issue/i }));
    fireEvent.click(screen.getByRole('button', { name: /low.*1 issue/i }));
    expect(screen.getByRole('button', { name: /low.*1 issue/i })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('ContinuityPanel — aria-live always in DOM', () => {
  it('aria-live region is present even in the not_scanned state', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => screen.getByRole('button', { name: /scan now/i }));
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
  });

  it('aria-live region is present during loading state', async () => {
    let resolve: (v: unknown) => void;
    mockArchiveListContinuity.mockReturnValue(new Promise((r) => { resolve = r; }));
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    await act(async () => {
      resolve!({ items: [] });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /scan now/i })).toBeInTheDocument());
  });
});

describe('ContinuityPanel — onCountChange callback', () => {
  it('calls onCountChange with open item count after items load', async () => {
    const items = [
      makeItem({ id: 'o1', status: 'open' }),
      makeItem({ id: 'o2', status: 'open' }),
    ];
    mockArchiveListContinuity.mockResolvedValue({ items });
    const onCountChange = vi.fn();
    await renderContinuity(<ContinuityPanel scene={mockScene} onCountChange={onCountChange} />);
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(2));
  });

  it('calls onCountChange with 0 when no open items', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    const onCountChange = vi.fn();
    await renderContinuity(<ContinuityPanel scene={mockScene} onCountChange={onCountChange} />);
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(0));
  });
});

describe('ContinuityPanel — Scan now triggers IPC', () => {
  it('clicking Scan now calls archiveScanContinuity with scene id and prose', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [] });
    await renderContinuity(<ContinuityPanel scene={mockScene} archiveScanScope="active_scene" />);
    await waitFor(() => screen.getByRole('button', { name: /scan now/i }));
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }));
    expect(mockArchiveScanContinuity).toHaveBeenCalledWith(
      'sc-1',
      expect.stringContaining('Her eyes were green'),
      'active_scene',
    );
  });
});

// SKY-6978 (Beta4/M18): Notes right-panel "CONTINUITY FLAGS" header variant.
describe('ContinuityPanel — flagsHeader (Notes right panel)', () => {
  it('shows the default "Continuity" header when flagsHeader is not set', async () => {
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    expect(screen.getByText('Continuity')).toBeInTheDocument();
    expect(screen.queryByText('CONTINUITY FLAGS')).not.toBeInTheDocument();
  });

  it('shows the "CONTINUITY FLAGS" label and ARCHIVE AGENT badge when flagsHeader is set', async () => {
    await renderContinuity(<ContinuityPanel scene={mockScene} flagsHeader />);
    expect(screen.getByText('CONTINUITY FLAGS')).toBeInTheDocument();
    expect(screen.getByText('ARCHIVE AGENT')).toBeInTheDocument();
    expect(screen.queryByText('Continuity')).not.toBeInTheDocument();
  });

  it('shows the flags header even in the disabled state', async () => {
    await renderContinuity(<ContinuityPanel scene={mockScene} enabled={false} flagsHeader />);
    expect(screen.getByText('CONTINUITY FLAGS')).toBeInTheDocument();
    expect(screen.getByText('ARCHIVE AGENT')).toBeInTheDocument();
  });
});

describe('ContinuityPanel — M11 master AI gate (SKY-9825)', () => {
  it('renders nothing at all when the master AI toggle is off', async () => {
    mockSettingsGet.mockResolvedValue({ ai: { enabled: false } });
    mockArchiveListContinuity.mockResolvedValue({ items: [makeItem()] });
    setAiEnabled(false);
    const { container } = await renderContinuity(
      <ContinuityPanel scene={mockScene} flagsHeader />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('flags return when the master toggle comes back on', async () => {
    mockSettingsGet.mockResolvedValue({ ai: { enabled: false } });
    mockArchiveListContinuity.mockResolvedValue({ items: [makeItem()] });
    setAiEnabled(false);
    const { container } = await renderContinuity(<ContinuityPanel scene={mockScene} />);
    expect(container).toBeEmptyDOMElement();
    act(() => setAiEnabled(true));
    await flushAsyncEffects();
    await waitFor(() =>
      expect(screen.getByText(/Manuscript says green but vault says blue/i)).toBeInTheDocument(),
    );
  });
});

describe('ContinuityPanel — scope tags (M9d)', () => {
  it('renders the prototype scope label for each flag scope', async () => {
    mockArchiveListContinuity.mockResolvedValue({
      items: [
        makeItem({ id: 'f-1', scope: 'story_vault' }),
        makeItem({ id: 'f-2', scope: 'vault_internal' }),
        makeItem({ id: 'f-3', scope: 'timeline' }),
      ],
    });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => expect(screen.getAllByTestId('ic-scope-tag')).toHaveLength(3));
    const labels = screen.getAllByTestId('ic-scope-tag').map((el) => el.textContent);
    expect(labels).toEqual(['Story ↔ Vault', 'Vault internal', 'Timeline']);
  });
});

describe('ContinuityPanel — failed action keeps the flag open (M9d)', () => {
  it('reverts the optimistic resolve and shows why when the action could not run', async () => {
    mockArchiveListContinuity.mockResolvedValue({ items: [makeItem()] });
    mockArchiveResolveContinuity.mockResolvedValue({ ok: false, reason: 'excerpt_not_found' });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    await waitFor(() => screen.getByText(/Manuscript says green but vault says blue/i));

    fireEvent.click(screen.getByRole('button', { name: /^Ignore —/ }));
    await flushAsyncEffects();

    expect(screen.getByTestId('cp-action-error')).toHaveTextContent(/flagged text has changed/i);
    // The card is still there — the flag was not resolved.
    expect(screen.getByText(/Manuscript says green but vault says blue/i)).toBeInTheDocument();
  });
});

// M12.3 (SKY-10770): scan-scope picker + scoped background scan + global
// contradiction section.
describe('ContinuityPanel — M12.3 scan scope picker', () => {
  function jobsMock() {
    return {
      enqueue: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
      list: vi.fn().mockResolvedValue({ jobs: [] }),
      progress: vi.fn().mockResolvedValue({}),
      cancel: vi.fn().mockResolvedValue({ cancelled: false }),
      onEvent: vi.fn(() => vi.fn()),
    };
  }

  it('renders the scope picker attached to the scan trigger, defaulting to Scene', async () => {
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    const picker = await screen.findByRole('combobox', { name: /scan scope/i });
    expect(picker).toHaveTextContent('Scene');
  });

  it('initializes from the legacy full_manuscript setting as Book', async () => {
    await renderContinuity(
      <ContinuityPanel scene={mockScene} archiveScanScope="full_manuscript" />,
    );
    expect(await screen.findByRole('combobox', { name: /scan scope/i })).toHaveTextContent('Book');
  });

  it('scanning with a picked scope enqueues a scoped manuscript-scan and widens the LLM scan', async () => {
    const jobs = jobsMock();
    setApi({ jobs, archiveListGlobalContradictions: vi.fn().mockResolvedValue({ items: [] }) });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);

    fireEvent.click(await screen.findByRole('combobox', { name: /scan scope/i }));
    fireEvent.click(await screen.findByTestId('select-option-chapter'));
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }));

    expect(jobs.enqueue).toHaveBeenCalledWith('manuscript-scan', {
      scope: { level: 'chapter', sceneId: 'sc-1' },
    });
    expect(mockArchiveScanContinuity).toHaveBeenCalledWith(
      'sc-1',
      expect.stringContaining('Her eyes were green'),
      'active_chapter',
    );
  });

  it('default Scene scope enqueues a scene-level scoped scan', async () => {
    const jobs = jobsMock();
    setApi({ jobs, archiveListGlobalContradictions: vi.fn().mockResolvedValue({ items: [] }) });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    fireEvent.click(await screen.findByRole('button', { name: /scan now/i }));
    expect(jobs.enqueue).toHaveBeenCalledWith('manuscript-scan', {
      scope: { level: 'scene', sceneId: 'sc-1' },
    });
  });

  it('still scans without a jobs bridge (older harnesses) — no crash, LLM scan fires', async () => {
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    fireEvent.click(await screen.findByRole('button', { name: /scan now/i }));
    expect(mockArchiveScanContinuity).toHaveBeenCalled();
  });
});

describe('ContinuityPanel — M12.3 global contradictions (scope-independent)', () => {
  const globalItem = (overrides: Record<string, unknown> = {}) => ({
    id: 'gc-1',
    category: 'factual_contradiction',
    severity: 'critical',
    sceneId: 'sc-OTHER',
    offset: 0,
    excerpt: 'The gate fell in the third winter.',
    vaultNotePath: 'lore/The Gate.md',
    vaultExcerpt: 'The gate has never fallen.',
    rationale: 'contradicts lore',
    createdAt: '2026-08-27T00:00:00.000Z',
    entityName: 'The Gate',
    entityType: 'location',
    ...overrides,
  });

  it('negative control: no section when the global query returns nothing', async () => {
    setApi({ archiveListGlobalContradictions: vi.fn().mockResolvedValue({ items: [] }) });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    expect(screen.queryByTestId('cp-global-contradictions')).not.toBeInTheDocument();
  });

  it('surfaces a contradiction flagged in a DIFFERENT scene than the current one (AC3)', async () => {
    setApi({
      archiveListGlobalContradictions: vi.fn().mockResolvedValue({ items: [globalItem()] }),
    });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    const section = await screen.findByTestId('cp-global-contradictions');
    expect(section).toHaveTextContent('Elsewhere in manuscript');
    expect(section).toHaveTextContent('The gate fell in the third winter.');
    expect(section).toHaveTextContent('lore/The Gate.md');
  });

  it('items anchored to the CURRENT scene stay out of the elsewhere section (they live in the main list)', async () => {
    setApi({
      archiveListGlobalContradictions: vi.fn().mockResolvedValue({
        items: [globalItem({ id: 'gc-here', sceneId: 'sc-1' })],
      }),
    });
    await renderContinuity(<ContinuityPanel scene={mockScene} />);
    expect(screen.queryByTestId('cp-global-contradictions')).not.toBeInTheDocument();
  });
});
