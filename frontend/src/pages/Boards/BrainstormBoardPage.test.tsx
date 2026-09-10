/**
 * SKY-11192 §1/§2/§4 — Brainstorm's Board page and Agent Chat strip.
 *
 * The round-trip acceptance ("edit here, see it in the Notes Board tab") is an
 * E2E concern and lives in the Playwright spec — it needs a real filesystem
 * across the process boundary. What is proved here is the chrome the two homes
 * do NOT share, plus the numbers CEO ruling 3 pinned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BrainstormBoardPage, {
  clampStripHeight,
  stripMaxHeight,
  STRIP_COLLAPSE_BELOW,
  STRIP_DEFAULT_H,
  STRIP_MIN_H,
  STRIP_MAX_H,
} from './BrainstormBoardPage';

/** jsdom has no layout; the canvas measures its viewport on mount. */
class ViewportResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const listNotesVault = vi.fn();
const notesBoardGet = vi.fn();

const api = {
  listNotesVault,
  notesBoardGet,
  notesBoardPatchLayout: vi.fn(),
  notesBoardCreateItem: vi.fn(),
  notesBoardRenameItem: vi.fn(),
  notesThumbResolve: vi.fn().mockResolvedValue({ thumbs: {} }),
  onVaultNotesUpdated: vi.fn().mockReturnValue(() => {}),
  onVaultNotesAssetChanged: vi.fn().mockReturnValue(() => {}),
};

