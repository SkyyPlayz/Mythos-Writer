import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NoteViewer from './NoteViewer';

const readNotesVault = vi.fn();
const writeNotesVault = vi.fn();
const readVault = vi.fn();

beforeEach(() => {
  readNotesVault.mockResolvedValue({ content: 'See [[Scene: Chapter One/Opening Scene]] and [[Character: Elara]].' });
  writeNotesVault.mockResolvedValue({ path: 'Notes/Test.md', bytes: 1 });
  readVault.mockResolvedValue({ content: 'story-vault-content' });
  (window as unknown as { api: unknown }).api = { readNotesVault, writeNotesVault, readVault };
});

describe('NoteViewer cross-tab links', () => {
  it('renders wiki links as clickable controls in preview mode', async () => {
    const onWikiLinkClick = vi.fn();

    render(
      <NoteViewer
        path="Notes/Test.md"
        previewMode
        onPreviewModeChange={vi.fn()}
        onWikiLinkClick={onWikiLinkClick}
      />,
    );

    await waitFor(() => expect(readNotesVault).toHaveBeenCalledWith('Notes/Test.md'));
    fireEvent.click(await screen.findByRole('button', { name: '[[Scene: Chapter One/Opening Scene]]' }));

    expect(onWikiLinkClick).toHaveBeenCalledWith('Scene: Chapter One/Opening Scene');
  });

  it('flushes note content when the tab-aware save event fires', async () => {
    render(<NoteViewer path="Notes/Test.md" />);

    // Wait for initial note content to load into editor
    await waitFor(() => expect(readNotesVault).toHaveBeenCalledWith('Notes/Test.md'));

    // Trigger immediate flush (clears debounce timer and writes synchronously)
    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });

    // Editor serializes its current content and writes through notes vault
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith('Notes/Test.md', expect.any(String)));
  });

  it('does not fall back to story vault when readNotesVault fails (SKY-2976/GH#620)', async () => {
    readNotesVault.mockResolvedValue({ error: 'File not found' });

    render(<NoteViewer path="Notes/Missing.md" />);

    await waitFor(() => expect(readNotesVault).toHaveBeenCalledWith('Notes/Missing.md'));
    expect(readVault).not.toHaveBeenCalled();
    await screen.findByRole('alert');
  });

  it('always writes through notes vault API (SKY-2976)', async () => {
    render(<NoteViewer path="Notes/Test.md" />);

    // Wait for initial load
    await waitFor(() => expect(readNotesVault).toHaveBeenCalledWith('Notes/Test.md'));

    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });

    // Writes through notes vault, never touches the story vault
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith('Notes/Test.md', expect.any(String)));
    expect(readVault).not.toHaveBeenCalled();
  });
});
