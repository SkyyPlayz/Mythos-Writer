import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ContinuityPanel from './ContinuityPanel';
import type { InconsistencyItem } from './InconsistencyCard';
import SuggestionReview from './SuggestionReview';
import type { UnifiedSuggestion } from './SuggestionDetailPane';
import { IdeaContextMenu } from './components/BrainstormCard/IdeaContextMenu';
import { __resetAiEnabledForTests } from './hooks/useAiEnabled';
import type { Scene } from './types';

const FORBIDDEN = /accept|add to scene(?! board)|use this|apply|implement|insert/i;

function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function makeItem(overrides: Partial<InconsistencyItem> = {}): InconsistencyItem {
  return {
    id: 'flag-how',
    scope: 'story_vault',
    category: 'character_attribute_drift',
    severity: 'high',
    manuscriptAnchor: { sceneId: 'sc-1', offset: 0, excerpt: 'Night bridge crossing' },
    vaultAnchor: { notePath: 'locations/bridge.md', line: 2, excerpt: 'daylight only' },
    rationale: 'The scene crosses at night.',
    proposedResolution: {
      matchArchiveToStory: 'Update the note to night.',
      suggestStoryChange: 'Cross the bridge after dawn.',
    },
    status: 'open',
    resolvedAt: null,
    resolvedAction: null,
    createdAt: '2026-10-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeSuggestion(overrides: Partial<UnifiedSuggestion>): UnifiedSuggestion {
  return {
    id: 'row',
    kind: 'suggestion',
    sourceAgent: 'writing-assistant',
    confidence: 0.8,
    rationale: 'A note',
    targetPath: 'stories/ch1/scene-1.md',
    targetAnchor: null,
    status: 'proposed',
    createdAt: '2026-10-19T00:00:00.000Z',
    appliedAt: null,
    budgetExceeded: false,
    category: null,
    payloadJson: null,
    ...overrides,
  };
}

const scene: Scene = {
  id: 'sc-1',
  title: 'Scene One',
  path: 'scenes/sc-1.md',
  order: 0,
  blocks: [{ id: 'b1', type: 'prose', order: 0, content: 'Night bridge crossing.', updatedAt: '' }],
  createdAt: '',
  updatedAt: '',
};

function MenuHarness() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div>
      <button type="button" onClick={(e) => setAnchor(e.currentTarget)}>
        Open idea menu
      </button>
      <IdeaContextMenu
        anchorEl={anchor}
        onAction={() => {}}
        onClose={() => setAnchor(null)}
        hasSavedPath
      />
    </div>
  );
}

describe('AI suggest-only reachable surfaces (T10a, T9)', () => {
  beforeEach(() => {
    __resetAiEnabledForTests();
    (window as unknown as { api: unknown }).api = {
      archiveListContinuity: vi.fn().mockResolvedValue({
        items: [
          makeItem(),
          makeItem({
            id: 'flag-vault',
            manuscriptAnchor: { sceneId: 'sc-1', offset: 4, excerpt: 'Day gate' },
            proposedResolution: {
              matchArchiveToStory: 'Update the note to the day gate.',
              suggestStoryChange: 'Leave the gate for morning.',
            },
          }),
        ],
      }),
      archiveListGlobalContradictions: vi.fn().mockResolvedValue({ items: [] }),
      archiveScanContinuity: vi.fn(),
      archiveResolveContinuity: vi.fn().mockResolvedValue({ ok: true }),
      onArchiveContScanStart: vi.fn(() => () => {}),
      onArchiveContScanResult: vi.fn(() => () => {}),
      onArchiveContScanError: vi.fn(() => () => {}),
      onArchiveContItemResolved: vi.fn(() => () => {}),
      settingsGet: vi.fn().mockResolvedValue({}),
      settingsSet: vi.fn().mockResolvedValue({}),
      jobs: { onEvent: vi.fn(() => () => {}) },
      suggestionsUnifiedList: vi.fn().mockResolvedValue({
        items: [
          makeSuggestion({
            id: 'ms-1',
            targetKind: 'manuscript',
            rationale: 'Slow opening paragraph.',
            targetPath: 'stories/ch1/scene-1.md',
            sourceAgent: 'writing-assistant',
          }),
          makeSuggestion({
            id: 'vault-1',
            targetKind: 'vault',
            rationale: 'Vault keep the hero note.',
            targetPath: 'characters/hero.md',
            sourceAgent: 'brainstorm',
          }),
        ],
        totalCount: 2,
        countByAgent: {},
        countByKind: {},
      }),
      suggestionsAccept: vi.fn().mockResolvedValue({ id: 'ms-1', status: 'accepted' }),
      suggestionsReject: vi.fn(),
      suggestionsIgnore: vi.fn(),
      suggestionsRollback: vi.fn(),
      auditList: vi.fn().mockResolvedValue({ entries: [] }),
    };
  });

  it('has no apply/accept/insert control on manuscript or AI-text surfaces, and SuggestionCard is gone', async () => {
    render(
      <div>
        <ContinuityPanel scene={scene} />
        <SuggestionReview />
        <MenuHarness />
      </div>,
    );

    const howCard = await screen.findByRole('listitem', { name: /night bridge crossing/i });
    fireEvent.click(howCard.querySelector('button[aria-label^="Suggest fix"]') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: /suggest a change to the story/i }));
    expect(screen.getByText('How to fix (AI)')).toBeInTheDocument();
    expect(screen.getByText('Cross the bridge after dawn.')).toBeInTheDocument();

    const vaultCard = screen.getByRole('listitem', { name: /day gate/i });
    fireEvent.click(vaultCard.querySelector('button[aria-label^="Suggest fix"]') as HTMLButtonElement);
    fireEvent.click(screen.getAllByRole('button', { name: /update your notes/i })[0]);
    expect(screen.getByRole('button', { name: /^apply vault change$/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /mark done suggestion from writing coach/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^accept suggestion from brainstorm$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open idea menu/i }));
    expect(screen.getByRole('menuitem', { name: /copy markdown/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /add to scene draft/i })).not.toBeInTheDocument();

    const controls = document.body.querySelectorAll('button, [role="menuitem"]');
    const hits: string[] = [];
    for (const el of controls) {
      const name = accessibleName(el);
      if (!FORBIDDEN.test(name)) continue;
      if (/^Apply vault change$/i.test(name)) continue;
      if (/^Accept suggestion from /i.test(name)) {
        const row = el.closest('[role="article"]');
        if (row?.textContent?.includes('Vault keep the hero note.')) continue;
      }
      hits.push(name);
    }
    expect(hits).toEqual([]);

    const cardPath = path.resolve(process.cwd(), 'src/SuggestionCard.tsx');
    expect(fs.existsSync(cardPath)).toBe(false);
  });
});

