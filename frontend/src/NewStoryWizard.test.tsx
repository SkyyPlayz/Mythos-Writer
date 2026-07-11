// Beta 4 M3 — New Story wizard dialog (prototype "New Story" modal 3639–3688).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewStoryWizard, { linkedPlansLabel } from './NewStoryWizard';
import type { NewStoryDraft } from './newStoryFlow';

function stubApi(overrides: Partial<Window['api']> = {}) {
  (window as unknown as { api: Partial<Window['api']> }).api = overrides;
}

const LISTING = {
  items: [
    { path: 'Characters', name: 'Characters', isDirectory: true, modifiedAt: '' },
    { path: 'Characters/Kael.md', name: 'Kael.md', isDirectory: false, modifiedAt: '' },
    { path: 'Plans', name: 'Plans', isDirectory: true, modifiedAt: '' },
    { path: 'Plans/Plan — Veynn.md', name: 'Plan — Veynn.md', isDirectory: false, modifiedAt: '' },
  ],
};

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
});

describe('NewStoryWizard', () => {
  it('renders nothing when closed', () => {
    render(<NewStoryWizard open={false} onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders name, voice preset, and plan-link sections', () => {
    render(<NewStoryWizard open onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByText('New Story')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Story name…')).toBeInTheDocument();
    expect(screen.getByText('VOICE — TUNES THE WRITING COACH')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Genre' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Voice' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Point of view' })).toBeInTheDocument();
    expect(screen.getByText('LINK YOUR PLANS — FROM THE NOTES VAULT')).toBeInTheDocument();
    expect(screen.getByText(/A Story Plan note is created in this vault/)).toBeInTheDocument();
  });

  it('lists Notes-Vault folders from listNotesVault', async () => {
    stubApi({ listNotesVault: vi.fn().mockResolvedValue(LISTING) });
    render(<NewStoryWizard open onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(await screen.findByTestId('nsw-folder-Characters')).toBeInTheDocument();
    expect(screen.getByTestId('nsw-folder-Plans')).toBeInTheDocument();
    expect(screen.getAllByText('1 notes')).toHaveLength(2);
  });

  it('creates with the entered name, voice preset, and linked folders', async () => {
    stubApi({ listNotesVault: vi.fn().mockResolvedValue(LISTING) });
    const onCreate = vi.fn();
    render(<NewStoryWizard open onClose={vi.fn()} onCreate={onCreate} />);

    fireEvent.change(screen.getByTestId('nsw-name'), { target: { value: 'The Hollow Crown' } });
    fireEvent.change(screen.getByTestId('nsw-genre'), { target: { value: 'Dark Fantasy' } });
    fireEvent.change(screen.getByTestId('nsw-voice'), { target: { value: 'Wry' } });
    fireEvent.change(screen.getByTestId('nsw-pov'), { target: { value: 'First Person' } });
    fireEvent.click(await screen.findByTestId('nsw-folder-Characters'));
    fireEvent.click(screen.getByTestId('nsw-create'));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0][0] as NewStoryDraft;
    expect(draft).toEqual({
      name: 'The Hollow Crown',
      genre: 'Dark Fantasy',
      voice: 'Wry',
      pov: 'First Person',
      linkedFolders: ['Characters'],
    });
  });

  it('updates the timeline card as folders are linked', async () => {
    stubApi({ listNotesVault: vi.fn().mockResolvedValue(LISTING) });
    render(<NewStoryWizard open onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByTestId('nsw-linked-label')).toHaveTextContent('Nothing linked yet');
    fireEvent.click(await screen.findByTestId('nsw-folder-Characters'));
    expect(screen.getByTestId('nsw-linked-label')).toHaveTextContent('1 plan linked');
    fireEvent.click(screen.getByTestId('nsw-folder-Plans'));
    expect(screen.getByTestId('nsw-linked-label')).toHaveTextContent('2 plans linked');
  });

  it('creates with defaults when nothing is touched (name falls back downstream)', () => {
    const onCreate = vi.fn();
    render(<NewStoryWizard open onClose={vi.fn()} onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('nsw-create'));
    const draft = onCreate.mock.calls[0][0] as NewStoryDraft;
    expect(draft).toEqual({
      name: '',
      genre: 'Epic Fantasy',
      voice: 'Dark & Gritty',
      pov: 'Third Limited',
      linkedFolders: [],
    });
  });

  it('ignores a double-click on Create (single story + plan note)', () => {
    const onCreate = vi.fn();
    render(<NewStoryWizard open onClose={vi.fn()} onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId('nsw-create'));
    fireEvent.click(screen.getByTestId('nsw-create'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('calls onClose from Cancel and from Escape', () => {
    const onClose = vi.fn();
    render(<NewStoryWizard open onClose={onClose} onCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('resets the form each time it opens', async () => {
    stubApi({ listNotesVault: vi.fn().mockResolvedValue(LISTING) });
    const { rerender } = render(<NewStoryWizard open onClose={vi.fn()} onCreate={vi.fn()} />);
    fireEvent.change(screen.getByTestId('nsw-name'), { target: { value: 'Draft name' } });
    fireEvent.click(await screen.findByTestId('nsw-folder-Characters'));
    rerender(<NewStoryWizard open={false} onClose={vi.fn()} onCreate={vi.fn()} />);
    rerender(<NewStoryWizard open onClose={vi.fn()} onCreate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('nsw-name')).toHaveValue(''));
    expect(screen.getByTestId('nsw-linked-label')).toHaveTextContent('Nothing linked yet');
  });

  it('shows the empty-vault message when no folders exist', async () => {
    stubApi({ listNotesVault: vi.fn().mockResolvedValue({ items: [] }) });
    render(<NewStoryWizard open onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(await screen.findByText(/No note folders yet/)).toBeInTheDocument();
  });

  it('survives a listNotesVault error (checklist stays empty)', async () => {
    stubApi({ listNotesVault: vi.fn().mockRejectedValue(new Error('offline')) });
    render(<NewStoryWizard open onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(await screen.findByText(/No note folders yet/)).toBeInTheDocument();
  });
});

describe('linkedPlansLabel', () => {
  it('pluralizes correctly', () => {
    expect(linkedPlansLabel(0)).toBe('Nothing linked yet — the timeline starts empty');
    expect(linkedPlansLabel(1)).toBe('1 plan linked — the planned lane fills from them');
    expect(linkedPlansLabel(3)).toBe('3 plans linked — the planned lane fills from them');
  });
});
