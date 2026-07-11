import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import WindowChrome from './WindowChrome';

const WC_CSS = readFileSync(resolve(process.cwd(), 'src/components/ui/WindowChrome.css'), 'utf-8');

const mockWindowMinimize = vi.fn();
const mockWindowMaximize = vi.fn();
const mockWindowClose = vi.fn();
const mockGetAppInfo = vi.fn();

function stubApi(platform: string) {
  mockGetAppInfo.mockResolvedValue({ platform, electronVersion: '30.0.0', appVersion: '1.0.0' });
  Object.defineProperty(window, 'api', {
    value: {
      getAppInfo: mockGetAppInfo,
      windowMinimize: mockWindowMinimize,
      windowMaximize: mockWindowMaximize,
      windowClose: mockWindowClose,
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WindowChrome', () => {
  describe('rendering', () => {
    it('renders the window chrome banner', async () => {
      stubApi('linux');
      await act(async () => { render(<WindowChrome />); });
      expect(screen.getByRole('banner', { name: /window chrome/i })).toBeInTheDocument();
    });

    it('renders the app title', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      expect(screen.getByText('Mythos Writer')).toBeInTheDocument();
    });

    it('renders close, minimize, and maximize buttons', async () => {
      stubApi('linux');
      await act(async () => { render(<WindowChrome />); });
      expect(screen.getByRole('button', { name: /close window/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /minimize window/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /maximize window/i })).toBeInTheDocument();
    });
  });

  describe('platform-conditional layout', () => {
    it('places controls left on macOS (darwin)', async () => {
      stubApi('darwin');
      await act(async () => { render(<WindowChrome />); });
      const controls = screen.getByTestId('wc-controls');
      expect(controls.classList.contains('wc-controls-left')).toBe(true);
    });

    it('places controls right on Windows (win32)', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      const controls = screen.getByTestId('wc-controls');
      expect(controls.classList.contains('wc-controls-right')).toBe(true);
    });

    it('places controls right on Linux', async () => {
      stubApi('linux');
      await act(async () => { render(<WindowChrome />); });
      const controls = screen.getByTestId('wc-controls');
      expect(controls.classList.contains('wc-controls-right')).toBe(true);
    });
  });

  describe('IPC calls on button click', () => {
    it('calls windowClose when close button is clicked', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      fireEvent.click(screen.getByRole('button', { name: /close window/i }));
      expect(mockWindowClose).toHaveBeenCalledTimes(1);
    });

    it('calls windowMinimize when minimize button is clicked', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      fireEvent.click(screen.getByRole('button', { name: /minimize window/i }));
      expect(mockWindowMinimize).toHaveBeenCalledTimes(1);
    });

    it('calls windowMaximize when maximize button is clicked', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      fireEvent.click(screen.getByRole('button', { name: /maximize window/i }));
      expect(mockWindowMaximize).toHaveBeenCalledTimes(1);
    });

    it('calls windowClose on macOS when close button is clicked', async () => {
      stubApi('darwin');
      await act(async () => { render(<WindowChrome />); });
      fireEvent.click(screen.getByRole('button', { name: /close window/i }));
      expect(mockWindowClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('graceful degradation', () => {
    it('renders without crashing when window.api is unavailable', async () => {
      Object.defineProperty(window, 'api', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      await act(async () => { render(<WindowChrome />); });
      expect(screen.getByRole('banner')).toBeInTheDocument();
    });
  });
});

// ─── Liquid Neon a11y — CSS regression ───────────────────────────────────────

describe('WindowChrome — Liquid Neon a11y CSS', () => {
  it('control button focus ring uses --focus-ring token', () => {
    const m = WC_CSS.match(/\.wc-btn:focus-visible\s*\{([^}]*)\}/);
    expect(m?.[1] ?? '').toContain('var(--focus-ring)');
  });

  it('high-contrast block adds solid border to control buttons', () => {
    expect(WC_CSS).toContain('[data-contrast="high"]');
    const m = WC_CSS.match(/\[data-contrast="high"\]\s*\.wc-btn\s*\{([^}]*)\}/);
    expect(m?.[1] ?? '').toContain('border');
  });

  it('control buttons have accessible aria-labels', async () => {
    stubApi('linux');
    await act(async () => { render(<WindowChrome />); });
    expect(screen.getByRole('button', { name: /close window/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /minimize window/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /maximize window/i })).toBeInTheDocument();
  });

  it('window chrome bar has role="banner" with aria-label', async () => {
    stubApi('linux');
    await act(async () => { render(<WindowChrome />); });
    expect(screen.getByRole('banner', { name: /window chrome/i })).toBeInTheDocument();
  });
});

// SKY-906 — the project menu carries the legacy switcher's E2E anchors and
// the "+ Create new Mythos Vault" row (restored after the M5 restyle dropped it).
describe('WindowChrome — project menu create-vault parity', () => {
  it('trigger carries the legacy project-switcher-btn compat class', async () => {
    stubApi('linux');
    await act(async () => { render(<WindowChrome />); });
    expect(screen.getByTestId('wc-project-trigger')).toHaveClass('project-switcher-btn');
  });

  it('shows the create-vault row with the legacy testid and invokes the callback', async () => {
    stubApi('linux');
    const onCreateVault = vi.fn();
    await act(async () => { render(<WindowChrome onCreateVault={onCreateVault} />); });
    fireEvent.click(screen.getByTestId('wc-project-trigger'));
    const row = screen.getByTestId('project-switcher-create-new');
    expect(row).toHaveClass('project-switcher-item');
    // Beta 4 M2: spec label (§4) — the sky-906 E2E anchors on the testid.
    expect(row).toHaveTextContent('New Mythos vault…');
    fireEvent.click(row);
    expect(onCreateVault).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('project-switcher-create-new')).not.toBeInTheDocument();
  });

  it('omits the create-vault row when no handler is wired', async () => {
    stubApi('linux');
    await act(async () => { render(<WindowChrome />); });
    fireEvent.click(screen.getByTestId('wc-project-trigger'));
    expect(screen.queryByTestId('project-switcher-create-new')).not.toBeInTheDocument();
  });
});

