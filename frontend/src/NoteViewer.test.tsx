import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteViewer from './NoteViewer';

const readNotesVault = vi.fn();
const writeNotesVault = vi.fn();
const readVault = vi.fn();
const writeVault = vi.fn();
const entityList = vi.fn();

beforeEach(() => {
  readNotesVault.mockResolvedValue({ content: 'See [[Scene: Chapter One/Opening Scene]] and [[Character: Elara]].' });
  writeNotesVault.mockResolvedValue({ path: 'Notes/Test.md', bytes: 1 });
  readVault.mockResolvedValue({ content: 'story-vault-content' });
  writeVault.mockResolvedValue({ path: 'Story/Test.md', bytes: 1 });
  entityList.mockResolvedValue({ entities: [] });
  (window as unknown as { api: unknown }).api = { readNotesVault, writeNotesVault, readVault, writeVault, entityList };
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Legacy (Edit/Preview) behaviour preserved
// ---------------------------------------------------------------------------

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

    // Wait for loading to finish — the Source textarea only appears after setLoading(false),
    // which fires in .finally() after the .then() that calls setContent().
    await screen.findByLabelText('Edit note: Test.md');

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

  it('debounces word-count reporting off the keystroke path (W0.5, PERFORMANCE §4)', async () => {
    const onWordCountChange = vi.fn();
    render(<NoteViewer path="Notes/Test.md" onWordCountChange={onWordCountChange} />);
    const textarea = await screen.findByLabelText('Edit note: Test.md');
    await waitFor(() => expect(onWordCountChange).toHaveBeenCalled()); // initial load count
    onWordCountChange.mockClear();

    fireEvent.change(textarea, { target: { value: 'one two three' } });
    // No synchronous shell update per keystroke...
    expect(onWordCountChange).not.toHaveBeenCalled();
    // ...but the debounced count lands shortly after.
    await waitFor(() => expect(onWordCountChange).toHaveBeenCalledWith(3));
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
    await screen.findByLabelText('Edit note: Test.md');

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

// ---------------------------------------------------------------------------
// Tri-mode toolbar (SKY-3208)
// ---------------------------------------------------------------------------

describe('NoteViewer tri-mode toolbar (SKY-3208)', () => {
  it('shows Source, Rich, and Preview mode buttons', async () => {
    render(<NoteViewer path="Notes/Test.md" />);
    await screen.findByLabelText('Edit note: Test.md');

    expect(screen.getByRole('button', { name: 'Source' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rich' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
  });

  it('defaults to Source mode showing textarea', async () => {
    render(<NoteViewer path="Notes/Test.md" />);
    const textarea = await screen.findByLabelText('Edit note: Test.md');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(screen.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to Preview mode when Preview button is clicked', async () => {
    render(<NoteViewer path="Notes/Test.md" />);
    await screen.findByLabelText('Edit note: Test.md');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await screen.findByTestId('note-viewer-preview');
    expect(screen.queryByLabelText('Edit note: Test.md')).toBeNull();
  });

  it('calls onModeChange when mode switches', async () => {
    const onModeChange = vi.fn();
    render(<NoteViewer path="Notes/Test.md" onModeChange={onModeChange} />);
    await screen.findByLabelText('Edit note: Test.md');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(onModeChange).toHaveBeenCalledWith('preview');
  });

  it('legacy onPreviewModeChange fires with true when switching to Preview', async () => {
    const onPreviewModeChange = vi.fn();
    render(<NoteViewer path="Notes/Test.md" onPreviewModeChange={onPreviewModeChange} />);
    await screen.findByLabelText('Edit note: Test.md');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(onPreviewModeChange).toHaveBeenCalledWith(true);
  });

  it('honours previewMode=true legacy prop by starting in Preview mode', async () => {
    render(<NoteViewer path="Notes/Test.md" previewMode />);
    await waitFor(() => expect(readNotesVault).toHaveBeenCalled());
    await screen.findByTestId('note-viewer-preview');
    expect(screen.queryByLabelText('Edit note: Test.md')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LC-2 fidelity guard (SKY-3208)
// ---------------------------------------------------------------------------

describe('NoteViewer LC-2 fidelity guard', () => {
  it('shows fidelity warning when switching to Rich mode with a table', async () => {
    readNotesVault.mockResolvedValue({ content: '| A | B |\n|---|---|\n| 1 | 2 |' });
    render(<NoteViewer path="Notes/Table.md" />);
    await screen.findByLabelText('Edit note: Table.md');

    fireEvent.click(screen.getByRole('button', { name: 'Rich' }));

    await screen.findByRole('dialog', { name: 'Rich mode may lose content' });
    expect(screen.getByText(/Markdown tables/i)).toBeTruthy();
  });

  it('shows fidelity warning when note has YAML frontmatter', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntitle: My Note\n---\nContent.' });
    render(<NoteViewer path="Notes/Frontmatter.md" />);
    await screen.findByLabelText('Edit note: Frontmatter.md');

    fireEvent.click(screen.getByRole('button', { name: 'Rich' }));

    await screen.findByRole('dialog', { name: 'Rich mode may lose content' });
    expect(screen.getByText(/YAML frontmatter/i)).toBeTruthy();
  });

  it('"Edit in Source" closes the warning and stays in Source mode', async () => {
    readNotesVault.mockResolvedValue({ content: '| A | B |\n|---|---|\n| 1 | 2 |' });
    render(<NoteViewer path="Notes/Table.md" />);
    await screen.findByLabelText('Edit note: Table.md');

    fireEvent.click(screen.getByRole('button', { name: 'Rich' }));
    await screen.findByRole('dialog', { name: 'Rich mode may lose content' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit in Source (safe)' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Edit note: Table.md')).toBeTruthy();
  });

  it('"Open in Rich anyway" dismisses the warning and enters Rich mode', async () => {
    readNotesVault.mockResolvedValue({ content: '| A | B |\n|---|---|\n| 1 | 2 |' });
    render(<NoteViewer path="Notes/Table.md" />);
    await screen.findByLabelText('Edit note: Table.md');

    fireEvent.click(screen.getByRole('button', { name: 'Rich' }));
    await screen.findByRole('dialog', { name: 'Rich mode may lose content' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in Rich anyway' }));
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    // In Rich mode the Source textarea is gone
    expect(screen.queryByLabelText('Edit note: Table.md')).toBeNull();
  });

  it('switches to Rich mode directly when content has no lossy features', async () => {
    readNotesVault.mockResolvedValue({ content: 'Just plain text with **bold** and [[link]].' });
    render(<NoteViewer path="Notes/Plain.md" />);
    await screen.findByLabelText('Edit note: Plain.md');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rich' }));
    });

    // No warning dialog — switched immediately
    expect(screen.queryByRole('dialog')).toBeNull();
    // Source textarea is gone (Rich mode is active)
    expect(screen.queryByLabelText('Edit note: Plain.md')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Save-failure surfacing (GH#616 / SKY-5151)
//
// The editor previously swallowed write errors in a no-op catch, so a rejected
// or { error } save left the user believing their note was persisted. These
// regressions assert that failures raise an accessible alert, never imply the
// note is saved, and clear once a save succeeds or the user edits again.
//
// NoteViewer funnels every write through writeNotesVault (SKY-2976), so both
// Notes-vault and Story-vault notes share this exact failure surface. We cover
// both failure representations the IPC layer can produce: a rejected promise
// and a resolved { error } envelope.
// ---------------------------------------------------------------------------

describe('NoteViewer save-failure surfacing (GH#616)', () => {
  async function loadAndFlush(path = 'Notes/Test.md') {
    render(<NoteViewer path={path} />);
    await screen.findByLabelText(`Edit note: ${path.split('/').pop()}`);
    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });
  }

  it('shows an accessible alert when a save is rejected', async () => {
    writeNotesVault.mockRejectedValue(new Error('EIO: disk failure'));

    await loadAndFlush();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Failed to save');
    expect(alert.textContent).toContain('not persisted');
    // Must NOT imply the note is saved.
    expect(screen.queryByText(/^Saved /)).toBeNull();
  });

  it('shows an accessible alert when a save resolves with an { error } envelope', async () => {
    writeNotesVault.mockResolvedValue({ error: 'EACCES: permission denied' });

    await loadAndFlush();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Failed to save');
    expect(screen.queryByText(/^Saved /)).toBeNull();
  });

  it('clears the error and shows a saved stamp once a later save succeeds (Retry)', async () => {
    writeNotesVault.mockRejectedValueOnce(new Error('transient network drop'));

    await loadAndFlush();
    await screen.findByRole('alert');

    // Retry now hits the default resolving mock — the save must persist and the
    // alert must clear, replaced by a "Saved" stamp.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText(/^Saved /)).toBeTruthy();
  });

  it('clears the error as soon as the writer edits again', async () => {
    writeNotesVault.mockRejectedValueOnce(new Error('transient'));

    render(<NoteViewer path="Notes/Test.md" />);
    const textarea = await screen.findByLabelText('Edit note: Test.md');
    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });
    await screen.findByRole('alert');

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'writer keeps typing' } });
    });

    // Editing is treated as a retry — the stale error is dropped immediately.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces a Story-vault note save failure through the same alert', async () => {
    // Story-vault notes still route through writeNotesVault; a failure there must
    // be surfaced identically rather than silently dropped.
    readNotesVault.mockResolvedValue({ content: 'Story vault note body.' });
    writeNotesVault.mockRejectedValue(new Error('ENOSPC: no space left'));

    await loadAndFlush('Story/Chapter.md');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Failed to save');
    expect(screen.queryByText(/^Saved /)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M16: external frontmatter updates sync into the open editor
// ---------------------------------------------------------------------------

describe('NoteViewer M16 frontmatter-update sync', () => {
  it('adopts externally-updated content for the same path when no edits are pending', async () => {
    readNotesVault.mockResolvedValue({ content: 'original body' });
    writeNotesVault.mockClear(); // this suite's mocks persist across tests
    render(<NoteViewer path="Notes/Test.md" />);
    const textarea = await screen.findByLabelText('Edit note: Test.md');
    expect(textarea).toHaveValue('original body');

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mythos:note-frontmatter-updated', {
        detail: { path: 'Notes/Test.md', content: '---\ntags: [new]\n---\noriginal body' },
      }));
    });

    expect(screen.getByLabelText('Edit note: Test.md')).toHaveValue('---\ntags: [new]\n---\noriginal body');
    // Adopting external content is not a local edit — nothing gets autosaved.
    expect(writeNotesVault).not.toHaveBeenCalled();
  });

  it('ignores updates for other paths', async () => {
    readNotesVault.mockResolvedValue({ content: 'original body' });
    render(<NoteViewer path="Notes/Test.md" />);
    await screen.findByLabelText('Edit note: Test.md');

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mythos:note-frontmatter-updated', {
        detail: { path: 'Notes/Other.md', content: 'other content' },
      }));
    });

    expect(screen.getByLabelText('Edit note: Test.md')).toHaveValue('original body');
  });

  it('keeps pending local edits instead of adopting the external update', async () => {
    readNotesVault.mockResolvedValue({ content: 'original body' });
    render(<NoteViewer path="Notes/Test.md" />);
    const textarea = await screen.findByLabelText('Edit note: Test.md');

    // Local edit arms the debounce timer — the editor now wins.
    fireEvent.change(textarea, { target: { value: 'locally edited body' } });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mythos:note-frontmatter-updated', {
        detail: { path: 'Notes/Test.md', content: 'external content' },
      }));
    });

    expect(screen.getByLabelText('Edit note: Test.md')).toHaveValue('locally edited body');
  });
});
