import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectSwitcher, { deriveSingleStoryTitle, deriveVaultDisplayName } from './ProjectSwitcher';

const longVaultRoot = '/home/skyy/Mythos/Vaults/Extremely Long Series Name/Story Vault';
const notesVaultRoot = '/home/skyy/Mythos/Vaults/Extremely Long Series Name/Notes Vault';

function setApi(overrides: Partial<Record<string, unknown>> = {}) {
  (window as unknown as { api: unknown }).api = {
    projectList: vi.fn().mockResolvedValue({
      activeNotesVaultRoot: notesVaultRoot,
      projects: [
        {
          name: 'Fallback name',
          vaultRoot: longVaultRoot,
          notesVaultRoot,
          openedAt: '2026-06-11T00:00:00.000Z',
        },
      ],
    }),
    vaultGetPaths: vi.fn().mockResolvedValue({ homeDir: '/home/skyy', pathSeparator: '/' }),
    projectSwitch: vi.fn().mockResolvedValue({ switched: true, notesVaultRoot }),
    ...overrides,
  };
}

describe('ProjectSwitcher path display', () => {
  beforeEach(() => {
    setApi();
  });

  it('middle-truncates recent project paths while preserving full path in the tooltip', async () => {
    render(<ProjectSwitcher activeVaultRoot={longVaultRoot} onSwitched={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /active project/i }));

    const option = await screen.findByRole('option', { name: /Extremely Long Series Name/i });
    await waitFor(() => expect(screen.getByText('~/Mythos/…/Story Vault')).toBeInTheDocument());

    expect(option).toHaveAttribute('title', `${longVaultRoot}\n${notesVaultRoot}`);
  });
});

// ─── SKY-11451 — grouped-layout-aware display name ────────────────────────────

describe('deriveVaultDisplayName', () => {
  it('uses the shared parent folder name for the flat (pre-SKY-11451) bundle layout', () => {
    expect(
      deriveVaultDisplayName({
        vaultRoot: '/home/alice/Mythos/Vaults/Mythos Vault/Story Vault',
        notesVaultRoot: '/home/alice/Mythos/Vaults/Mythos Vault/Notes Vault',
      }),
    ).toBe('Mythos Vault');
  });

  it('uses the grandparent for the grouped layout (SKY-11141 §1)', () => {
    expect(
      deriveVaultDisplayName({
        vaultRoot: '/home/alice/Mythos/Vaults/My Novel/Stories/Story Vault',
        notesVaultRoot: '/home/alice/Mythos/Vaults/My Novel/Notes/Notes Vault',
      }),
    ).toBe('My Novel');
  });

  it('falls back to the Story Vault basename for a legacy (un-paired) entry', () => {
    expect(deriveVaultDisplayName({ vaultRoot: '/home/alice/Mythos/Story Vault' })).toBe('Story Vault');
  });

  it('does not apply the grouped-grandparent rule when the shared grandparent is not a Stories/Notes pair', () => {
    expect(
      deriveVaultDisplayName({
        vaultRoot: '/home/alice/Fiction/Novel',
        notesVaultRoot: '/home/alice/Research/Notes',
      }),
    ).toBe('Novel');
  });
});

// ─── SKY-9262 (P0.5) — workspace label prefers the story title ───────────────

describe('deriveSingleStoryTitle', () => {
  it('returns the title when the vault holds exactly one story', () => {
    expect(deriveSingleStoryTitle([{ title: 'The Last City of Veynn' }])).toBe('The Last City of Veynn');
  });

  it('returns undefined for zero, several, or untitled stories', () => {
    expect(deriveSingleStoryTitle(undefined)).toBeUndefined();
    expect(deriveSingleStoryTitle([])).toBeUndefined();
    expect(deriveSingleStoryTitle([{ title: 'A' }, { title: 'B' }])).toBeUndefined();
    expect(deriveSingleStoryTitle([{ title: '   ' }])).toBeUndefined();
  });
});

describe('ProjectSwitcher workspace label (SKY-9262)', () => {
  beforeEach(() => {
    setApi();
  });

  it('shows the single story title instead of the vault directory name', async () => {
    render(
      <ProjectSwitcher
        activeVaultRoot={longVaultRoot}
        activeStoryTitle="The Last City of Veynn"
        onSwitched={vi.fn()}
      />,
    );
    // Flush the mount-time projectList load, then assert the story title
    // still wins over both the directory name and the recents entry name.
    await waitFor(() => expect(screen.getByText('The Last City of Veynn')).toBeInTheDocument());
    expect(screen.queryByText('Extremely Long Series Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Fallback name')).not.toBeInTheDocument();
  });

  it('falls back to the recents project name when no single-story title exists', async () => {
    render(<ProjectSwitcher activeVaultRoot={longVaultRoot} onSwitched={vi.fn()} />);
    // Once projectList resolves, the recents entry's name wins over the
    // directory-derived fallback.
    await waitFor(() => expect(screen.getByText('Fallback name')).toBeInTheDocument());
  });
});

