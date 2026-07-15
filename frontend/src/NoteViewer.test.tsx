import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteViewer, { NOTES_DEFAULT_RICH_KEY } from './NoteViewer';

const readNotesVault = vi.fn();
const writeNotesVault = vi.fn();
const readVault = vi.fn();
const writeVault = vi.fn();
const entityList = vi.fn();
const noteBacklinks = vi.fn();

beforeEach(() => {
  // The previous test's unmount autosave lands on these shared fns — clear
  // call history so not.toHaveBeenCalled() assertions see only this test.
  readNotesVault.mockClear();
  writeNotesVault.mockClear();
  readNotesVault.mockResolvedValue({ content: 'See [[Scene: Chapter One/Opening Scene]] and [[Character: Elara]].' });
  writeNotesVault.mockResolvedValue({ path: 'Notes/Test.md', bytes: 1 });
  readVault.mockResolvedValue({ content: 'story-vault-content' });
  writeVault.mockResolvedValue({ path: 'Story/Test.md', bytes: 1 });
  entityList.mockResolvedValue({ entities: [] });
  noteBacklinks.mockResolvedValue({ backlinks: [] });
  (window as unknown as { api: unknown }).api = { readNotesVault, writeNotesVault, readVault, writeVault, entityList, noteBacklinks };
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(NOTES_DEFAULT_RICH_KEY);
});

// M17: mode switching lives in the gear "View options" popover (prototype
// gearItems). Open the menu, then pick a VIEW AS entry.
async function pickMode(label: 'Rich Text' | 'Markdown' | 'Source Mode') {
  fireEvent.click(screen.getByTestId('note-gear-btn'));
  const item = await screen.findByRole('menuitemradio', { name: label });
  // Async act: mounting the Rich editor kicks off entityList() — its promise
  // resolution must flush inside act or setupTests fails on the warning.
  await act(async () => {
    fireEvent.click(item);
  });
}

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
// M17 gear menu — Rich/Markdown/Source seg + always-open-rich toggle
// ---------------------------------------------------------------------------

