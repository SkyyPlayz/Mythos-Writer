// ProductionReviewPanel.test.tsx — SKY-11411.
//
// Proves the renderer reachability half of the live path: pressing Run calls
// window.api.productionRoleRun with the picked role + scope + assembled text, and
// the returned review renders. Also proves the enable gate (a disabled role never
// reaches the provider) — the safety/entity-filtering half is covered on the main
// side by productionRoleSafety.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProductionReviewPanel from './ProductionReviewPanel';
import type { Story, Chapter, Scene } from '../types';

function makeScene(): Scene {
  return {
    id: 's1', title: 'Arrival', path: 'scenes/s1.md', order: 0,
    blocks: [
      { id: 'b1', type: 'prose', content: 'The lantern flickered in the dark.', order: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
function makeChapter(): Chapter {
  return { id: 'c1', title: 'Chapter 1', path: 'chapters/c1', order: 0, scenes: [makeScene()], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}
function makeStory(): Story {
  return { id: 'story-1', title: 'My Story', path: 'stories/story-1', chapters: [makeChapter()], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

const mockProductionRoleRun = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockProductionRoleRun.mockResolvedValue({ text: 'Reaction 1: the opening image gripped me.' });
  (window as unknown as { api: unknown }).api = { productionRoleRun: mockProductionRoleRun };
});

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
});

function renderPanel(rolesEnabled: Record<string, boolean> = { alphaReader: true, storylineConsultant: true, lineEditor: true }) {
  const story = makeStory();
  return render(
    <ProductionReviewPanel
      story={story}
      chapter={story.chapters[0]}
      scene={story.chapters[0].scenes[0]}
      rolesEnabled={rolesEnabled}
    />,
  );
}

describe('ProductionReviewPanel (SKY-11411 reachability)', () => {
  it('Run invokes window.api.productionRoleRun for the picked role and renders the review', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('production-review-run'));

    await waitFor(() => expect(mockProductionRoleRun).toHaveBeenCalledTimes(1));
    const arg = mockProductionRoleRun.mock.calls[0][0];
    expect(arg.role).toBe('alphaReader'); // default selection
    expect(arg.scope).toMatchObject({ kind: expect.any(String), id: expect.any(String), label: expect.any(String) });
    expect(arg.text).toContain('lantern flickered'); // real assembled manuscript text, not pre-seeded

    await waitFor(() => expect(screen.getByTestId('production-review-result')).toHaveTextContent('the opening image gripped me'));
  });

  it('sends the role the user selects', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Production role'), { target: { value: 'lineEditor' } });
    fireEvent.click(screen.getByTestId('production-review-run'));

    await waitFor(() => expect(mockProductionRoleRun).toHaveBeenCalledTimes(1));
    expect(mockProductionRoleRun.mock.calls[0][0].role).toBe('lineEditor');
  });

  it('a disabled role never reaches the provider (enable gate)', async () => {
    renderPanel({ alphaReader: false });

    // Run is blocked outright, with a visible reason next to it (SKY-11456) —
    // not a button that looks live and only nudges after the click.
    const run = screen.getByTestId('production-review-run');
    expect(run).toBeDisabled();
    const hint = await screen.findByTestId('production-review-off-hint');
    expect(hint).toHaveTextContent(/enable it in Settings/i);
    expect(run).toHaveAttribute('aria-describedby', hint.id);

    fireEvent.click(run);
    expect(mockProductionRoleRun).not.toHaveBeenCalled();
  });

  it('switching to an off role disables Run and hides the previous role’s review (SKY-11456)', async () => {
    renderPanel({ alphaReader: true, storylineConsultant: false, lineEditor: false });
    fireEvent.click(screen.getByTestId('production-review-run'));
    await waitFor(() => expect(screen.getByTestId('production-review-result')).toHaveTextContent('the opening image gripped me'));

    fireEvent.change(screen.getByLabelText('Production role'), { target: { value: 'lineEditor' } });

    // The Alpha Reader's notes must not be relabelled as the Line Editor's.
    expect(screen.queryByTestId('production-review-result')).toBeNull();
    expect(screen.getByTestId('production-review-run')).toBeDisabled();
    expect(screen.getByTestId('production-review-off-hint')).toHaveTextContent(/Line Editor is off/i);

    // Coming back to the role that produced it shows it again, still its own.
    fireEvent.change(screen.getByLabelText('Production role'), { target: { value: 'alphaReader' } });
    expect(screen.getByTestId('production-review-result')).toHaveTextContent('Alpha Reader — Scene: Arrival');
    expect(mockProductionRoleRun).toHaveBeenCalledTimes(1);
  });

  it('changing scope hides a review assembled for the old scope (SKY-11456)', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('production-review-run'));
    await waitFor(() => expect(screen.getByTestId('production-review-result')).toHaveTextContent('Scene: Arrival'));

    fireEvent.change(screen.getByLabelText('Review scope'), { target: { value: 'chapter' } });
    expect(screen.queryByTestId('production-review-result')).toBeNull();
  });

  it('surfaces a handler error as a toast without crashing', async () => {
    mockProductionRoleRun.mockResolvedValue({ error: 'Alpha Reader hit its daily budget cap.' });
    renderPanel();
    fireEvent.click(screen.getByTestId('production-review-run'));

    await screen.findByText(/daily budget cap/i);
    expect(screen.queryByTestId('production-review-result')).toBeNull();
  });
});