// ─── Shield vault park / flush pins (Ivy GO — RED if ProjectSwitcher → f385b3de) ─

const activeStoryVault = '/home/skyy/Mythos/Vaults/Active Mythos/Story Vault';
const activeNotesVault = '/home/skyy/Mythos/Vaults/Active Mythos/Notes Vault';
const otherStoryVault = '/home/skyy/Mythos/Vaults/Other Mythos/Story Vault';
const otherNotesVault = '/home/skyy/Mythos/Vaults/Other Mythos/Notes Vault';

describe('ProjectSwitcher Shield flush / park pins', () => {
  beforeEach(() => {
    delete (window as Window & { __mythosSettingsFlush?: unknown }).__mythosSettingsFlush;
    setApi({
      projectList: vi.fn().mockResolvedValue({
        // Active vault is NOT in recents so the button label falls through to
        // deriveVaultDisplayName(activeVault, activeNotesVaultRoot) — that is
        // how we observe setActiveNotesVaultRoot without changing props.
        activeNotesVaultRoot: activeNotesVault,
        projects: [
          {
            name: 'Other',
            vaultRoot: otherStoryVault,
            notesVaultRoot: otherNotesVault,
            openedAt: '2026-06-12T00:00:00.000Z',
          },
        ],
      }),
      openVaultFolder: vi.fn().mockResolvedValue({
        cancelled: false,
        vaultRoot: otherStoryVault,
      }),
      createVaultFromOptions: vi.fn().mockResolvedValue({
        ok: true,
        mode: 'template',
        mythosRoot: '/home/skyy/Mythos/Vaults/New',
        storyVaultPath: '/home/skyy/Mythos/Vaults/New/Stories/Story Vault',
        notesVaultPath: '/home/skyy/Mythos/Vaults/New/Notes/Notes Vault',
        vaultName: 'New',
      }),
    });
  });

  it('Open Other awaits __mythosSettingsFlush before openVaultFolder; refuse skips open', async () => {
    const callOrder: string[] = [];
    const openVaultFolder = vi.fn().mockImplementation(async () => {
      callOrder.push('openVaultFolder');
      return { cancelled: false, vaultRoot: otherStoryVault };
    });
    setApi({
      projectList: vi.fn().mockResolvedValue({
        activeNotesVaultRoot: activeNotesVault,
        projects: [],
      }),
      openVaultFolder,
    });

    const flushOk = vi.fn().mockImplementation(async () => {
      callOrder.push('flush');
      return true;
    });
    (window as Window & { __mythosSettingsFlush?: () => Promise<boolean> })
      .__mythosSettingsFlush = flushOk;

    render(<ProjectSwitcher activeVaultRoot={activeStoryVault} onSwitched={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /active project/i }));
    fireEvent.click(await screen.findByRole('button', { name: /open other folder/i }));

    await waitFor(() => expect(openVaultFolder).toHaveBeenCalledTimes(1));
    expect(flushOk).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['flush', 'openVaultFolder']);

    // Refuse: flush resolves false → openVaultFolder must never run.
    callOrder.length = 0;
    openVaultFolder.mockClear();
    const flushRefuse = vi.fn().mockImplementation(async () => {
      callOrder.push('flush');
      return false;
    });
    (window as Window & { __mythosSettingsFlush?: () => Promise<boolean> })
      .__mythosSettingsFlush = flushRefuse;

    fireEvent.click(screen.getByRole('button', { name: /active project/i }));
    fireEvent.click(await screen.findByRole('button', { name: /open other folder/i }));

    await waitFor(() => expect(flushRefuse).toHaveBeenCalledTimes(1));
    // Give the async handler a tick; open must stay uncalled.
    await new Promise((r) => setTimeout(r, 30));
    expect(openVaultFolder).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['flush']);
  });

  it('parked recent switch skips notes-root update; true/undefined still apply it', async () => {
    // Label starts as "Active Mythos" (paired roots). Wrongly applying Other's
    // notes root while props stay on Active collapses deriveVaultDisplayName to
    // the Story Vault basename — that is the RED signal if the park guard goes.
    const parked = vi.fn().mockResolvedValue(false);
    const { unmount } = render(
      <ProjectSwitcher activeVaultRoot={activeStoryVault} onSwitched={parked} />,
    );
    await waitFor(() => expect(screen.getByText('Active Mythos')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /active project/i }));
    fireEvent.click(await screen.findByRole('option', { name: /Other Mythos/i }));

    await waitFor(() => expect(parked).toHaveBeenCalledWith(otherStoryVault));
    expect(screen.getByText('Active Mythos')).toBeInTheDocument();
    expect(screen.queryByText(/^Story Vault$/)).not.toBeInTheDocument();
    unmount();

    // Positive control: onSwitched true → notes root updates (label collapses).
    const allowTrue = vi.fn().mockResolvedValue(true);
    const { unmount: unmountTrue } = render(
      <ProjectSwitcher activeVaultRoot={activeStoryVault} onSwitched={allowTrue} />,
    );
    await waitFor(() => expect(screen.getByText('Active Mythos')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /active project/i }));
    fireEvent.click(await screen.findByRole('option', { name: /Other Mythos/i }));
    await waitFor(() => expect(allowTrue).toHaveBeenCalledWith(otherStoryVault));
    await waitFor(() => expect(screen.getByText('Story Vault')).toBeInTheDocument());
    unmountTrue();

    // Positive control: onSwitched undefined (void) → same notes-root update.
    const allowVoid = vi.fn().mockResolvedValue(undefined);
    render(<ProjectSwitcher activeVaultRoot={activeStoryVault} onSwitched={allowVoid} />);
    await waitFor(() => expect(screen.getByText('Active Mythos')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /active project/i }));
    fireEvent.click(await screen.findByRole('option', { name: /Other Mythos/i }));
    await waitFor(() => expect(allowVoid).toHaveBeenCalledWith(otherStoryVault));
    await waitFor(() => expect(screen.getByText('Story Vault')).toBeInTheDocument());
  });

  it('Create New Mythos Vault passes activate:false; loadProjects skipped on park', async () => {
    const projectList = vi.fn().mockResolvedValue({
      activeNotesVaultRoot: activeNotesVault,
      projects: [],
    });
    const createVaultFromOptions = vi.fn().mockResolvedValue({
      ok: true,
      mode: 'template',
      mythosRoot: '/home/skyy/Mythos/Vaults/New',
      storyVaultPath: '/home/skyy/Mythos/Vaults/New/Stories/Story Vault',
      notesVaultPath: '/home/skyy/Mythos/Vaults/New/Notes/Notes Vault',
      vaultName: 'New',
    });
    setApi({ projectList, createVaultFromOptions });

    const onSwitched = vi.fn().mockResolvedValue(false);
    const { unmount } = render(
      <ProjectSwitcher activeVaultRoot={activeStoryVault} onSwitched={onSwitched} />,
    );
    await waitFor(() => expect(projectList).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /active project/i }));
    fireEvent.click(await screen.findByTestId('project-switcher-create-new'));

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument(),
    );
    // Count after open/create click (those may loadProjects) — park must not add more.
    const callsBeforeSubmit = projectList.mock.calls.length;
    fireEvent.click(screen.getByTestId('create-vault-submit'));

    await waitFor(() =>
      expect(createVaultFromOptions).toHaveBeenCalledWith(
        expect.objectContaining({ activate: false }),
      ),
    );
    await waitFor(() => expect(onSwitched).toHaveBeenCalled());
    // Parked: onCreated must not refresh recents via loadProjects.
    await new Promise((r) => setTimeout(r, 30));
    expect(projectList.mock.calls.length).toBe(callsBeforeSubmit);
    unmount();

    // Positive control: onSwitched true → loadProjects runs after create.
    const projectList2 = vi.fn().mockResolvedValue({
      activeNotesVaultRoot: activeNotesVault,
      projects: [],
    });
    const create2 = vi.fn().mockResolvedValue({
      ok: true,
      mode: 'template',
      mythosRoot: '/home/skyy/Mythos/Vaults/New2',
      storyVaultPath: '/home/skyy/Mythos/Vaults/New2/Stories/Story Vault',
      notesVaultPath: '/home/skyy/Mythos/Vaults/New2/Notes/Notes Vault',
      vaultName: 'New2',
    });
    setApi({ projectList: projectList2, createVaultFromOptions: create2 });
    const onSwitchedOk = vi.fn().mockResolvedValue(true);
    render(<ProjectSwitcher activeVaultRoot={activeStoryVault} onSwitched={onSwitchedOk} />);
    await waitFor(() => expect(projectList2).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /active project/i }));
    fireEvent.click(await screen.findByTestId('project-switcher-create-new'));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeInTheDocument(),
    );
    const afterOpen2 = projectList2.mock.calls.length;
    fireEvent.click(screen.getByTestId('create-vault-submit'));
    await waitFor(() => expect(onSwitchedOk).toHaveBeenCalled());
    await waitFor(() => expect(projectList2.mock.calls.length).toBeGreaterThan(afterOpen2));
  });
});