const EMPTY_META = { id: null, children: [], layout: {}, colors: {}, furniture: [], view: { zoom: 100, panX: 0, panY: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', ViewportResizeObserver);
  (window as unknown as { api: typeof api }).api = api;
  listNotesVault.mockResolvedValue({ items: [] });
  notesBoardGet.mockResolvedValue(EMPTY_META);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage(props: Partial<React.ComponentProps<typeof BrainstormBoardPage>> = {}) {
  const onActiveFolderChange = vi.fn();
  const utils = render(
    <BrainstormBoardPage
      notesVaultValid
      activeFolder="Plot & Story"
      onActiveFolderChange={onActiveFolderChange}
      {...props}
    />,
  );
  return { ...utils, onActiveFolderChange };
}

describe('SKY-11192 §2 — the strip resize band (CEO ruling 3)', () => {
  it('pins the band at the ruled numbers, not approximations', () => {
    expect(STRIP_DEFAULT_H).toBe(240);
    expect(STRIP_MIN_H).toBe(140);
    expect(STRIP_MAX_H).toBe(480);
    expect(STRIP_COLLAPSE_BELOW).toBe(190);
  });

  it('caps at 60% of the chat panel when that is smaller than 480', () => {
    expect(stripMaxHeight(600)).toBe(360);
    expect(stripMaxHeight(1000)).toBe(480);
  });

  it('falls back to the absolute max when the panel has not been measured', () => {
    expect(stripMaxHeight(0)).toBe(STRIP_MAX_H);
  });

  it('SNAPS to the floor rather than hiding the strip', () => {
    // §2: the strip is only ever hidden by the explicit Board toggle.
    expect(clampStripHeight(10, 1000)).toBe(STRIP_MIN_H);
    expect(clampStripHeight(-500, 1000)).toBe(STRIP_MIN_H);
  });

  it('clamps upward to the 60% cap', () => {
    expect(clampStripHeight(9999, 600)).toBe(360);
  });

  it('never returns a height below the floor even on a tiny panel', () => {
    expect(clampStripHeight(200, 100)).toBe(STRIP_MIN_H);
  });
});

describe('SKY-11192 §1 — the folder scope pill row', () => {
  it('ships exactly three pills and no vault browser (CEO ruling 1)', async () => {
    renderPage();
    const pills = await screen.findAllByRole('radio', { name: /Plot & Story|Characters|Worldbuilding/ });
    expect(pills.map((p) => p.textContent)).toEqual(['Plot & Story', 'Characters', 'Worldbuilding']);
    expect(screen.queryByText(/Browse vault/i)).toBeNull();
  });

  it('marks the active folder so the user need not remember it', async () => {
    renderPage({ activeFolder: 'Characters' });
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Characters' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Plot & Story' })).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('reports a pill click UP, so the chat strip shows the same board (§2)', async () => {
    const { onActiveFolderChange } = renderPage();
    await userEvent.click(await screen.findByRole('radio', { name: 'Worldbuilding' }));
    expect(onActiveFolderChange).toHaveBeenCalledWith('Worldbuilding');
  });

  it('carries the standing caption, not a one-time toast', async () => {
    renderPage();
    expect(await screen.findByText('This is your Notes Vault, viewed here.')).toBeInTheDocument();
  });

  it('reads the board from the active folder, vault-relative', async () => {
    renderPage({ activeFolder: 'Characters' });
    await waitFor(() => expect(notesBoardGet).toHaveBeenCalledWith('Characters'));
    expect(listNotesVault).toHaveBeenCalledWith('Characters');
  });
});

describe('SKY-11192 §4 — empty, loading and error states', () => {
  it('shows the empty state over a still-usable canvas', async () => {
    renderPage();
    expect(await screen.findByText('Nothing on this board yet')).toBeInTheDocument();
    // The canvas stays mounted so the Note/Board tools have something to click.
    expect(screen.getByRole('radio', { name: 'Note' })).toBeInTheDocument();
  });

  it('treats a genuinely missing folder as the error state, with a way out', async () => {
    listNotesVault.mockResolvedValue({ error: 'ENOENT: no such directory' });
    const { onActiveFolderChange } = renderPage({ activeFolder: 'Characters' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Couldn't open Characters\. It may have been moved or deleted\./);

    await userEvent.click(screen.getByRole('button', { name: 'Choose another board' }));
    expect(onActiveFolderChange).toHaveBeenCalledWith('Plot & Story');
  });

  it('degrades a malformed sidecar to EMPTY, not an error', async () => {
    // notesBoard.ts already falls back to an empty board for a bad sidecar.
    // Surfacing that as a failure would describe a system that is not real.
    notesBoardGet.mockResolvedValue({ ...EMPTY_META, layout: {}, furniture: [] });
    renderPage();
    expect(await screen.findByText('Nothing on this board yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells the user to open the Board page when the strip loses its folder', async () => {
    listNotesVault.mockResolvedValue({ error: 'ENOENT' });
    renderPage({ variant: 'strip', stripHeight: STRIP_DEFAULT_H });
    expect(await screen.findByText(/This board is no longer available/)).toBeInTheDocument();
  });
});

describe('SKY-11192 §2 — the collapsed-card band', () => {
  it('collapses cards below 190px exactly, not around it', async () => {
    const { rerender, container } = render(
      <BrainstormBoardPage
        notesVaultValid
        activeFolder="Plot & Story"
        onActiveFolderChange={vi.fn()}
        variant="strip"
        stripHeight={STRIP_COLLAPSE_BELOW}
      />,
    );
    await waitFor(() => expect(container.querySelector('.bsb--strip')).toBeTruthy());
    // Exactly at the boundary is NOT collapsed — "below 190" is a strict below.
    expect(container.querySelector('.bsb--strip')).toHaveAttribute('data-collapsed', 'false');

    rerender(
      <BrainstormBoardPage
        notesVaultValid
        activeFolder="Plot & Story"
        onActiveFolderChange={vi.fn()}
        variant="strip"
        stripHeight={STRIP_COLLAPSE_BELOW - 1}
      />,
    );
    expect(container.querySelector('.bsb--strip')).toHaveAttribute('data-collapsed', 'true');
  });

  it('renders the strip at the height it was given', async () => {
    const { container } = render(
      <BrainstormBoardPage
        notesVaultValid
        activeFolder="Characters"
        onActiveFolderChange={vi.fn()}
        variant="strip"
        stripHeight={300}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector<HTMLElement>('.bsb--strip')?.style.height).toBe('300px');
    });
  });

  it('names the folder it is showing, since it has no pill row', async () => {
    renderPage({ variant: 'strip', activeFolder: 'Worldbuilding' });
    expect(await screen.findByTestId('bsb-strip-scope')).toHaveTextContent('Worldbuilding');
  });
});

describe('SKY-11192 — no vault', () => {
  it('says so rather than rendering an empty board', async () => {
    renderPage({ notesVaultValid: false });
    expect(await screen.findByText(/No Notes vault selected/)).toBeInTheDocument();
    expect(notesBoardGet).not.toHaveBeenCalled();
  });
});