describe('NoteViewer M17 gear menu', () => {
  it('offers Rich Text, Markdown, and Source Mode in the gear popover', async () => {
    render(<NoteViewer path="Notes/Test.md" />);
    await screen.findByLabelText('Edit note: Test.md');

    fireEvent.click(screen.getByTestId('note-gear-btn'));
    await screen.findByTestId('note-gear-menu');

    expect(screen.getByRole('menuitemradio', { name: 'Rich Text' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Markdown' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Source Mode' })).toBeTruthy();
    // Legacy read-only Preview is not offered in the gear (FULL-SPEC §6).
    expect(screen.queryByRole('menuitemradio', { name: /Preview/ })).toBeNull();
  });

  it('defaults to Source mode showing textarea', async () => {
    render(<NoteViewer path="Notes/Test.md" />);
    const textarea = await screen.findByLabelText('Edit note: Test.md');
    expect(textarea.tagName).toBe('TEXTAREA');
    fireEvent.click(screen.getByTestId('note-gear-btn'));
    expect(await screen.findByRole('menuitemradio', { name: 'Source Mode' })).toHaveAttribute('aria-checked', 'true');
  });

  it('switches to Markdown mode — raw file, editable, with the mode banner', async () => {
    render(<NoteViewer path="Notes/Test.md" />);
    await screen.findByLabelText('Edit note: Test.md');

    await pickMode('Markdown');

    expect(screen.getByTestId('note-mode-banner-markdown')).toBeTruthy();
    const textarea = screen.getByLabelText('Edit note: Test.md') as HTMLTextAreaElement;
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toContain('[[Character: Elara]]'); // raw file, unstripped
  });

  it('Markdown mode edits save through the same lossless raw path', async () => {
    render(<NoteViewer path="Notes/Test.md" />);
    await screen.findByLabelText('Edit note: Test.md');
    await pickMode('Markdown');

    fireEvent.change(screen.getByLabelText('Edit note: Test.md'), { target: { value: 'raw edit' } });
    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith('Notes/Test.md', 'raw edit'));
  });

  it('calls onModeChange when mode switches', async () => {
    const onModeChange = vi.fn();
    render(<NoteViewer path="Notes/Test.md" onModeChange={onModeChange} />);
    await screen.findByLabelText('Edit note: Test.md');

    await pickMode('Markdown');

    expect(onModeChange).toHaveBeenCalledWith('markdown');
  });

  it('legacy onPreviewModeChange fires with false when leaving Preview via the gear', async () => {
    const onPreviewModeChange = vi.fn();
    render(<NoteViewer path="Notes/Test.md" previewMode onPreviewModeChange={onPreviewModeChange} />);
    await screen.findByTestId('note-viewer-preview');

    await pickMode('Source Mode');

    expect(onPreviewModeChange).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId('note-viewer-preview')).toBeNull();
  });

  it('honours previewMode=true legacy prop by starting in Preview mode', async () => {
    render(<NoteViewer path="Notes/Test.md" previewMode />);
    await waitFor(() => expect(readNotesVault).toHaveBeenCalled());
    await screen.findByTestId('note-viewer-preview');
    expect(screen.queryByLabelText('Edit note: Test.md')).toBeNull();
  });

  it('"Always open notes in Rich view" toggle persists and opens the next note in Rich', async () => {
    const { unmount } = render(<NoteViewer path="Notes/Test.md" />);
    await screen.findByLabelText('Edit note: Test.md');

    fireEvent.click(screen.getByTestId('note-gear-btn'));
    const toggle = await screen.findByTestId('note-default-rich-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem(NOTES_DEFAULT_RICH_KEY)).toBe('1');
    unmount();

    // A freshly-opened note now starts in Rich mode.
    render(<NoteViewer path="Notes/Other.md" />);
    await waitFor(() => expect(document.querySelector('.note-rich-editor .ProseMirror')).not.toBeNull());
    expect(screen.queryByLabelText('Edit note: Other.md')).toBeNull();
  });

  it('always-rich pref falls back to Source (no modal) when the note is lossy — CF-11', async () => {
    window.localStorage.setItem(NOTES_DEFAULT_RICH_KEY, '1');
    readNotesVault.mockResolvedValue({ content: '| A | B |\n|---|---|\n| 1 | 2 |' });

    render(<NoteViewer path="Notes/Table.md" />);

    // Lands in Source with no fidelity dialog: lossy files are never fed to Rich silently.
    const textarea = await screen.findByLabelText('Edit note: Table.md');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(screen.queryByRole('dialog')).toBeNull();
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

    await pickMode('Rich Text');

    await screen.findByRole('dialog', { name: 'Rich mode may lose content' });
    expect(screen.getByText(/Markdown tables/i)).toBeTruthy();
  });

  it('does NOT raise the guard for YAML frontmatter — W0.2 preserves it verbatim outside Rich mode', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntitle: My Note\n---\nContent.' });
    render(<NoteViewer path="Notes/Frontmatter.md" />);
    await screen.findByLabelText('Edit note: Frontmatter.md');

    await pickMode('Rich Text');

    // Switched straight into Rich mode — no dialog, no textarea.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Edit note: Frontmatter.md')).toBeNull();
  });

  it('still raises the guard for lossy features in the display body (tables under frontmatter)', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntitle: T\n---\n| A | B |\n|---|---|\n| 1 | 2 |' });
    render(<NoteViewer path="Notes/FmTable.md" />);
    await screen.findByLabelText('Edit note: FmTable.md');

    await pickMode('Rich Text');

    await screen.findByRole('dialog', { name: 'Rich mode may lose content' });
    expect(screen.getByText(/Markdown tables/i)).toBeTruthy();
    expect(screen.queryByText(/YAML frontmatter/i)).toBeNull();
  });

  it('"Edit in Source" closes the warning and stays in Source mode', async () => {
    readNotesVault.mockResolvedValue({ content: '| A | B |\n|---|---|\n| 1 | 2 |' });
    render(<NoteViewer path="Notes/Table.md" />);
    await screen.findByLabelText('Edit note: Table.md');

    await pickMode('Rich Text');
    await screen.findByRole('dialog', { name: 'Rich mode may lose content' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit in Source (safe)' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Edit note: Table.md')).toBeTruthy();
  });

  it('"Open in Rich anyway" dismisses the warning and enters Rich mode', async () => {
    readNotesVault.mockResolvedValue({ content: '| A | B |\n|---|---|\n| 1 | 2 |' });
    render(<NoteViewer path="Notes/Table.md" />);
    await screen.findByLabelText('Edit note: Table.md');

    await pickMode('Rich Text');
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

    await pickMode('Rich Text');

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

// ---------------------------------------------------------------------------
// W0.2 (Beta 4, FULL-SPEC §6): frontmatter NEVER renders in Rich/Preview views
// ---------------------------------------------------------------------------

// GAP-REPORT-v2 P0#2 fixture: an Obsidian-Kanban board.md whose plugin
// frontmatter rendered as a giant bold heading in Rich mode.
const KANBAN_BOARD = [
  '---',
  'kanban-plugin: board',
  'mythos-board-version: 1',
  'story-id: 3f6a804a-aaaa-bbbb-cccc-000000000000',
  '---',
  '',
  '## To Do',
  '',
  '- [ ] Draft the flood scene',
  '',
  '%% kanban:settings',
  '```json',
  '{"kanban-plugin":"board"}',
  '```',
  '%%',
].join('\n');

describe('NoteViewer W0.2 — frontmatter never renders in Rich/Preview', () => {
  it('Rich mode renders a kanban board file without frontmatter or settings text', async () => {
    readNotesVault.mockResolvedValue({ content: KANBAN_BOARD });
    render(<NoteViewer path="Notes/board.md" />);
    await screen.findByLabelText('Edit note: board.md');

    await pickMode('Rich Text');

    const rich = await waitFor(() => {
      const el = document.querySelector('.note-rich-editor .ProseMirror');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => expect(rich.textContent).toContain('Draft the flood scene'));
    expect(rich.textContent).not.toContain('kanban-plugin');
    expect(rich.textContent).not.toContain('mythos-board-version');
    expect(rich.textContent).not.toContain('story-id');
    expect(rich.textContent).not.toContain('kanban:settings');
  });

  it('saving from Rich mode without edits preserves the raw file byte-for-byte', async () => {
    readNotesVault.mockResolvedValue({ content: KANBAN_BOARD });
    writeNotesVault.mockClear();
    render(<NoteViewer path="Notes/board.md" />);
    await screen.findByLabelText('Edit note: board.md');

    await pickMode('Rich Text');
    await waitFor(() => expect(document.querySelector('.note-rich-editor .ProseMirror')).not.toBeNull());

    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });

    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith('Notes/board.md', KANBAN_BOARD));
  });

  it('Preview mode strips frontmatter and the kanban settings block', async () => {
    readNotesVault.mockResolvedValue({ content: KANBAN_BOARD });
    render(<NoteViewer path="Notes/board.md" previewMode />);

    const preview = await screen.findByTestId('note-viewer-preview');
    expect(preview.textContent).toContain('Draft the flood scene');
    expect(preview.textContent).not.toContain('kanban-plugin');
    expect(preview.textContent).not.toContain('story-id');
    expect(preview.textContent).not.toContain('kanban:settings');
  });

  it('Source mode keeps showing the raw file including frontmatter', async () => {
    readNotesVault.mockResolvedValue({ content: KANBAN_BOARD });
    render(<NoteViewer path="Notes/board.md" />);

    const textarea = await screen.findByLabelText('Edit note: board.md');
    expect(textarea).toHaveValue(KANBAN_BOARD);
  });

  it('an unterminated frontmatter fence renders as body — nothing is swallowed', async () => {
    const raw = '---\ntitle: Oops no closing fence\n\nThis paragraph must stay visible.';
    readNotesVault.mockResolvedValue({ content: raw });
    render(<NoteViewer path="Notes/unterminated.md" previewMode />);

    const preview = await screen.findByTestId('note-viewer-preview');
    expect(preview.textContent).toContain('This paragraph must stay visible.');
    expect(preview.textContent).toContain('title: Oops no closing fence');
  });

  it('handles \\r\\n frontmatter in Preview mode', async () => {
    const raw = '---\r\nkanban-plugin: board\r\n---\r\nBoard body text.\r\n';
    readNotesVault.mockResolvedValue({ content: raw });
    render(<NoteViewer path="Notes/crlf.md" previewMode />);

    const preview = await screen.findByTestId('note-viewer-preview');
    expect(preview.textContent).toContain('Board body text.');
    expect(preview.textContent).not.toContain('kanban-plugin');
  });
});

