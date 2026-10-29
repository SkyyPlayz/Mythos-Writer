// #1765 — Settings → Vault & Files "Import your writing": drop zone + pickers
// → preview (story / notes / entities / formatted excerpt) → commit → done.
// window.api.importHub is mocked; the main-side pipeline has its own suites.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, createEvent, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import ImportSection, { renderInlineMarkdown, excerptParagraphs, SPENT_PREVIEW_ERRORS } from './ImportSection';
import type {
  ImportCommitResult,
  ImportPreview,
  ImportPreviewResult,
} from '../../../importHubTypes';

// vitest-axe@0.1.0 ships a legacy `Vi.Assertion` augmentation that vitest 3 no
// longer reads for matcher typing (same setup as accessibility.test.tsx).
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
expect.extend(axeMatchers);
const axe = configureAxe({
  rules: {
    // colour-contrast requires computed styles unavailable in jsdom — skip
    'color-contrast': { enabled: false },
  },
});

function makePreview(over: Partial<ImportPreview> = {}): ImportPreview {
  return {
    token: 'tok-1',
    source: { kind: 'docx', label: 'Word document', name: 'The Last City.docx' },
    story: {
      title: 'The Last City',
      structure: 'headings',
      partCount: 0,
      words: 12345,
      chapters: [
        {
          title: 'Chapter One: The Gate',
          words: 5000,
          scenes: [
            { title: 'Arrival', words: 2000 },
            { title: 'The Watchman', words: 3000 },
          ],
        },
        {
          title: 'Chapter Two: Ash',
          words: 7345,
          scenes: [{ title: 'Embers', words: 7345 }],
        },
      ],
      excerpt: 'The gate was **shut** and the wind was *cold*.\n\nShe said \\*nothing\\* &amp; waited.',
    },
    notes: [{ title: 'World notes', folder: '' }],
    entities: [
      { title: 'Mara', type: 'character' },
      { title: 'Tomas', type: 'character' },
      { title: 'The Spire', type: 'location' },
    ],
    warnings: ['2 images were skipped.'],
    canCommit: true,
    ...over,
  };
}

const OK_COMMIT: ImportCommitResult = {
  ok: true,
  storyTitle: 'The Last City',
  chapterCount: 2,
  sceneCount: 3,
  noteCount: 1,
  entityCount: 3,
  planNotePath: 'Plans/The Last City — Story Plan.md',
  warnings: ['One footnote became plain text.'],
};

const mockPick = vi.fn<(mode: 'file' | 'folder') => Promise<ImportPreviewResult>>();
const mockPreviewDropped = vi.fn<(file: File) => Promise<ImportPreviewResult>>();
const mockCommit = vi.fn<(token: string, options?: { story?: boolean; notes?: boolean }) => Promise<ImportCommitResult>>();

function installApi(withHub = true) {
  Object.defineProperty(window, 'api', {
    value: withHub
      ? { importHub: { pick: mockPick, previewDropped: mockPreviewDropped, commit: mockCommit } }
      : {},
    writable: true,
    configurable: true,
  });
}

function deferred<T>() {
  let resolveFn!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolveFn = r; });
  return { promise, resolve: resolveFn };
}

async function setup(props: { activeVaultRoot?: string; activeVaultName?: string } = {}) {
  let utils!: ReturnType<typeof render>;
  await act(async () => { utils = render(<ImportSection {...props} />); });
  return utils;
}

function dragOverOn(target: Element | Document, types: string[] = ['Files']) {
  const ev = createEvent.dragOver(target, { dataTransfer: { types, dropEffect: 'copy' } }) as DragEvent;
  fireEvent(target, ev);
  return ev;
}

function fileDrop(target: HTMLElement, files: File[]) {
  const ev = createEvent.drop(target, { dataTransfer: { files, types: ['Files'] } });
  fireEvent(target, ev);
  return ev;
}

async function showPreview(preview: ImportPreview = makePreview()) {
  mockPick.mockResolvedValueOnce({ ok: true, preview });
  await act(async () => { fireEvent.click(screen.getByTestId('import-pick-file')); });
  return screen.findByTestId('import-preview');
}

beforeEach(() => {
  mockPick.mockReset();
  mockPreviewDropped.mockReset();
  mockCommit.mockReset();
  installApi(true);
});

afterEach(() => {
  document.querySelectorAll('[data-testid="ln-toast"]').forEach((n) => n.remove());
});

