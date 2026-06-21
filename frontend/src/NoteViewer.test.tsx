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

    const editor = await screen.findByLabelText('Edit note: Test.md');
    fireEvent.change(editor, { target: { value: 'Updated [[Character: Elara]]' } });
    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });

    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith('Notes/Test.md', 'Updated [[Character: Elara]]'));
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

    const editor = await screen.findByLabelText('Edit note: Test.md');
    fireEvent.change(editor, { target: { value: 'New content' } });
    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });

    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith('Notes/Test.md', 'New content'));
    expect(readVault).not.toHaveBeenCalled();
  });
});