// ─── Beta 4 M2 — vault switcher popover: location + stats per vault (§4) ─────

describe('WindowChrome — vault switcher stats', () => {
  function stubApiWithProjects() {
    stubApi('linux');
    const projectList = vi.fn().mockResolvedValue({
      projects: [
        { name: 'The Last City of Veynn', vaultRoot: '/vaults/veynn/Story Vault', notesVaultRoot: '/vaults/veynn/Notes Vault', openedAt: '2026-07-01T00:00:00Z' },
      ],
    });
    const projectStats = vi.fn().mockResolvedValue({
      stats: [
        { vaultRoot: '/vaults/veynn/Story Vault', storyFileCount: 12, noteCount: 45 },
      ],
    });
    (window as unknown as { api: Record<string, unknown> }).api = {
      ...(window as unknown as { api: Record<string, unknown> }).api,
      projectList,
      projectStats,
    };
    return { projectList, projectStats };
  }

  it('fetches stats when the popover opens and renders name, location, and stats', async () => {
    const { projectList, projectStats } = stubApiWithProjects();
    await act(async () => { render(<WindowChrome activeVaultRoot="/vaults/veynn/Story Vault" />); });
    await act(async () => { fireEvent.click(screen.getByTestId('wc-project-trigger')); });
    expect(projectList).toHaveBeenCalledTimes(1);
    expect(projectStats).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The Last City of Veynn')).toBeInTheDocument();
    expect(screen.getByText('/vaults/veynn/Story Vault')).toBeInTheDocument();
    expect(screen.getByTestId('wc-vault-stats')).toHaveTextContent('12 story files · 45 notes');
  });

  it('renders rows without a stats line when the stats API is absent', async () => {
    stubApi('linux');
    const projectList = vi.fn().mockResolvedValue({
      projects: [{ name: 'Old Vault', vaultRoot: '/old', openedAt: '2026-01-01T00:00:00Z' }],
    });
    (window as unknown as { api: Record<string, unknown> }).api = {
      ...(window as unknown as { api: Record<string, unknown> }).api,
      projectList,
    };
    await act(async () => { render(<WindowChrome />); });
    await act(async () => { fireEvent.click(screen.getByTestId('wc-project-trigger')); });
    expect(screen.getByText('Old Vault')).toBeInTheDocument();
    expect(screen.queryByTestId('wc-vault-stats')).not.toBeInTheDocument();
  });
});

// ─── Beta 4 M2 — center "Search vault…" field + Ctrl-K hint (§4 / CF-14) ─────

describe('WindowChrome — search field', () => {
  it('typing hands the draft query to the palette and stays empty itself', async () => {
    stubApi('linux');
    const onOpenPalette = vi.fn();
    await act(async () => { render(<WindowChrome onOpenPalette={onOpenPalette} />); });
    const input = screen.getByTestId('wc-search-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Mira' } });
    expect(onOpenPalette).toHaveBeenCalledWith('Mira');
    expect(input.value).toBe(''); // palette owns the query from keystroke one
  });

  it('clicking the pill opens the palette without a seed', async () => {
    stubApi('linux');
    const onOpenPalette = vi.fn();
    await act(async () => { render(<WindowChrome onOpenPalette={onOpenPalette} />); });
    fireEvent.click(screen.getByTestId('wc-search-pill'));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
    expect(onOpenPalette).toHaveBeenCalledWith();
  });

  it('shows the Ctrl K hint', async () => {
    stubApi('linux');
    await act(async () => { render(<WindowChrome onOpenPalette={() => {}} />); });
    expect(screen.getByText('Ctrl K')).toBeInTheDocument();
  });
});