describe('ImportSection (#1765)', () => {
  it('renders the section card, the drop zone and both native pick buttons', async () => {
    await setup();
    const section = screen.getByRole('region', { name: 'Import your writing' });
    expect(section).toHaveAttribute('data-settings-cat', 'vaults');
    expect(screen.getByText(/You'll see a preview before anything is saved\./)).toBeInTheDocument();
    expect(screen.getByText('Drop a file or folder here')).toBeInTheDocument();
    const file = screen.getByRole('button', { name: 'Choose a file…' });
    const folder = screen.getByRole('button', { name: 'Choose a folder…' });
    expect(file).toHaveClass('m24-btn', 'm24-btn--primary');
    expect(folder).toHaveClass('m24-btn');
    expect(file).toBeEnabled();
    expect(folder).toBeEnabled();
    // Repo ARIA rule: the drop zone is a plain div — no role, no aria-label.
    const zone = screen.getByTestId('import-dropzone');
    expect(zone).not.toHaveAttribute('role');
    expect(zone).not.toHaveAttribute('aria-label');
  });

  it('pick buttons call importHub.pick with file / folder', async () => {
    mockPick.mockResolvedValue({ ok: false, cancelled: true });
    await setup();
    await act(async () => { fireEvent.click(screen.getByTestId('import-pick-file')); });
    expect(mockPick).toHaveBeenLastCalledWith('file');
    await act(async () => { fireEvent.click(screen.getByTestId('import-pick-folder')); });
    expect(mockPick).toHaveBeenLastCalledWith('folder');
    expect(mockPick).toHaveBeenCalledTimes(2);
    // A dismissed picker is silent.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });

  it('dragover and drop always preventDefault (Electron would navigate to the file) and the drop previews the File', async () => {
    const d = deferred<ImportPreviewResult>();
    mockPreviewDropped.mockReturnValue(d.promise);
    await setup();
    const zone = screen.getByTestId('import-dropzone');

    const over = createEvent.dragOver(zone, { dataTransfer: { types: ['Files'], dropEffect: 'none' } });
    fireEvent(zone, over);
    expect(over.defaultPrevented).toBe(true);

    const file = new File(['hello'], 'My Book.docx');
    const drop = fileDrop(zone, [file]);
    expect(drop.defaultPrevented).toBe(true);
    expect(mockPreviewDropped).toHaveBeenCalledTimes(1);
    expect(mockPreviewDropped).toHaveBeenCalledWith(file);

    // Busy: polite status names the file, buttons are disabled.
    expect(screen.getByRole('status')).toHaveTextContent('Reading My Book.docx…');
    expect(screen.getByTestId('import-pick-file')).toBeDisabled();
    expect(screen.getByTestId('import-pick-folder')).toBeDisabled();

    await act(async () => { d.resolve({ ok: true, preview: makePreview() }); });
    expect(await screen.findByTestId('import-preview')).toBeInTheDocument();
    expect(screen.getByTestId('import-status')).toHaveTextContent('');
    expect(screen.getByTestId('import-pick-file')).toBeEnabled();
  });

  it('dragover/drop still preventDefault when the bridge is missing', async () => {
    installApi(false);
    await setup();
    const zone = screen.getByTestId('import-dropzone');
    const over = createEvent.dragOver(zone, { dataTransfer: { types: ['Files'] } });
    fireEvent(zone, over);
    expect(over.defaultPrevented).toBe(true);
    const drop = fileDrop(zone, [new File(['x'], 'a.docx')]);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('a near miss on the section (heading, preview panel) is swallowed, not opened by the browser', async () => {
    await setup();
    await showPreview();
    for (const target of [screen.getByRole('heading', { name: 'Import your writing' }), screen.getByTestId('import-preview')]) {
      const over = dragOverOn(target);
      expect(over.defaultPrevented).toBe(true);
      // Not a drop target: the cursor says so.
      expect(over.dataTransfer?.dropEffect).toBe('none');
      const drop = fileDrop(target, [new File(['<script>x</script>'], 'Book.html')]);
      expect(drop.defaultPrevented).toBe(true);
    }
    // Only the zone starts a preview.
    expect(mockPreviewDropped).not.toHaveBeenCalled();
    // The zone itself still accepts the drop.
    expect(dragOverOn(screen.getByTestId('import-dropzone')).dataTransfer?.dropEffect).toBe('copy');
  });

  it('while mounted, a file dropped anywhere else in the window cannot navigate it; text drags and unmount are untouched', async () => {
    const { unmount } = await setup();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    expect(dragOverOn(outside).defaultPrevented).toBe(true);
    expect(fileDrop(outside, [new File(['x'], 'Book.html')]).defaultPrevented).toBe(true);
    // A text / tab drag keeps its normal behaviour.
    expect(dragOverOn(outside, ['text/plain']).defaultPrevented).toBe(false);
    unmount();
    expect(dragOverOn(outside).defaultPrevented).toBe(false);
    outside.remove();
  });

  it('drag-enter counter keeps the active state across nested children', async () => {
    await setup();
    const zone = screen.getByTestId('import-dropzone');
    const child = screen.getByText('Drop a file or folder here');
    const dt = { types: ['Files'] };
    fireEvent.dragEnter(zone, { dataTransfer: dt });
    expect(zone).toHaveClass('import-dropzone--active');
    fireEvent.dragEnter(child, { dataTransfer: dt });
    fireEvent.dragLeave(zone, { dataTransfer: dt }); // leaving the zone into the child
    expect(zone).toHaveClass('import-dropzone--active');
    fireEvent.dragLeave(child, { dataTransfer: dt });
    expect(zone).not.toHaveClass('import-dropzone--active');
  });

  it('multiple dropped items: imports the first and says so', async () => {
    mockPreviewDropped.mockResolvedValue({ ok: true, preview: makePreview() });
    await setup();
    const a = new File(['a'], 'first.docx');
    const b = new File(['b'], 'second.docx');
    await act(async () => { fileDrop(screen.getByTestId('import-dropzone'), [a, b]); });
    expect(mockPreviewDropped).toHaveBeenCalledTimes(1);
    expect(mockPreviewDropped).toHaveBeenCalledWith(a);
    expect(screen.getByTestId('import-multi-hint')).toHaveTextContent('One at a time — importing the first item.');
  });

  it('preview shows source, story title, structure, totals, chapters with scenes, notes and grouped entities', async () => {
    await setup();
    const preview = await showPreview();
    const p = within(preview);
    expect(p.getByRole('heading', { name: 'Preview — nothing is saved yet' })).toBeInTheDocument();
    expect(p.getByTestId('import-preview-source')).toHaveTextContent('Word document · The Last City.docx');
    expect(p.getByTestId('import-story-title')).toHaveTextContent('The Last City');
    expect(p.getByTestId('import-structure')).toHaveTextContent('Chapters found from your headings');
    expect(p.getByTestId('import-totals')).toHaveTextContent(
      `2 chapters · 3 scenes · ${(12345).toLocaleString()} words`,
    );

    const chapters = p.getByTestId('import-chapters');
    const rows = within(chapters).getAllByRole('listitem').filter((li) => li.classList.contains('import-chapter'));
    expect(rows).toHaveLength(2);
    // Native <details>/<summary> per chapter.
    expect(rows[0].querySelector('details > summary')).toHaveTextContent('Chapter One: The Gate');
    expect(rows[0]).toHaveTextContent('Arrival');
    expect(rows[0]).toHaveTextContent('The Watchman');
    expect(rows[0]).toHaveTextContent(`${(3000).toLocaleString()} words`);
    expect(rows[1]).toHaveTextContent('Embers');

    expect(p.getByTestId('import-preview-notes')).toHaveTextContent('Notes · 1');
    expect(p.getByTestId('import-preview-notes')).toHaveTextContent('World notes');
    expect(p.getByTestId('import-entities-character')).toHaveTextContent('Characters · 2');
    expect(p.getByTestId('import-entities-character')).toHaveTextContent('Mara, Tomas');
    expect(p.getByTestId('import-entities-location')).toHaveTextContent('Locations · 1');
    expect(p.getByTestId('import-preview-warnings')).toHaveTextContent('2 images were skipped.');
    // Both halves exist → both checkboxes, checked by default.
    expect(p.getByRole('checkbox', { name: 'Import the manuscript' })).toBeChecked();
    expect(p.getByRole('checkbox', { name: 'Import notes & characters' })).toBeChecked();
    // Focus moves to the preview heading.
    expect(p.getByRole('heading', { name: 'Preview — nothing is saved yet' })).toHaveFocus();
  });

  it.each([
    ['patterns', 'Chapters found from lines like “Chapter One”'],
    ['pagebreaks', 'Chapters found from page breaks'],
    ['binder', 'Chapters from your Scrivener binder'],
    ['files', 'One chapter per file'],
    ['none', 'No chapters found — it will come in as one chapter you can split later'],
  ] as const)('structure %s is explained in plain words', async (structure, text) => {
    await setup();
    const base = makePreview();
    await showPreview({ ...base, story: { ...base.story!, structure } });
    expect(screen.getByTestId('import-structure')).toHaveTextContent(text);
  });

  it('excerpt renders bold / italic as elements — no raw markers or escapes visible', async () => {
    await setup();
    await showPreview();
    const ex = screen.getByTestId('import-excerpt');
    const strong = ex.querySelector('strong');
    const em = ex.querySelector('em');
    expect(strong).toHaveTextContent('shut');
    expect(em).toHaveTextContent('cold');
    expect(ex.textContent).not.toContain('**');
    expect(ex.textContent).not.toContain('\\');
    expect(ex.textContent).not.toContain('&amp;');
    // Escaped asterisks are literal text, not italics.
    expect(ex).toHaveTextContent('She said *nothing* & waited.');
    expect(ex.querySelectorAll('em')).toHaveLength(1);
    expect(ex.querySelectorAll('p.import-excerpt__p')).toHaveLength(2);
  });

  it('a cut-off excerpt (ends with “…”) keeps a mark open at the cut; markers in earlier paragraphs follow the editor', async () => {
    await setup();
    const base = makePreview();
    await showPreview({ ...base, story: { ...base.story!, excerpt: 'Stray **marker here.\n\nHe was **very tired and…' } });
    const paras = screen.getByTestId('import-excerpt').querySelectorAll('p.import-excerpt__p');
    expect(paras[0].innerHTML).toBe('Stray **marker here.');
    expect(paras[1].innerHTML).toBe('He was <strong>very tired and…</strong>');
  });

  it('notes list shows the first 8 titles and “and N more”', async () => {
    await setup();
    const notes = Array.from({ length: 11 }, (_, i) => ({ title: `Note ${i + 1}`, folder: '' }));
    await showPreview(makePreview({ notes }));
    const block = screen.getByTestId('import-preview-notes');
    expect(block).toHaveTextContent('Notes · 11');
    expect(within(block).getAllByRole('listitem')).toHaveLength(8);
    expect(block).toHaveTextContent('Note 8');
    expect(block).not.toHaveTextContent('Note 9');
    expect(block).toHaveTextContent('and 3 more');
  });

  it('a refused (dangerous) source shows the import-refused alert with the reason', async () => {
    mockPreviewDropped.mockResolvedValue({ ok: false, refused: true, reason: 'This is a program (.exe).', name: 'setup.exe' });
    await setup();
    await act(async () => { fileDrop(screen.getByTestId('import-dropzone'), [new File(['MZ'], 'setup.exe')]); });
    const alert = await screen.findByTestId('import-refused');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveClass('settings-error-msg');
    expect(alert).toHaveTextContent('This is a program (.exe).');
    expect(alert).toHaveTextContent('Mythos never opens programs, scripts or macro files.');
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });

  it('a refusal that is not about runnable content gets no "programs" line', async () => {
    const reason = 'This file unpacks to more than Mythos will safely open (over 10,000 parts or 200 MB). It may be damaged or unsafe.';
    mockPreviewDropped.mockResolvedValue({ ok: false, refused: true, reason });
    await setup();
    await act(async () => { fileDrop(screen.getByTestId('import-dropzone'), [new File(['PK'], 'Huge.docx')]); });
    const alert = await screen.findByTestId('import-refused');
    expect(alert.textContent).toBe(reason);
    expect(alert).not.toHaveTextContent('programs');
  });

  it.each([
    'Mythos never opens .exe files — they can run code on your computer. Import a document instead (Word, Markdown, ePub, RTF or plain text).',
    'This file is really a script that can run code, not a document. Mythos won\'t open it.',
    'This file contains macros, which can run code on your computer. Open it in Word, Save As a plain .docx (Word Document), then import that.',
  ])('a program / script / macro refusal adds the reassurance: %s', async (reason) => {
    mockPick.mockResolvedValue({ ok: false, refused: true, reason });
    await setup();
    await act(async () => { fireEvent.click(screen.getByTestId('import-pick-file')); });
    expect(await screen.findByTestId('import-refused')).toHaveTextContent(
      `${reason} Mythos never opens programs, scripts or macro files.`,
    );
  });

  it('an unreadable / unsupported source shows the import-error alert', async () => {
    mockPick.mockResolvedValue({ ok: false, refused: false, error: 'This file type is not supported yet.' });
    await setup();
    await act(async () => { fireEvent.click(screen.getByTestId('import-pick-file')); });
    const alert = await screen.findByTestId('import-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('This file type is not supported yet.');
    expect(screen.queryByTestId('import-refused')).not.toBeInTheDocument();
  });

  it('a rejected bridge promise surfaces as import-error, not a crash', async () => {
    mockPick.mockRejectedValue(new Error('IPC exploded'));
    await setup();
    await act(async () => { fireEvent.click(screen.getByTestId('import-pick-file')); });
    expect(await screen.findByTestId('import-error')).toHaveTextContent('IPC exploded');
    expect(screen.getByTestId('import-pick-file')).toBeEnabled();
  });

  it('Import commits the previewed token with both halves and shows the done state + toast', async () => {
    mockCommit.mockResolvedValue(OK_COMMIT);
    await setup();
    await showPreview();
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    expect(mockCommit).toHaveBeenCalledWith('tok-1', { story: true, notes: true });
    const done = await screen.findByTestId('import-done');
    expect(done).toHaveAttribute('role', 'status');
    expect(done).toHaveAttribute('aria-live', 'polite');
    expect(done).toHaveTextContent(
      'Imported “The Last City” — 2 chapters, 3 scenes, 1 note, 3 characters & places',
    );
    expect(screen.getByTestId('import-plan-note')).toHaveTextContent(
      'A Story Plan note was added to your Notes Vault (Plans/The Last City — Story Plan.md).',
    );
    expect(screen.getByTestId('import-done-warnings')).toHaveTextContent('One footnote became plain text.');
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
    expect(within(done).getByRole('heading')).toHaveFocus();
    expect(document.querySelector('[data-testid="ln-toast"]')).toHaveTextContent('Imported “The Last City”');

    // "Import something else" resets to the idle drop zone.
    fireEvent.click(screen.getByRole('button', { name: 'Import something else' }));
    expect(screen.queryByTestId('import-done')).not.toBeInTheDocument();
    expect(screen.getByTestId('import-pick-file')).toBeEnabled();
  });

  it.each([
    [[{ title: 'Mara', type: 'character' }], 1, '1 character'],
    [[{ title: 'Mara', type: 'character' }, { title: 'Tomas', type: 'character' }], 2, '2 characters'],
    [[{ title: 'The Spire', type: 'location' }], 1, '1 place'],
    [[{ title: 'The Guild', type: 'faction' }], 1, '1 entity'],
    [[{ title: 'Mara', type: 'character' }, { title: 'The Guild', type: 'faction' }], 2, '2 entities'],
  ] as const)('the success line counts entities in plain, correctly pluralised words (%#)', async (entities, entityCount, phrase) => {
    mockCommit.mockResolvedValue({ ...OK_COMMIT, noteCount: 0, entityCount });
    await setup();
    await showPreview(makePreview({ notes: [], entities: [...entities] }));
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    const done = await screen.findByTestId('import-done');
    expect(within(done).getByRole('heading').textContent).toBe(`Imported “The Last City” — 2 chapters, 3 scenes, ${phrase}`);
  });

  it('unchecking a half passes false for it; unchecking both disables Import', async () => {
    mockCommit.mockResolvedValue(OK_COMMIT);
    await setup();
    await showPreview();
    const notesBox = screen.getByRole('checkbox', { name: 'Import notes & characters' });
    const storyBox = screen.getByRole('checkbox', { name: 'Import the manuscript' });
    fireEvent.click(notesBox);
    fireEvent.click(storyBox);
    expect(screen.getByTestId('import-confirm')).toBeDisabled();
    fireEvent.click(storyBox);
    expect(screen.getByTestId('import-confirm')).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    expect(mockCommit).toHaveBeenCalledWith('tok-1', { story: true, notes: false });
  });

  it('story-only preview: no checkboxes, commits story only', async () => {
    mockCommit.mockResolvedValue({ ...OK_COMMIT, noteCount: 0, entityCount: 0, planNotePath: undefined, warnings: [] });
    await setup();
    await showPreview(makePreview({ notes: [], entities: [] }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    expect(mockCommit).toHaveBeenCalledWith('tok-1', { story: true, notes: false });
    const done = await screen.findByTestId('import-done');
    expect(done).toHaveTextContent('Imported “The Last City” — 2 chapters, 3 scenes');
    expect(done).not.toHaveTextContent('note');
    expect(screen.queryByTestId('import-plan-note')).not.toBeInTheDocument();
  });

  it('canCommit false disables Import and shows the reason', async () => {
    await setup();
    await showPreview(makePreview({ canCommit: false, commitBlockedReason: 'Open a Mythos vault first.' }));
    const confirm = screen.getByTestId('import-confirm');
    expect(confirm).toBeDisabled();
    const reason = screen.getByTestId('import-blocked-reason');
    expect(reason).toHaveTextContent('Open a Mythos vault first.');
    expect(confirm).toHaveAttribute('aria-describedby', reason.id);
    fireEvent.click(confirm);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('a retryable commit failure (nothing written, main keeps the preview) keeps it for a retry on the same token', async () => {
    // commitImportToken releases the session on commitImportPlan's ok:false
    // results (no vault, a rolled-back write), so the same token commits next time.
    mockCommit.mockResolvedValueOnce({ ok: false, error: 'Open or create a Mythos vault first (Settings → Vault & Files → New vault…).' });
    mockCommit.mockResolvedValueOnce(OK_COMMIT);
    await setup();
    await showPreview();
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    const alert = await screen.findByTestId('import-commit-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('Open or create a Mythos vault first');
    expect(screen.getByTestId('import-preview')).toBeInTheDocument();
    expect(screen.getByTestId('import-confirm')).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    expect(mockCommit).toHaveBeenCalledTimes(2);
    expect(mockCommit).toHaveBeenNthCalledWith(2, 'tok-1', { story: true, notes: true });
    expect(await screen.findByTestId('import-done')).toBeInTheDocument();
  });

  it.each(SPENT_PREVIEW_ERRORS.map((e) => [e]))('a failure that spends the preview drops it and asks for a fresh drop: %s', async (error) => {
    mockCommit.mockResolvedValue({ ok: false, error });
    await setup();
    await showPreview();
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    const alert = await screen.findByTestId('import-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(error);
    // No dead Import button left behind: back to the drop zone.
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('import-pick-file')).toBeEnabled();
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('a preview blocked for lack of a vault unblocks once a vault is opened, and names it', async () => {
    mockCommit.mockResolvedValue(OK_COMMIT);
    const reason = 'Open or create a Mythos vault first (Settings → Vault & Files → New vault…).';
    const { rerender } = await setup();
    await showPreview(makePreview({ canCommit: false, commitBlockedReason: reason }));
    expect(screen.getByTestId('import-confirm')).toBeDisabled();
    expect(screen.getByTestId('import-blocked-reason')).toHaveTextContent(reason);
    expect(screen.queryByTestId('import-destination')).not.toBeInTheDocument();

    // The writer creates + opens a vault from the cards above.
    await act(async () => { rerender(<ImportSection activeVaultRoot="/v/New Book/Story" activeVaultName="New Book" />); });
    expect(screen.getByTestId('import-confirm')).toBeEnabled();
    expect(screen.queryByTestId('import-blocked-reason')).not.toBeInTheDocument();
    expect(screen.getByTestId('import-destination')).toHaveTextContent('It will go into “New Book”.');
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    expect(mockCommit).toHaveBeenCalledWith('tok-1', { story: true, notes: true });
  });

  it('names the destination vault and warns when it was switched after the preview', async () => {
    const { rerender } = await setup({ activeVaultRoot: '/v/A/Story', activeVaultName: 'Vault A' });
    await showPreview();
    expect(screen.getByTestId('import-destination')).toHaveTextContent('It will go into “Vault A”.');
    await act(async () => { rerender(<ImportSection activeVaultRoot="/v/B/Story" activeVaultName="Vault B" />); });
    expect(screen.getByTestId('import-destination')).toHaveTextContent(
      'You switched vaults since this preview — it will go into “Vault B”.',
    );
  });

  it('a blocked preview stays blocked while the same (non-Mythos) vault is open', async () => {
    await setup({ activeVaultRoot: '/legacy', activeVaultName: 'Old' });
    await showPreview(makePreview({ canCommit: false, commitBlockedReason: 'Open a Mythos vault first.' }));
    expect(screen.getByTestId('import-confirm')).toBeDisabled();
    expect(screen.getByTestId('import-blocked-reason')).toBeInTheDocument();
    expect(screen.queryByTestId('import-destination')).not.toBeInTheDocument();
  });

  it('while committing, Import shows progress and both actions are disabled', async () => {
    const d = deferred<ImportCommitResult>();
    mockCommit.mockReturnValue(d.promise);
    await setup();
    await showPreview();
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    expect(screen.getByTestId('import-confirm')).toBeDisabled();
    expect(screen.getByTestId('import-confirm')).toHaveTextContent('Importing…');
    expect(screen.getByTestId('import-cancel')).toBeDisabled();
    // A drop mid-commit is swallowed (still preventDefault) and never previewed.
    const drop = fileDrop(screen.getByTestId('import-dropzone'), [new File(['x'], 'other.docx')]);
    expect(drop.defaultPrevented).toBe(true);
    expect(mockPreviewDropped).not.toHaveBeenCalled();
    await act(async () => { d.resolve(OK_COMMIT); });
    expect(await screen.findByTestId('import-done')).toBeInTheDocument();
  });

  it('Cancel clears the preview without committing', async () => {
    await setup();
    await showPreview();
    fireEvent.click(screen.getByTestId('import-cancel'));
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('a stale (older) preview response is ignored when a newer drop is in flight', async () => {
    const first = deferred<ImportPreviewResult>();
    const second = deferred<ImportPreviewResult>();
    mockPreviewDropped.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await setup();
    const zone = screen.getByTestId('import-dropzone');
    fileDrop(zone, [new File(['a'], 'old.docx')]);
    fileDrop(zone, [new File(['b'], 'new.docx')]);
    expect(screen.getByRole('status')).toHaveTextContent('Reading new.docx…');

    const newer = makePreview({ token: 'tok-new', story: { ...makePreview().story!, title: 'Newer Book' } });
    await act(async () => { second.resolve({ ok: true, preview: newer }); });
    expect(await screen.findByTestId('import-story-title')).toHaveTextContent('Newer Book');

    const older = makePreview({ token: 'tok-old', story: { ...makePreview().story!, title: 'Older Book' } });
    await act(async () => { first.resolve({ ok: true, preview: older }); });
    expect(screen.getByTestId('import-story-title')).toHaveTextContent('Newer Book');

    mockCommit.mockResolvedValue(OK_COMMIT);
    await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
    expect(mockCommit).toHaveBeenCalledWith('tok-new', { story: true, notes: true });
  });

  it('a stale error does not clobber a newer preview', async () => {
    const first = deferred<ImportPreviewResult>();
    mockPreviewDropped.mockReturnValueOnce(first.promise);
    mockPick.mockResolvedValueOnce({ ok: true, preview: makePreview() });
    await setup();
    fileDrop(screen.getByTestId('import-dropzone'), [new File(['a'], 'slow.docx')]);
    // Buttons are disabled while busy; a second drop is the only way in.
    mockPreviewDropped.mockResolvedValueOnce({ ok: true, preview: makePreview() });
    await act(async () => { fileDrop(screen.getByTestId('import-dropzone'), [new File(['b'], 'fast.docx')]); });
    expect(await screen.findByTestId('import-preview')).toBeInTheDocument();
    await act(async () => { first.resolve({ ok: false, refused: false, error: 'late failure' }); });
    expect(screen.queryByTestId('import-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('import-preview')).toBeInTheDocument();
  });

  it('a dismissed picker keeps the preview that was already on screen', async () => {
    await setup();
    await showPreview();
    mockPick.mockResolvedValueOnce({ ok: false, cancelled: true });
    await act(async () => { fireEvent.click(screen.getByTestId('import-pick-folder')); });
    expect(screen.getByTestId('import-preview')).toBeInTheDocument();
  });

  it('resolving after unmount is a no-op', async () => {
    const d = deferred<ImportPreviewResult>();
    mockPreviewDropped.mockReturnValue(d.promise);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = await setup();
    fileDrop(screen.getByTestId('import-dropzone'), [new File(['a'], 'a.docx')]);
    unmount();
    await act(async () => { d.resolve({ ok: true, preview: makePreview() }); });
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('bridge missing → pick buttons disabled with a hint, drops ignored', async () => {
    installApi(false);
    await setup();
    expect(screen.getByTestId('import-pick-file')).toBeDisabled();
    expect(screen.getByTestId('import-pick-folder')).toBeDisabled();
    expect(screen.getByTestId('import-unavailable')).toBeInTheDocument();
    fileDrop(screen.getByTestId('import-dropzone'), [new File(['a'], 'a.docx')]);
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('import-status')).toHaveTextContent('');
  });

  it('no window.api at all → degrades silently', async () => {
    Object.defineProperty(window, 'api', { value: undefined, writable: true, configurable: true });
    await setup();
    expect(screen.getByTestId('import-pick-file')).toBeDisabled();
    expect(screen.getByTestId('import-unavailable')).toBeInTheDocument();
  });

  describe('axe', () => {
    it('idle state has no violations', async () => {
      const { container } = await setup();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('preview state (with blocked reason and warnings) has no violations', async () => {
      const { container } = await setup();
      await showPreview(makePreview({ canCommit: false, commitBlockedReason: 'Open a Mythos vault first.' }));
      // Expand a chapter so the scene list is audited too.
      fireEvent.click(container.querySelector('summary') as HTMLElement);
      expect(await axe(container)).toHaveNoViolations();
    });

    it('done state has no violations', async () => {
      mockCommit.mockResolvedValue(OK_COMMIT);
      const { container } = await setup();
      await showPreview();
      await act(async () => { fireEvent.click(screen.getByTestId('import-confirm')); });
      await screen.findByTestId('import-done');
      expect(await axe(container)).toHaveNoViolations();
    });

    it('refused state has no violations', async () => {
      mockPick.mockResolvedValue({ ok: false, refused: true, reason: 'Macro-enabled documents are never opened.' });
      const { container } = await setup();
      await act(async () => { fireEvent.click(screen.getByTestId('import-pick-file')); });
      await screen.findByTestId('import-refused');
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('renderInlineMarkdown (excerpt converter)', () => {
  function html(src: string, opts?: { cutOff?: boolean }): string {
    const { container } = render(<p>{renderInlineMarkdown(src, opts)}</p>);
    const out = (container.firstChild as HTMLElement).innerHTML;
    container.remove();
    return out;
  }

  it('renders the editor dialect marks, nested', () => {
    expect(html('**bold** *it* ~~gone~~ <u>under</u>')).toBe(
      '<strong>bold</strong> <em>it</em> <s>gone</s> <u>under</u>',
    );
    // markdown-it nests a triple run as <em><strong>.
    expect(html('***both***')).toBe('<em><strong>both</strong></em>');
    expect(html('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>');
    expect(html('__bold__ and _it_')).toBe('<strong>bold</strong> and <em>it</em>');
  });

  it('unescapes backslash escapes and entities as literal text', () => {
    expect(html('2 \\* 3 \\_x\\_ \\[a\\] \\\\')).toBe('2 * 3 _x_ [a] \\');
    expect(html('a &lt;b&gt; &amp; &#65;')).toBe('a &lt;b&gt; &amp; A');
  });

  it('never renders HTML other than <u>: tags stay text', () => {
    expect(html('<script>alert(1)</script><img src=x>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x&gt;');
  });

  it('hard breaks become <br>, soft newlines a space', () => {
    expect(html('one\\\ntwo\nthree')).toBe('one<br>two three');
  });

  it('keeps snake_case and spaced asterisks literal', () => {
    expect(html('snake_case_name')).toBe('snake_case_name');
    expect(html('a * b * c')).toBe('a * b * c');
  });

  it('an unclosed mark from a truncated excerpt still formats the rest, without raw markers', () => {
    expect(html('He was **very tired and', { cutOff: true })).toBe('He was <strong>very tired and</strong>');
    expect(html('a ~~gone and', { cutOff: true })).toBe('a <s>gone and</s>');
    // Not cut off: an unclosed run is literal, as in the editor.
    expect(html('He was **very tired and')).toBe('He was **very tired and');
  });

  // Each expectation is markdown-it 14's renderInline output (the editor's
  // parser via tiptap-markdown, html: true), so the preview shows what the
  // editor will show — including literal markers it won't format.
  it.each([
    ['word*(aside)*', 'word*(aside)*'],
    ['Mara**"Run!"**', 'Mara**"Run!"**'],
    ['x*…*y', 'x*…*y'],
    ['*(aside)* word', '<em>(aside)</em> word'],
    ['“*quoted*”', '“<em>quoted</em>”'],
    ['**Mara**’s', '<strong>Mara</strong>’s'],
    ['*foo**bar**baz*', '<em>foo<strong>bar</strong>baz</em>'],
    ['foo_bar_', 'foo_bar_'],
    ['_foo_bar', '_foo_bar'],
    ['__a__b', '__a__b'],
    ['~~~a~~', '~<s>a</s>'],
    ['a~b~c', 'a~b~c'],
    ['*a ~~b* c~~', '<em>a ~~b</em> c~~'],
    // Serializer output whose reopened delimiter follows a space: the editor
    // shows those markers literally, so the preview must too.
    ['She thought, ***Never**** again.*', 'She thought, <em><strong>Never</strong></em>* again.*'],
    ['The **~~old~~**~~ house~~', 'The <strong><s>old</s></strong>~~ house~~'],
  ])('follows CommonMark flanking like the editor: %s', (src, expected) => {
    expect(html(src)).toBe(expected);
  });
});

describe('excerptParagraphs', () => {
  it('splits on blank lines, strips alignment suffixes and heading hashes', () => {
    expect(excerptParagraphs('#### Interlude\n\nCentered. {.center}\n\n\nPlain\nwrapped.')).toEqual([
      { text: 'Interlude', align: undefined, heading: true },
      { text: 'Centered.', align: 'center', heading: false },
      { text: 'Plain\nwrapped.', align: undefined, heading: false },
    ]);
  });
});

describe('importHubTypes mirror', () => {
  // The renderer cannot import electron-main; this guards the copy against drift.
  const NAMES = [
    'ImportSourceKind',
    'StructureSource',
    'ImportEntityType',
    'ImportPreviewScene',
    'ImportPreviewChapter',
    'ImportPreview',
    'ImportPreviewResult',
    'ImportCommitOptions',
    'ImportCommitResult',
  ];
  const main = readFileSync(resolve(__dirname, '../../../../../electron-main/src/importHub/types.ts'), 'utf-8');
  const renderer = readFileSync(resolve(__dirname, '../../../importHubTypes.ts'), 'utf-8');

  function decl(src: string, name: string): string {
    const start = src.search(new RegExp(`^export (?:type|interface) ${name}\\b`, 'm'));
    expect(start, `${name} declared`).toBeGreaterThanOrEqual(0);
    const rest = src.slice(start);
    const end = rest.search(/\n\s*\n/);
    return (end === -1 ? rest : rest.slice(0, end))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  it.each(NAMES)('%s matches electron-main/src/importHub/types.ts', (name) => {
    expect(decl(renderer, name)).toBe(decl(main, name));
  });

  it.each(SPENT_PREVIEW_ERRORS.map((e) => [e]))('spent-preview error %s is still what commitImportToken returns', (error) => {
    const ipc = readFileSync(resolve(__dirname, '../../../../../electron-main/src/importHub/importHubIpc.ts'), 'utf-8');
    expect(ipc).toContain(error.replace(/'/g, "\\'"));
  });
});