describe('manuscript rows and old AI wording (T6, T7, T8)', () => {
  beforeEach(() => {
    (window as unknown as { api: unknown }).api = {
      suggestionsUnifiedList: vi.fn(),
      suggestionsAccept: vi.fn(),
      suggestionsReject: vi.fn(),
      suggestionsIgnore: vi.fn(),
      suggestionsRollback: vi.fn(),
      auditList: vi.fn().mockResolvedValue({ entries: [] }),
    };
  });

  it('labels a manuscript row Mark done and a vault row Accept', async () => {
    const api = (window as unknown as { api: { suggestionsUnifiedList: ReturnType<typeof vi.fn> } }).api;
    api.suggestionsUnifiedList.mockResolvedValue({
      items: [
        makeSuggestion({ id: 'ms-1', targetKind: 'manuscript', rationale: 'Slow opening paragraph.' }),
        makeSuggestion({
          id: 'vault-1',
          targetKind: 'vault',
          sourceAgent: 'brainstorm',
          rationale: 'Vault keep the hero note.',
          targetPath: 'characters/hero.md',
        }),
      ],
      totalCount: 2,
    });
    render(<SuggestionReview />);
    expect(await screen.findByRole('button', { name: /mark done suggestion from writing coach/i })).toHaveTextContent('Mark done');
    expect(screen.getByRole('button', { name: /^accept suggestion from brainstorm$/i })).toHaveTextContent('Accept');

    const manuscriptRow = screen.getByRole('article', { name: /slow opening paragraph/i });
    fireEvent.click(manuscriptRow, { ctrlKey: true });
    expect(screen.getByRole('button', { name: /mark all selected done/i })).toHaveTextContent('Mark all selected done');
  });

  it('renders an older AI-wording row read-only', async () => {
    const api = (window as unknown as { api: { suggestionsUnifiedList: ReturnType<typeof vi.fn>; suggestionsAccept: ReturnType<typeof vi.fn> } }).api;
    api.suggestionsUnifiedList.mockResolvedValue({
      items: [
        makeSuggestion({
          id: 'old-1',
          rationale: 'AI wrote a replacement sentence.',
          payloadJson: JSON.stringify({ kind: 'continuity_story_change', suggestedText: 'AI wrote a replacement sentence.' }),
          targetKind: 'manuscript',
        }),
      ],
      totalCount: 1,
    });
    render(<SuggestionReview />);
    const row = await screen.findByRole('article', { name: /AI wrote a replacement sentence/i });
    expect(row).toHaveTextContent('Older suggestion (AI wording)');
    expect(row.querySelector('button.sr-btn-accept')).toBeNull();
    expect(row.querySelector('textarea')).toBeNull();
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(row, { key: 'a' });
    expect(api.suggestionsAccept).not.toHaveBeenCalled();
  });

  it('keys the toast on the returned status', async () => {
    const api = (window as unknown as { api: { suggestionsUnifiedList: ReturnType<typeof vi.fn>; suggestionsAccept: ReturnType<typeof vi.fn> } }).api;
    api.suggestionsUnifiedList.mockResolvedValue({
      items: [makeSuggestion({ id: 'ms-1', targetKind: 'manuscript', targetPath: 'stories/ch1/scene-1.md', rationale: 'Slow opening paragraph.' })],
      totalCount: 1,
    });
    api.suggestionsAccept.mockResolvedValue({ id: 'ms-1', status: 'applied' });
    render(<SuggestionReview />);
    fireEvent.click(await screen.findByRole('button', { name: /mark done suggestion/i }));
    await waitFor(() => {
      expect(screen.getAllByText(/Applied to stories\/ch1\/scene-1\.md/).length).toBeGreaterThan(0);
    });
  });
});

describe('suggest_only continuity message', () => {
  it('explains a stale suggest_only refusal without saying the note is missing', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/ContinuityPanel.tsx'), 'utf8');
    expect(src).toContain("reason === 'suggest_only'");
    expect(src).toContain('This continuity fix stays in your scene. The how-to-fix note is only a guide.');
    expect(src).not.toContain('AI can never write prose');
  });
});
