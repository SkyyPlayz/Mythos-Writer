// SKY-3204 / SKY-3209 (B6): shared <RichTextEditor> core — parity + contract net.
//
// The core is what both the Story editor (BlockEditor) and Notes rich mode
// (NoteViewer) wrap. These tests pin the shared contract:
//   1. both surfaces mount the SAME base extension set, including Underline
//   2. Markdown serialize round-trips (incl. <u>, matching the fidelity guard)
//   3. entity @-mention insert works through the shared picker stack
//   4. wiki-link clicks delegate to the caller
//   5. debounced onChange, suppressed initial change, flush-on-unmount
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import RichTextEditor from './RichTextEditor';
import { WikiLinkHintExtension } from './WikiLinkHintExtension';
import { AutoLinkerExtension } from './AutoLinkerExtension';
import { getEditorMarkdown } from './lib/useRichEditor';
import { installActWarningGuard } from './testActWarningGuard';
import { RICH_TEXT_SCHEMA } from './lib/richTextSchema';

installActWarningGuard();

const ENTITIES = [
  { id: 'char-elara', name: 'Elara', type: 'character' as const, aliases: [] },
  { id: 'loc-harbor', name: 'Harbor', type: 'location' as const, aliases: [] },
];

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    value: {
      entityList: vi.fn().mockResolvedValue({ entities: ENTITIES }),
    },
    configurable: true,
  });
});

/** Story wrapper config = BlockEditor's extras; Notes config = no extras. */
const STORY_EXTRAS = [WikiLinkHintExtension, AutoLinkerExtension];

interface MountResult {
  editor: Editor;
  unmount: () => void;
}