// ---------------------------------------------------------------------------
// M17: editable Lora title + tag chips (frontmatter-backed, W0.2 engine)
// ---------------------------------------------------------------------------

describe('NoteViewer M17 title + tags header', () => {
  it('shows the frontmatter title, falling back to the file stem', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntitle: The Sunken Gate\n---\nBody.' });
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');
    expect(screen.getByTestId('note-title').textContent).toBe('The Sunken Gate');

    cleanup();
    readNotesVault.mockResolvedValue({ content: 'No frontmatter here.' });
    render(<NoteViewer path="Notes/Plain Note.md" />);
    await screen.findByLabelText('Edit note: Plain Note.md');
    expect(screen.getByTestId('note-title').textContent).toBe('Plain Note');
  });

  it('committing an edited title writes the title: frontmatter field and saves', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntitle: Old Title\n---\nBody.' });
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');

    const title = screen.getByTestId('note-title');
    title.textContent = 'New Title';
    await act(async () => {
      fireEvent.blur(title);
    });

    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith(
      'Notes/gate.md',
      '---\ntitle: New Title\n---\nBody.',
    ));
    // Source mode keeps showing the raw file including the new frontmatter.
    expect(screen.getByLabelText('Edit note: gate.md')).toHaveValue('---\ntitle: New Title\n---\nBody.');
  });

  it('creates a frontmatter block when a title is committed on a bare note', async () => {
    readNotesVault.mockResolvedValue({ content: 'Just prose.' });
    render(<NoteViewer path="Notes/bare.md" />);
    await screen.findByLabelText('Edit note: bare.md');

    const title = screen.getByTestId('note-title');
    title.textContent = 'Named Now';
    await act(async () => {
      fireEvent.blur(title);
    });

    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith(
      'Notes/bare.md',
      '---\ntitle: Named Now\n---\n\nJust prose.',
    ));
  });

  it('an emptied title reverts instead of saving (prototype noteTitleEdit)', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntitle: Keep Me\n---\nBody.' });
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');

    const title = screen.getByTestId('note-title');
    title.textContent = '   ';
    await act(async () => {
      fireEvent.blur(title);
    });

    expect(writeNotesVault).not.toHaveBeenCalled();
    expect(screen.getByTestId('note-title').textContent).toBe('Keep Me');
  });

  it('renders frontmatter tags as chips and adds one through the add input', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntags: [location, ruins]\n---\nBody.' });
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');

    expect(screen.getByTestId('note-header-tag-location')).toBeTruthy();
    expect(screen.getByTestId('note-header-tag-ruins')).toBeTruthy();

    const input = screen.getByTestId('note-add-tag-input');
    fireEvent.change(input, { target: { value: 'ancient' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith(
      'Notes/gate.md',
      '---\ntags: [location, ruins, ancient]\n---\nBody.',
    ));
    expect(screen.getByTestId('note-header-tag-ancient')).toBeTruthy();
  });

  it('removes a tag from its chip ×', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntags: [location, ruins]\n---\nBody.' });
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove tag ruins' }));
    });

    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith(
      'Notes/gate.md',
      '---\ntags: [location]\n---\nBody.',
    ));
    expect(screen.queryByTestId('note-header-tag-ruins')).toBeNull();
  });

  it('duplicate or empty tags are ignored', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntags: [location]\n---\nBody.' });
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');

    const input = screen.getByTestId('note-add-tag-input');
    fireEvent.change(input, { target: { value: 'location' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    fireEvent.change(input, { target: { value: '   ' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(writeNotesVault).not.toHaveBeenCalled();
  });

  it('title and tags never leak into the Rich body (frontmatter stays hidden — W0.2)', async () => {
    readNotesVault.mockResolvedValue({ content: '---\ntitle: Gate\ntags: [location]\n---\nOnly this body.' });
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');

    await pickMode('Rich Text');

    const rich = await waitFor(() => {
      const el = document.querySelector('.note-rich-editor .ProseMirror');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => expect(rich.textContent).toContain('Only this body.'));
    expect(rich.textContent).not.toContain('title:');
    expect(rich.textContent).not.toContain('tags:');
  });
});

// ---------------------------------------------------------------------------
// M17: callout cards + links block in Rich mode, byte-lossless round-trip
// ---------------------------------------------------------------------------

describe('NoteViewer M17 rich body blocks', () => {
  const GATE_NOTE = [
    '---',
    'type: location',
    'danger: high',
    '---',
    'An ancient floodgate built by a lost civilization.',
    '',
    '> [!legend]',
    '> Sailors speak of a hum that rises from the depths on still nights.',
    '',
    '## Architecture',
    '',
    '- Massive stone arches encrusted with coral',
    '- Gate mechanisms of unknown metal',
    '',
    '## Linked Notes',
    '',
    '[[The Great Deep]] · [[Drownlight]] · [[Tide Mechanics]]',
  ].join('\n');

  it('renders the simple callout as a purple card (no fidelity guard)', async () => {
    readNotesVault.mockResolvedValue({ content: GATE_NOTE });
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');

    await pickMode('Rich Text');

    // The simple callout shape is lossless now — no guard dialog.
    expect(screen.queryByRole('dialog')).toBeNull();
    const callout = await waitFor(() => {
      const el = document.querySelector('.note-rich-editor [data-note-callout]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(callout.getAttribute('data-callout-title')).toBe('legend');
    expect(callout.textContent).toContain('Sailors speak of a hum');
  });

  it('marks the links row as a links block and keeps H2s/bullets editable blocks', async () => {
    readNotesVault.mockResolvedValue({ content: GATE_NOTE });
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');

    await pickMode('Rich Text');

    await waitFor(() => {
      expect(document.querySelector('.note-rich-editor p.note-links-block')).not.toBeNull();
    });
    const rich = document.querySelector('.note-rich-editor .ProseMirror') as HTMLElement;
    expect(rich.querySelector('h2')).not.toBeNull();
    expect(rich.querySelector('ul li')).not.toBeNull();
    expect(rich.getAttribute('contenteditable')).toBe('true');
  });

  it('CF-11: saving from Rich mode without edits keeps the file byte-identical (callout note)', async () => {
    readNotesVault.mockResolvedValue({ content: GATE_NOTE });
    writeNotesVault.mockClear();
    render(<NoteViewer path="Notes/gate.md" />);
    await screen.findByLabelText('Edit note: gate.md');

    await pickMode('Rich Text');
    await waitFor(() => expect(document.querySelector('.note-rich-editor .ProseMirror')).not.toBeNull());

    await act(async () => {
      window.dispatchEvent(new Event('mythos:save-note'));
    });

    await waitFor(() => expect(writeNotesVault).toHaveBeenCalledWith('Notes/gate.md', GATE_NOTE));
  });
});

// ---------------------------------------------------------------------------
// M17: backlinks footer (note body, not the right panel)
// ---------------------------------------------------------------------------

describe('NoteViewer M17 backlinks footer', () => {
  const STORIES = [
    {
      id: 'story-1',
      title: 'The Last City',
      path: 'stories/last-city',
      chapters: [
        {
          id: 'ch-1',
          title: 'Chapter One',
          path: 'stories/last-city/ch-1',
          scenes: [
            {
              id: 'scene-1',
              title: 'Into the Undercity',
              path: 'stories/last-city/ch-1/scene-1.md',
              blocks: [{ id: 'b1', type: 'paragraph', content: 'Mira reached [[Test]] at dusk.' }],
            },
          ],
        },
      ],
    },
  ] as unknown as import('./types').Story[];

  it('renders the footer with note + story backlinks when wired', async () => {
    noteBacklinks.mockResolvedValue({
      backlinks: [{ path: 'Notes/Other.md', name: 'Other', snippet: '…links to [[Test]]…' }],
    });
    render(
      <NoteViewer
        path="Notes/Test.md"
        stories={STORIES}
        onOpenBacklinkNote={vi.fn()}
        onOpenBacklinkScene={vi.fn()}
      />,
    );
    await screen.findByLabelText('Edit note: Test.md');

    const footer = await screen.findByTestId('note-backlinks-footer');
    expect(footer).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('note-backlinks-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('note-backlink-Notes/Other.md')).toBeTruthy();
    expect(screen.getByTestId('story-backlink-scene-1')).toBeTruthy();
  });

  it('clicking a backlink routes through the wired handlers', async () => {
    noteBacklinks.mockResolvedValue({
      backlinks: [{ path: 'Notes/Other.md', name: 'Other', snippet: '…' }],
    });
    const onOpenNote = vi.fn();
    const onOpenScene = vi.fn();
    render(
      <NoteViewer
        path="Notes/Test.md"
        stories={STORIES}
        onOpenBacklinkNote={onOpenNote}
        onOpenBacklinkScene={onOpenScene}
      />,
    );
    await screen.findByTestId('note-backlinks-footer');

    fireEvent.click(await screen.findByTestId('note-backlink-Notes/Other.md'));
    expect(onOpenNote).toHaveBeenCalledWith('Notes/Other.md');

    fireEvent.click(screen.getByTestId('story-backlink-scene-1'));
    expect(onOpenScene).toHaveBeenCalled();
  });

  it('renders no footer when the backlink wiring is absent (story-side viewer)', async () => {
    render(<NoteViewer path="Notes/Test.md" />);
    await screen.findByLabelText('Edit note: Test.md');
    expect(screen.queryByTestId('note-backlinks-footer')).toBeNull();
  });
});
