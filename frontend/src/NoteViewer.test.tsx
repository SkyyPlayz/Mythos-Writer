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

    // Wait for loading to finish — Edit button only appears after setLoading(false),
    // which fires in .finally() after the .then() that calls setContent().
    await screen.findByRole('button', { name: 'Edit' });

    // Trigger immediate flush (clears debounce timer and writes synchronously)
    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });

    // The WikiLink serializer must preserve [[...]] tokens through the Tiptap
    // round-trip — a passing-but-hollow assertion (any(String)) would not catch
    // getMarkdown() returning '' or stripping wiki links (SKY-3971).
    await waitFor(() =>
      expect(writeNotesVault).toHaveBeenCalledWith(
        'Notes/Test.md',
        expect.stringContaining('[[Character: Elara]]'),
      ),
    );
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

    // Wait for loading to finish so editor content is set before the flush fires
    await screen.findByRole('button', { name: 'Edit' });

    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });

    // Serialized content must contain the loaded wiki link (not an empty or
    // hollow string), and must go through notes vault — never the story vault
    await waitFor(() =>
      expect(writeNotesVault).toHaveBeenCalledWith(
        'Notes/Test.md',
        expect.stringContaining('[[Scene: Chapter One/Opening Scene]]'),
      ),
    );
    expect(readVault).not.toHaveBeenCalled();
  });
});