async function mountCore(
  props: Partial<React.ComponentProps<typeof RichTextEditor>> = {},
): Promise<MountResult> {
  let editor: Editor | null = null;
  const { unmount } = render(
    <RichTextEditor
      content=""
      autofocus={false}
      onEditorChange={(ed) => { editor = ed; }}
      {...props}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return { editor: editor as unknown as Editor, unmount };
}

function extensionNames(editor: Editor): string[] {
  return editor.extensionManager.extensions.map((e) => e.name);
}

// ---------------------------------------------------------------------------
// 1. Base extension parity — Story and Notes share ONE core
// ---------------------------------------------------------------------------

describe('RichTextEditor shared extension set', () => {
  // The drift this extraction kills: Notes rich mode previously mounted its own
  // extension list without Underline and without the shared serializer.
  const SHARED_BASE = ['underline', 'wikiLink', 'markdown', 'entityMention', 'entityMentionPicker', 'bold', 'italic', 'strike', 'heading', 'bulletList', 'orderedList', 'blockquote', 'code', 'codeBlock'];

  it('mounts every mark/node named in the shared RICH_TEXT_SCHEMA (SKY-5705 contract)', async () => {
    // Keeps lib/richTextSchema.ts honest: if a mark is added to the schema
    // doc but never actually wired into useRichEditor's extension list (or
    // vice versa), this fails instead of silently drifting.
    const { editor, unmount } = await mountCore();
    const names = extensionNames(editor);
    for (const mark of RICH_TEXT_SCHEMA) expect(names).toContain(mark.name);
    unmount();
  });

  it('Notes config (no extras) mounts the full shared base, including Underline', async () => {
    const { editor, unmount } = await mountCore();
    const names = extensionNames(editor);
    for (const name of SHARED_BASE) expect(names).toContain(name);
    unmount();
  });

  it('Story config (hint + auto-linker extras) mounts the same shared base', async () => {
    const { editor: storyEditor, unmount: unmountStory } = await mountCore({ extraExtensions: STORY_EXTRAS });
    const { editor: notesEditor, unmount: unmountNotes } = await mountCore();

    const storyNames = extensionNames(storyEditor);
    const notesNames = extensionNames(notesEditor);
    for (const name of SHARED_BASE) {
      expect(storyNames).toContain(name);
      expect(notesNames).toContain(name);
    }
    // Story = shared base + exactly its two extras.
    expect(storyNames).toContain('wikiLinkHint');
    expect(storyNames).toContain('autoLinker');
    expect(storyNames.filter((n) => !notesNames.includes(n)).sort()).toEqual(['autoLinker', 'wikiLinkHint']);
    unmountStory();
    unmountNotes();
  });
});

// ---------------------------------------------------------------------------
// 2. Markdown serialize round-trip through the core
// ---------------------------------------------------------------------------

describe('RichTextEditor markdown round-trip', () => {
  it('round-trips marks, wiki-links and headings through getEditorMarkdown', async () => {
    const md = '# Title\n\nSome **bold**, *italic*, and a [[Character: Elara]] link.\n';
    const { editor, unmount } = await mountCore({ content: md });
    const out = getEditorMarkdown(editor);
    expect(out).toContain('# Title');
    expect(out).toContain('**bold**');
    expect(out).toContain('*italic*');
    expect(out).toContain('[[Character: Elara]]');
    expect(out.endsWith('\n')).toBe(true);
    unmount();
  });

  it('round-trips <u> underline losslessly (fidelity-guard exemption contract)', async () => {
    // notesFidelityGuard exempts <u> from its raw-HTML lossy check because the
    // shared core's Underline extension parses and re-serializes it. If this
    // round-trip ever breaks, the guard exemption must be removed with it.
    const md = 'An <u>underlined</u> word.\n';
    const { editor, unmount } = await mountCore({ content: md });
    expect(getEditorMarkdown(editor)).toContain('<u>underlined</u>');
    unmount();
  });

  it('round-trips paragraph/heading text alignment (SKY-5705/SKY-7073 GH #642)', async () => {
    // Mounts the real <RichTextEditor> (the shared core Story/Notes actually
    // render), not a hand-duplicated extension list, so this catches drift
    // that a schema-level-only test (sharedRichTextSchema.test.ts) can't: if
    // TextAlign or AlignedParagraph/AlignedHeading ever fall out of
    // useRichEditor's mounted extensions, this fails.
    const md = 'Centered text. {.center}\n\n## Scene Two {.right}\n';
    const { editor, unmount } = await mountCore({ content: md });

    const json = editor.getJSON();
    expect(json.content?.[0]?.attrs?.textAlign).toBe('center');
    expect(json.content?.[1]?.attrs?.textAlign).toBe('right');

    // Full save -> reload cycle: re-serialize, then parse that output again
    // through a second mount and confirm the alignment survived.
    const saved = getEditorMarkdown(editor);
    expect(saved).toContain('{.center}');
    expect(saved).toContain('{.right}');
    unmount();

    const { editor: reloaded, unmount: unmountReloaded } = await mountCore({ content: saved });
    const reloadedJson = reloaded.getJSON();
    expect(reloadedJson.content?.[0]?.attrs?.textAlign).toBe('center');
    expect(reloadedJson.content?.[1]?.attrs?.textAlign).toBe('right');
    expect(getEditorMarkdown(reloaded)).toBe(saved);
    unmountReloaded();
  });

  // SKY-5705: every mark in RICH_TEXT_SCHEMA round-trips through the shared
  // core, not just the two marks the original SKY-3204 extraction happened
  // to pin (bold/italic were covered above; this closes strike, lists,
  // blockquote and code block, which were previously only exercised by
  // BlockEditor's separate, non-shared test editor).
  const FULL_MARK_SET_MD =
    '# Heading One\n\n' +
    '## Heading Two\n\n' +
    'Some **bold**, *italic*, <u>underlined</u>, ~~struck~~ and `code` text, ' +
    'plus a [[Character: Elara]] link.\n\n' +
    '- bullet one\n' +
    '- bullet two\n\n' +
    '1. ordered one\n' +
    '2. ordered two\n\n' +
    '> a quoted line\n\n' +
    '```\nconst x = 1;\n```\n';

  it('round-trips the full mark set (headings, lists, blockquote, code block, strike) through the shared core', async () => {
    const { editor, unmount } = await mountCore({ content: FULL_MARK_SET_MD });
    const out = getEditorMarkdown(editor);
    expect(out).toContain('# Heading One');
    expect(out).toContain('## Heading Two');
    expect(out).toContain('**bold**');
    expect(out).toContain('*italic*');
    expect(out).toContain('<u>underlined</u>');
    expect(out).toContain('~~struck~~');
    expect(out).toContain('`code`');
    expect(out).toContain('[[Character: Elara]]');
    expect(out).toContain('- bullet one');
    expect(out).toContain('- bullet two');
    expect(out).toContain('1. ordered one');
    expect(out).toContain('2. ordered two');
    expect(out).toContain('> a quoted line');
    expect(out).toContain('```\nconst x = 1;\n```');
    unmount();
  });

  it('Story and Notes configs serialize the same full-mark-set document byte-identically', async () => {
    // This is the ticket's core ask: "a doc saved in one editor reopens with
    // identical formatting in the other where shared." Story adds extra
    // extensions (wiki-link hinting, auto-linker) that only affect live
    // editing behaviour, not the persisted Markdown — so the two configs
    // must produce exactly the same serialized output for the same input.
    const { editor: storyEditor, unmount: unmountStory } = await mountCore({
      content: FULL_MARK_SET_MD,
      extraExtensions: STORY_EXTRAS,
    });
    const { editor: notesEditor, unmount: unmountNotes } = await mountCore({ content: FULL_MARK_SET_MD });

    expect(getEditorMarkdown(storyEditor)).toBe(getEditorMarkdown(notesEditor));

    unmountStory();
    unmountNotes();
  });

  it('loads a plain pre-existing document (no formatting) without loss (backward-compat)', async () => {
    // Old scene/note files predate every mark above. Nothing here has ever
    // needed a content migration because prose is stored as plain Markdown
    // text and re-parsed on load — this pins that "no marks" documents stay
    // byte-stable so a future extension/serializer change can't regress it.
    const md = 'Just plain prose with no formatting at all.\n';
    const { editor, unmount } = await mountCore({ content: md });
    expect(getEditorMarkdown(editor)).toBe(md);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// 3. Entity @-mention picker stack
// ---------------------------------------------------------------------------

describe('RichTextEditor entity mention picker', () => {
  it('shows the picker on @-trigger and inserts a mention chip on Enter', async () => {
    const { editor, unmount } = await mountCore();

    await act(async () => {
      editor.commands.focus('end');
      editor.commands.insertContent('@Ela');
    });

    const listbox = await screen.findByRole('listbox', { name: 'Entity suggestions' });
    expect(listbox).toBeInTheDocument();
    expect(screen.getByText('Elara')).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    });

    expect(document.querySelector('.entity-mention-chip')).not.toBeNull();
    expect(getEditorMarkdown(editor)).toContain('entity://char-elara');
    unmount();
  });

  it('Escape dismisses the picker without inserting', async () => {
    const { editor, unmount } = await mountCore();

    await act(async () => {
      editor.commands.focus('end');
      editor.commands.insertContent('@Har');
    });
    await screen.findByRole('listbox', { name: 'Entity suggestions' });

    await act(async () => {
      fireEvent.keyDown(editor.view.dom, { key: 'Escape' });
    });

    expect(screen.queryByRole('listbox', { name: 'Entity suggestions' })).toBeNull();
    expect(document.querySelector('.entity-mention-chip')).toBeNull();
    unmount();
  });
});

// ---------------------------------------------------------------------------
// 4. Wiki-link click delegation
// ---------------------------------------------------------------------------

describe('RichTextEditor wiki-link delegation', () => {
  it('delegates [data-wiki-link] clicks to onWikiLinkClick', async () => {
    const onWikiLinkClick = vi.fn();
    const { unmount } = await mountCore({
      content: 'Visit [[Location: Harbor]] today.\n',
      onWikiLinkClick,
    });

    const link = document.querySelector('[data-wiki-link]');
    expect(link).not.toBeNull();
    fireEvent.click(link as Element);

    expect(onWikiLinkClick).toHaveBeenCalledWith('Location: Harbor');
    unmount();
  });

  it('does NOT navigate on body clicks in the default (Notes) config, even with one [[link]] present', async () => {
    // Regression net: the Story-only plain-text fallback treats any click as
    // activating an unambiguous [[link]]. Leaking it into Notes made a body
    // click navigate away from the open note ("Could not load note.").
    const onWikiLinkClick = vi.fn();
    const { editor, unmount } = await mountCore({
      content: 'Prose around [[Character: Elara]] and more prose.\n',
      onWikiLinkClick,
    });

    fireEvent.click(editor.view.dom);

    expect(onWikiLinkClick).not.toHaveBeenCalled();
    unmount();
  });

  it('Story config keeps the plain-text [[link]] click fallback (SKY-2099)', async () => {
    const onWikiLinkClick = vi.fn();
    const { editor, unmount } = await mountCore({
      content: 'Mentioning [[Location: Harbor]] in plain prose.\n',
      onWikiLinkClick,
      plainTextWikiLinkFallback: true,
    });

    fireEvent.click(editor.view.dom);

    expect(onWikiLinkClick).toHaveBeenCalledWith('Location: Harbor');
    unmount();
  });

  it('delegates entity-chip clicks to onEntityClick', async () => {
    const onEntityClick = vi.fn();
    const { unmount } = await mountCore({
      content: 'Ask <span data-entity-id="char-elara" data-entity-label="Elara" class="entity-mention-chip">@Elara</span> about it.\n',
      onEntityClick,
    });

    const chip = document.querySelector('.entity-mention-chip');
    expect(chip).not.toBeNull();
    fireEvent.click(chip as Element);

    expect(onEntityClick).toHaveBeenCalledWith('char-elara');
    unmount();
  });
});

// ---------------------------------------------------------------------------
// 5. Debounced onChange contract
// ---------------------------------------------------------------------------

describe('RichTextEditor debounced onChange', () => {
  it('fires onChangeMarkdown once after the debounce window with serialized markdown', async () => {
    vi.useFakeTimers();
    try {
      let editor: Editor | null = null;
      const onChangeMarkdown = vi.fn();
      render(
        <RichTextEditor
          content=""
          autofocus={false}
          onEditorChange={(ed) => { editor = ed; }}
          onChangeMarkdown={onChangeMarkdown}
        />,
      );
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(editor).not.toBeNull();

      act(() => {
        (editor as unknown as Editor).commands.insertContent('Typed text');
      });
      expect(onChangeMarkdown).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      expect(onChangeMarkdown).toHaveBeenCalledTimes(1);
      expect(onChangeMarkdown.mock.calls[0][0]).toContain('Typed text');
      expect((onChangeMarkdown.mock.calls[0][0] as string).endsWith('\n')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('suppressInitialChange swallows the initial content normalization only', async () => {
    const onChangeMarkdown = vi.fn();
    const { editor, unmount } = await mountCore({
      content: '# Loaded note\n\nBody.\n',
      suppressInitialChange: true,
      onChangeMarkdown,
    });

    // Initial parse/normalization must never register as an edit…
    expect(onChangeMarkdown).not.toHaveBeenCalled();

    // …but a real edit after mount still flushes.
    await act(async () => {
      editor.commands.insertContent(' Edited.');
    });
    await waitFor(() => expect(onChangeMarkdown).toHaveBeenCalled(), { timeout: 2000 });
    expect(onChangeMarkdown.mock.calls[0][0]).toContain('Edited.');
    unmount();
  });

  it('flushes a pending debounced change on unmount so fast switches never drop text', async () => {
    const onChangeMarkdown = vi.fn();
    const { editor, unmount } = await mountCore({ onChangeMarkdown });

    await act(async () => {
      editor.commands.insertContent('Do not lose this.');
    });
    expect(onChangeMarkdown).not.toHaveBeenCalled();

    unmount();

    expect(onChangeMarkdown).toHaveBeenCalledTimes(1);
    expect(onChangeMarkdown.mock.calls[0][0]).toContain('Do not lose this.');
  });
});
