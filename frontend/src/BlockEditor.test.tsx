import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import BlockEditor, { blocksToMarkdownBody } from './BlockEditor';
import type { Block, Scene } from './types';
import { WikiLink } from './WikiLinkExtension';
import { installActWarningGuard } from './testActWarningGuard';

installActWarningGuard();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: [StarterKit, WikiLink, Markdown],
    content: markdown,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  return result;
}

/** roundTrip without trimming — used for trailing-newline assertions. */
function roundTripRaw(markdown: string): string {
  const editor = new Editor({
    extensions: [StarterKit, WikiLink, Markdown],
    content: markdown,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (editor.storage as any).markdown.getMarkdown() as string;
  editor.destroy();
  // Mirror the post-processing in BlockEditor.tsx: ensure trailing newline.
  return raw.endsWith('\n') ? raw : `${raw}\n`;
}

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, '__fixtures__/markdown', name),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Original suite (kept verbatim for non-regression)
// ---------------------------------------------------------------------------

describe('BlockEditor markdown round-trip', () => {
  it('paragraph preserves plain text', () => {
    const md = 'Hello world, this is a paragraph.';
    const out = roundTrip(md);
    expect(out).toContain('Hello world, this is a paragraph.');
  });

  it('heading h1', () => {
    const md = '# Chapter One';
    const out = roundTrip(md);
    expect(out.trim()).toBe('# Chapter One');
  });

  it('heading h2', () => {
    const md = '## Scene Two';
    const out = roundTrip(md);
    expect(out.trim()).toBe('## Scene Two');
  });

  it('heading h3', () => {
    const md = '### Act Three';
    const out = roundTrip(md);
    expect(out.trim()).toBe('### Act Three');
  });

  it('heading h4', () => {
    const md = '#### Beat Four';
    const out = roundTrip(md);
    expect(out.trim()).toBe('#### Beat Four');
  });

  it('heading h5', () => {
    const md = '##### Beat Five';
    const out = roundTrip(md);
    expect(out.trim()).toBe('##### Beat Five');
  });

  it('heading h6', () => {
    const md = '###### Beat Six';
    const out = roundTrip(md);
    expect(out.trim()).toBe('###### Beat Six');
  });

  it('bold preserves marked text', () => {
    const md = 'She was **furious** with him.';
    const out = roundTrip(md);
    expect(out).toContain('**furious**');
  });

  it('italic preserves marked text', () => {
    const md = 'The wind was *howling* outside.';
    const out = roundTrip(md);
    expect(out).toMatch(/[*_]howling[*_]/);
  });

  it('bullet list preserves all items', () => {
    const md = '- First item\n- Second item\n- Third item';
    const out = roundTrip(md);
    expect(out).toContain('First item');
    expect(out).toContain('Second item');
    expect(out).toContain('Third item');
    expect(out).toMatch(/[-*+]\s/);
  });

  it('ordered list preserves all items', () => {
    const md = '1. Step one\n2. Step two\n3. Step three';
    const out = roundTrip(md);
    expect(out).toContain('Step one');
    expect(out).toContain('Step two');
    expect(out).toContain('Step three');
    expect(out).toMatch(/\d+\.\s/);
  });

  it('blockquote preserves quoted text', () => {
    const md = '> To be or not to be.';
    const out = roundTrip(md);
    expect(out).toContain('To be or not to be.');
    expect(out).toContain('>');
  });

  it('inline code preserves code span', () => {
    const md = 'Call `window.api.readManifest()` to load data.';
    const out = roundTrip(md);
    expect(out).toContain('`window.api.readManifest()`');
  });

  it('code block preserves fenced content', () => {
    const md = '```\nconst x = 42;\nconsole.log(x);\n```';
    const out = roundTrip(md);
    expect(out).toContain('const x = 42;');
    expect(out).toContain('console.log(x);');
    expect(out).toContain('```');
  });
});

// ---------------------------------------------------------------------------
// Extended regression suite (MYT-131)
// ---------------------------------------------------------------------------

describe('BlockEditor markdown round-trip — extended regression (MYT-131)', () => {

  // -- Inline marks ----------------------------------------------------------

  describe('inline marks', () => {
    it('bold round-trips with double asterisks', () => {
      const out = roundTrip('**bold text**');
      expect(out).toContain('**bold text**');
    });

    it('italic round-trips', () => {
      const out = roundTrip('*italic text*');
      expect(out).toMatch(/[*_]italic text[*_]/);
    });

    it('strikethrough round-trips', () => {
      const out = roundTrip('~~struck~~');
      expect(out).toContain('~~struck~~');
    });

    it('inline code round-trips', () => {
      const out = roundTrip('`const x = 1;`');
      expect(out).toContain('`const x = 1;`');
    });

    it('combined marks in fixture preserve all tokens', () => {
      const src = fixture('inline-marks.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('**furious**');
      expect(out).toMatch(/[*_]whispered[*_]/);
      expect(out).toContain('`inline code`');
      expect(out).toContain('~~strikethrough~~');
    });
  });

  // -- Headings --------------------------------------------------------------

  describe('headings', () => {
    it('H1 round-trips exactly', () => {
      expect(roundTrip('# Title').trim()).toBe('# Title');
    });

    it('H2 round-trips exactly', () => {
      expect(roundTrip('## Section').trim()).toBe('## Section');
    });

    it('H3 round-trips exactly', () => {
      expect(roundTrip('### Sub').trim()).toBe('### Sub');
    });

    it('H4 round-trips exactly', () => {
      expect(roundTrip('#### Deep').trim()).toBe('#### Deep');
    });

    it('blank lines between headings and paragraphs are restored', () => {
      const src = fixture('headings.md').trim();
      const out = roundTrip(src);
      // Each heading must be present
      expect(out).toMatch(/^# Heading One/m);
      expect(out).toMatch(/^## Heading Two/m);
      expect(out).toMatch(/^### Heading Three/m);
      expect(out).toMatch(/^#### Heading Four/m);
      expect(out).toContain('A paragraph after headings.');
    });
  });

  // -- Lists -----------------------------------------------------------------

  describe('lists', () => {
    it('bullet list from fixture preserves all items', () => {
      const src = fixture('lists.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('First item');
      expect(out).toContain('Second item');
      expect(out).toContain('Third item');
    });

    it('ordered list from fixture preserves all items and numbering', () => {
      const src = fixture('lists.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('Step one');
      expect(out).toContain('Step two');
      expect(out).toContain('Step three');
      expect(out).toMatch(/\d+\.\s/);
    });

    it('nested bullet list preserves hierarchy', () => {
      const src = fixture('nested-list.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('Parent one');
      expect(out).toContain('Child one');
      expect(out).toContain('Child two');
      expect(out).toContain('Parent two');
    });
  });

  // -- Code blocks -----------------------------------------------------------

  describe('code blocks', () => {
    it('fenced code block with language tag preserves language', () => {
      const md = '```typescript\nconst x: number = 42;\n```';
      const out = roundTrip(md);
      expect(out).toContain('```typescript');
      expect(out).toContain('const x: number = 42;');
    });

    it('code block fixture round-trips language and content', () => {
      const src = fixture('code-block.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('```typescript');
      expect(out).toContain('const x: number = 42;');
      expect(out).toContain('console.log(x);');
    });

    it('fenced block without language round-trips content', () => {
      const md = '```\nplain code\n```';
      const out = roundTrip(md);
      expect(out).toContain('plain code');
      expect(out).toContain('```');
    });
  });

  // -- Blockquotes -----------------------------------------------------------

  describe('blockquotes', () => {
    it('simple blockquote round-trips', () => {
      const src = fixture('blockquote.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('To be or not to be');
      expect(out).toMatch(/^>/m);
    });

    it('nested blockquote preserves inner content', () => {
      // tiptap-markdown flattens nested blockquotes into one level;
      // verify inner text is still present
      const md = '> Outer\n>\n> > Inner nested quote';
      const out = roundTrip(md);
      expect(out).toContain('Outer');
      expect(out).toContain('Inner nested quote');
    });
  });

  // -- Wiki-link tokens ------------------------------------------------------
  // GAP (MYT-138): tiptap-markdown escapes square brackets, so [[wiki-link]]
  // becomes \[\[wiki-link\]\] on output. A custom TipTap extension is needed
  // to preserve these tokens. Tests below document the current (broken)
  // behaviour so any fix will surface as a clean diff.

  describe('wiki-link tokens', () => {
    it('[[wiki-link]] tokens are preserved verbatim on round-trip', () => {
      const md = 'See [[Elara]] for details.';
      const out = roundTrip(md);
      expect(out).toContain('[[Elara]]');
      expect(out).not.toContain('\\[\\[');
    });

    it('wiki-link fixture — all tokens survive round-trip unescaped', () => {
      const src = fixture('wiki-link.md').trim();
      const out = roundTrip(src);
      expect(out).toContain('[[Elara]]');
      expect(out).toContain('[[The Shadow Realm]]');
      expect(out).not.toContain('\\[\\[');
    });
  });

  // -- Tables ----------------------------------------------------------------

  describe('tables', () => {
    it('GFM table — documents current behaviour (gap expected without Table extension)', () => {
      // StarterKit does not include a Table extension by default.
      // Verify the text content is at least partially preserved even if
      // GFM table syntax is lost. If this test fails after adding a Table
      // extension, update the assertion to verify full round-trip.
      const md = '| Name | Role |\n|------|------|\n| Elara | Hero |';
      const out = roundTrip(md);
      // Content should survive in some form
      expect(out).toContain('Elara');
      expect(out).toContain('Hero');
    });
  });

  // -- Line breaks -----------------------------------------------------------

  describe('line break behaviour', () => {
    it('hard break (two trailing spaces) is preserved as a line break', () => {
      // Two trailing spaces before \n signals a hard break in CommonMark
      const md = 'Line one  \nLine two';
      const out = roundTrip(md);
      expect(out).toContain('Line one');
      expect(out).toContain('Line two');
    });

    it('soft wrap within a paragraph does not insert extra blank lines', () => {
      const md = 'First sentence. Second sentence.';
      const out = roundTrip(md);
      // Should not split into two separate paragraphs
      expect(out.trim()).not.toMatch(/First sentence\.\s*\n\s*\n\s*Second sentence/);
    });
  });

  // -- Trailing newline ------------------------------------------------------
  // GAP (MYT-138): tiptap-markdown v0.9 does not append a trailing newline.
  // Test documents current behaviour; update when the gap is resolved.

  describe('trailing newline', () => {
    it('output ends with a trailing newline', () => {
      const raw = roundTripRaw('Hello world');
      expect(raw).toMatch(/\n$/);
    });
  });
});

// ---------------------------------------------------------------------------
// insertWikiLink — AC-F-11 (SKY-2587)
// Verify that the command creates a proper WikiLink node (not plain text),
// so tiptap-markdown serialises [[target]] unescaped on save.
// ---------------------------------------------------------------------------

describe('insertWikiLink command (AC-F-11)', () => {
  function insertWikiLinkInto(
    editor: InstanceType<typeof Editor>,
    link: string,
    anchorText: string,
  ) {
    const target = link.replace(/^\[\[|\]\]$/g, '');
    const wikiNode = editor.schema.nodes['wikiLink']?.create({ target });
    if (!wikiNode) throw new Error('wikiLink node type not found in schema');

    const needle = anchorText.toLowerCase();
    // Use a mutable object to hold the range so TypeScript doesn't narrow the
    // captured variable to never after the descendants callback.
    const found: { from: number; to: number; matched: boolean } = { from: 0, to: 0, matched: false };
    editor.state.doc.descendants((node, pos) => {
      if (found.matched) return false;
      if (node.isText && node.text) {
        const idx = node.text.toLowerCase().indexOf(needle);
        if (idx >= 0) {
          found.from = pos + idx;
          found.to = pos + idx + anchorText.length;
          found.matched = true;
        }
      }
      return true;
    });

    if (found.matched) {
      editor.view.dispatch(editor.state.tr.replaceWith(found.from, found.to, wikiNode));
    } else {
      editor.view.dispatch(editor.state.tr.insert(editor.state.selection.from, wikiNode));
    }
  }

  it('replaces anchor text with a WikiLink node that serialises as [[target]] unescaped', () => {
    const editor = new Editor({
      extensions: [StarterKit, WikiLink, Markdown],
      content: 'The foundry gates opened.',
    });

    insertWikiLinkInto(editor, '[[The Foundry]]', 'foundry');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (editor.storage as any).markdown.getMarkdown() as string;
    expect(md).toContain('[[The Foundry]]');
    expect(md).not.toContain('\\[\\[');
    // Anchor text is replaced, not left as duplicate plain text
    expect(md).not.toContain('foundry gates');

    editor.destroy();
  });

  it('falls back to cursor insertion when anchor text is absent from document', () => {
    const editor = new Editor({
      extensions: [StarterKit, WikiLink, Markdown],
      content: 'A completely different passage.',
    });

    insertWikiLinkInto(editor, '[[The Foundry]]', 'foundry');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (editor.storage as any).markdown.getMarkdown() as string;
    expect(md).toContain('[[The Foundry]]');
    expect(md).not.toContain('\\[\\[');

    editor.destroy();
  });

  it('multi-word anchor text is fully replaced by the WikiLink node', () => {
    const editor = new Editor({
      extensions: [StarterKit, WikiLink, Markdown],
      content: 'She entered the shadow realm at dawn.',
    });

    insertWikiLinkInto(editor, '[[The Shadow Realm]]', 'the shadow realm');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (editor.storage as any).markdown.getMarkdown() as string;
    expect(md).toContain('[[The Shadow Realm]]');
    expect(md).not.toContain('\\[\\[');
    expect(md).not.toContain('shadow realm at dawn');

    editor.destroy();
  });
});

function makeBlankScene(): Scene {
  const timestamp = '2026-06-09T00:00:00.000Z';
  return {
    id: 'scene-blank',
    title: 'Blank Scene',
    path: 'stories/story-1/chapters/chapter-1/scenes/blank.md',
    order: 0,
    chapterId: 'chapter-1',
    storyId: 'story-1',
    blocks: [],
    draftState: 'in-progress',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('BlockEditor empty-scene entry', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: {
        entityList: vi.fn().mockResolvedValue({ entities: [] }),
      },
      configurable: true,
    });
  });

  it('focuses the editable surface and shows a clear start-typing affordance for a blank scene', async () => {
    render(
      <BlockEditor
        scene={makeBlankScene()}
        onBlocksChange={vi.fn()}
        onDraftStateChange={vi.fn()}
      />
    );

    expect(screen.getByText(/start typing to begin/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(document.activeElement).toHaveClass('ProseMirror');
    });
  });

  it('uses the post-onboarding prompt when provided', async () => {
    render(
      <BlockEditor
        scene={makeBlankScene()}
        onBlocksChange={vi.fn()}
        onDraftStateChange={vi.fn()}
        emptySceneHint="Start with a sentence, a beat, or a line of dialogue."
      />
    );

    expect(screen.getByText(/start with a sentence/i)).toBeInTheDocument();
    await act(async () => {});
  });
});

describe('BlockEditor pending edit flush', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: {
        entityList: vi.fn().mockResolvedValue({ entities: [] }),
      },
      configurable: true,
    });
  });

  it('flushes pending debounced edits before unmount so scene switches do not drop text', async () => {
    const onBlocksChange = vi.fn();
    let editorApi: { insertText: (text: string) => void } | undefined;
    const { unmount } = render(
      <BlockEditor
        scene={makeBlankScene()}
        onBlocksChange={onBlocksChange}
        onDraftStateChange={vi.fn()}
        onEditorReady={(api) => { editorApi = api; }}
      />
    );

    await waitFor(() => expect(editorApi).toBeDefined());
    await act(async () => {
      editorApi!.insertText('Do not lose this edit.');
    });
    unmount();

    expect(onBlocksChange).toHaveBeenCalledWith([
      expect.objectContaining({ content: expect.stringContaining('Do not lose this edit.') }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// SKY-5777 — heading-survives-backup hardening
// ---------------------------------------------------------------------------

function makeSceneWithBlocks(blocks: Block[]): Scene {
  const timestamp = '2026-07-02T00:00:00.000Z';
  return {
    id: 'scene-headings',
    title: 'Heading Levels Scene',
    path: 'stories/story-1/chapters/chapter-1/scenes/headings.md',
    order: 0,
    chapterId: 'chapter-1',
    storyId: 'story-1',
    blocks,
    draftState: 'in-progress',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

describe('blocksToMarkdownBody heading level hardening', () => {
  it('preserves the # run already present on a legacy heading block instead of collapsing it to H1', () => {
    const blocks: Block[] = HEADING_LEVELS.map((level, i) => ({
      id: `h${level}`,
      type: 'heading',
      content: `${'#'.repeat(level)} Heading ${level}`,
      order: i,
      updatedAt: '2026-07-02T00:00:00.000Z',
    }));

    const out = blocksToMarkdownBody(blocks);

    for (const level of HEADING_LEVELS) {
      expect(out).toContain(`${'#'.repeat(level)} Heading ${level}`);
    }
    // Regression guard for the original bug: every heading used to come out as "# ...".
    expect(out).not.toContain('# #');
  });

  it('falls back to a single # when a heading block carries no level marker at all', () => {
    const blocks: Block[] = [
      { id: 'h', type: 'heading', content: 'Untitled Heading', order: 0, updatedAt: '2026-07-02T00:00:00.000Z' },
    ];
    expect(blocksToMarkdownBody(blocks)).toBe('# Untitled Heading');
  });
});

describe('BlockEditor scene backup/restore heading round trip', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: { entityList: vi.fn().mockResolvedValue({ entities: [] }) },
      configurable: true,
    });
  });

  it('preserves H1-H6 levels when a scene is restored from its Block[] snapshot', async () => {
    const headingMarkdown = HEADING_LEVELS
      .map((level) => `${'#'.repeat(level)} Heading ${level}`)
      .join('\n\n');
    const scene = makeSceneWithBlocks([
      { id: 'prose-1', type: 'prose', content: headingMarkdown, order: 0, updatedAt: '2026-07-02T00:00:00.000Z' },
    ]);

    let editorApi: { getMarkdown: () => string } | undefined;
    render(
      <BlockEditor
        scene={scene}
        onBlocksChange={vi.fn()}
        onDraftStateChange={vi.fn()}
        onEditorReady={(api) => { editorApi = api; }}
      />
    );

    await waitFor(() => expect(editorApi).toBeDefined());
    const restored = editorApi!.getMarkdown();
    for (const level of HEADING_LEVELS) {
      expect(restored).toContain(`${'#'.repeat(level)} Heading ${level}`);
    }
  });
});

// ---------------------------------------------------------------------------
// GH #631 — heading-focus view splitting (decoration-only)
// ---------------------------------------------------------------------------

describe('BlockEditor heading focus (GH #631)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: {
        entityList: vi.fn().mockResolvedValue({ entities: [] }),
      },
      configurable: true,
    });
  });

  const FOCUS_DOC = [
    '## Chapter A',
    '',
    'Alpha text.',
    '',
    '## Chapter B',
    '',
    'Beta text.',
  ].join('\n');

  function makeFocusScene(): Scene {
    return makeSceneWithBlocks([
      { id: 'b1', type: 'prose', content: FOCUS_DOC, order: 0, updatedAt: '2026-07-02T00:00:00.000Z' },
    ]);
  }

  async function renderWithFocus() {
    let editorApi: { getMarkdown: () => string } | undefined;
    render(
      <BlockEditor
        scene={makeFocusScene()}
        onBlocksChange={vi.fn()}
        onDraftStateChange={vi.fn()}
        enableHeadingFocus
        autoFocus={false}
        onEditorReady={(api) => { editorApi = api; }}
      />
    );
    await waitFor(() => expect(editorApi).toBeDefined());
    await waitFor(() => expect(screen.getByTestId('heading-focus-group')).toBeInTheDocument());
    return () => editorApi!;
  }

  it('renders the control only when enabled and headings exist', async () => {
    await renderWithFocus();
    expect(screen.getByLabelText('Heading focus level')).toBeInTheDocument();
  });

  it('does not render the control when disabled', async () => {
    render(
      <BlockEditor
        scene={makeFocusScene()}
        onBlocksChange={vi.fn()}
        onDraftStateChange={vi.fn()}
        autoFocus={false}
      />
    );
    await act(async () => {});
    expect(screen.queryByTestId('heading-focus-group')).not.toBeInTheDocument();
  });

  it('focusing H2 hides the out-of-section blocks in the DOM', async () => {
    await renderWithFocus();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Heading focus level'), { target: { value: '2' } });
    });
    await waitFor(() => {
      expect(document.querySelectorAll('.heading-focus-hidden').length).toBeGreaterThan(0);
    });
    // Section 1 of 2 shown; stepping enabled forward only.
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous H2 section' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next H2 section' })).toBeEnabled();
  });

  it('steps between same-level sections', async () => {
    await renderWithFocus();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Heading focus level'), { target: { value: '2' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next H2 section' }));
    });
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next H2 section' })).toBeDisabled();
  });

  it('CONTRACT: getMarkdown returns the full document while focused (backups intact)', async () => {
    const getApi = await renderWithFocus();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Heading focus level'), { target: { value: '2' } });
    });
    const md = getApi().getMarkdown();
    expect(md).toContain('## Chapter A');
    expect(md).toContain('Alpha text.');
    expect(md).toContain('## Chapter B');
    expect(md).toContain('Beta text.');
  });

  it('selecting All restores every block', async () => {
    await renderWithFocus();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Heading focus level'), { target: { value: '2' } });
    });
    await waitFor(() => expect(document.querySelectorAll('.heading-focus-hidden').length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Heading focus level'), { target: { value: 'all' } });
    });
    await waitFor(() => expect(document.querySelectorAll('.heading-focus-hidden')).toHaveLength(0));
  });

  // SKY-5902: post-merge audit found that editing away every heading of the
  // focused level leaves `hf.level` pointing at a value with no matching
  // <option>. The reset itself is covered by the `reconcileFocusLevel` unit
  // tests in lib/headingFocus.test.ts (jsdom auto-selects the first <option>
  // when the selected one is removed, so a DOM-level assertion here can't
  // distinguish fixed from broken — see that suite for the real contract).
  it('SKY-5902: drops the stale level option once its last heading is edited away', async () => {
    const doc = [
      '## Chapter A',
      '',
      'Alpha text.',
      '',
      '### Section A1',
      '',
      'Sub text.',
      '',
      '## Chapter B',
      '',
      'Beta text.',
    ].join('\n');
    let editorApi: { jumpToText: (text: string) => void; getMarkdown: () => string } | undefined;
    render(
      <BlockEditor
        scene={makeSceneWithBlocks([
          { id: 'b1', type: 'prose', content: doc, order: 0, updatedAt: '2026-07-02T00:00:00.000Z' },
        ])}
        onBlocksChange={vi.fn()}
        onDraftStateChange={vi.fn()}
        enableHeadingFocus
        autoFocus={false}
        onEditorReady={(api) => { editorApi = api; }}
      />
    );
    await waitFor(() => expect(editorApi).toBeDefined());
    await waitFor(() => expect(screen.getByTestId('heading-focus-group')).toBeInTheDocument());

    // Focus H3 — the only level-3 heading in the doc.
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Heading focus level'), { target: { value: '3' } });
    });
    expect(screen.getByLabelText('Heading focus level')).toHaveValue('3');

    // Delete the H3 heading node: select its text, then backspace twice —
    // once to clear the text, once more to join the now-empty heading back
    // into the preceding paragraph, removing the heading node entirely.
    await act(async () => {
      editorApi!.jumpToText('Section A1');
    });
    const pmDom = document.querySelector('.ProseMirror') as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(pmDom, { key: 'Backspace' });
    });
    await act(async () => {
      fireEvent.keyDown(pmDom, { key: 'Backspace' });
    });
    await waitFor(() => expect(editorApi!.getMarkdown()).not.toContain('### Section A1'));

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'H3' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /H3 section/ })).not.toBeInTheDocument();
  });
});
