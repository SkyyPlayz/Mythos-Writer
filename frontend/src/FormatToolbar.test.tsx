// SKY-3205 — FormatToolbar unit tests (vitest + @testing-library/react).
//
// Coverage:
//   – Null editor → skeleton placeholder rendered
//   – All toolbar controls present when editor is live
//   – ARIA attributes: role=toolbar, aria-label, aria-pressed, role=separator
//   – Active mark state: is-active class applied correctly (bold, italic, underline, strike)
//   – Heading select reflects active heading / body
//   – onMouseDown calls chain command without firing click (e.preventDefault)
//   – Heading dropdown change routes to toggleHeading / setParagraph
//   – Event subscription: selectionUpdate / transaction subscribed on mount, cleaned up
//   – GH #642 alignment buttons: render, pressed state (left = unset default),
//     setTextAlign / unsetTextAlign routing, and marker-free markdown for
//     left/unset against a real shared-schema editor

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Markdown } from 'tiptap-markdown';
import FormatToolbar from './FormatToolbar';
import { WikiLink } from './WikiLinkExtension';
import { AlignedParagraph, AlignedHeading } from './lib/alignedBlocks';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Mock editor factory ─────────────────────────────────────────────────────

type ActiveMap = Record<string, boolean | ((attrs?: Record<string, unknown>) => boolean)>;

function makeChainMock() {
  const chain: Record<string, unknown> = {};
  const cmd = (name: string) => {
    chain[name] = vi.fn(() => chain);
    return chain;
  };
  cmd('focus');
  cmd('toggleBold');
  cmd('toggleItalic');
  cmd('toggleUnderline');
  cmd('toggleStrike');
  cmd('toggleBulletList');
  cmd('toggleOrderedList');
  cmd('toggleBlockquote');
  cmd('toggleCode');
  cmd('toggleCodeBlock');
  cmd('toggleHeading');
  cmd('setParagraph');
  cmd('setTextAlign');
  cmd('unsetTextAlign');
  chain['run'] = vi.fn();
  return chain;
}

function makeEditorMock(activeMap: ActiveMap = {}) {
  const listeners: Record<string, Array<() => void>> = {};
  const chainMock = makeChainMock();

  const editor = {
    isActive: vi.fn((typeOrAttrs: string | Record<string, unknown>, attrs?: Record<string, unknown>) => {
      // Attrs-only form used by the TextAlign checks: isActive({ textAlign: 'center' })
      if (typeof typeOrAttrs === 'object') {
        const val = activeMap[`align-${String(typeOrAttrs['textAlign'])}`];
        return typeof val === 'function' ? val(typeOrAttrs) : Boolean(val);
      }
      if (attrs && typeOrAttrs === 'heading') {
        const level = attrs['level'];
        const key = `heading-${level}`;
        const val = activeMap[key];
        return typeof val === 'function' ? val(attrs) : Boolean(val);
      }
      const val = activeMap[typeOrAttrs];
      return typeof val === 'function' ? val() : Boolean(val);
    }),
    chain: vi.fn(() => chainMock),
    on: vi.fn((event: string, cb: () => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    off: vi.fn((event: string, cb: () => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== cb);
      }
    }),
    _listeners: listeners,
    _chain: chainMock,
  };
  return editor;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FormatToolbar', () => {
  it('renders skeleton placeholder when editor is null', () => {
    const { container } = render(<FormatToolbar editor={null} />);
    const skeleton = container.querySelector('.fmt-toolbar--skeleton');
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.fmt-btn')).toBeNull();
  });

  it('renders toolbar with role=toolbar and aria-label when editor is live', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar).toBeTruthy();
    expect(toolbar.getAttribute('aria-label')).toBe('Text formatting');
  });

  it('renders all expected buttons', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Italic' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Underline' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Strikethrough' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bullet list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Numbered list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Blockquote' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inline code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Code block' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Align left' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Align center' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Align right' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Justify' })).toBeTruthy();
  });

  it('renders heading select with Body option selected by default', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    const select = screen.getByRole('combobox', { name: 'Heading level' }) as HTMLSelectElement;
    expect(select.value).toBe('body');
  });

  it('heading select shows h2 when H2 is active', () => {
    const editor = makeEditorMock({ 'heading-2': true });
    render(<FormatToolbar editor={editor as never} />);
    const select = screen.getByRole('combobox', { name: 'Heading level' }) as HTMLSelectElement;
    expect(select.value).toBe('h2');
  });

  it.each([4, 5, 6] as const)('heading select offers and shows h%i when active', (level) => {
    const editor = makeEditorMock({ [`heading-${level}`]: true });
    render(<FormatToolbar editor={editor as never} />);
    const select = screen.getByRole('combobox', { name: 'Heading level' }) as HTMLSelectElement;
    expect(select.value).toBe(`h${level}`);
    expect(screen.getByRole('option', { name: new RegExp(`^H${level} `) })).toBeTruthy();
  });

  it.each([4, 5, 6] as const)('heading select change to h%i calls toggleHeading with that level', (level) => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    const select = screen.getByRole('combobox', { name: 'Heading level' });
    fireEvent.change(select, { target: { value: `h${level}` } });
    expect(editor._chain['toggleHeading']).toHaveBeenCalledWith({ level });
  });

  it('bold button has is-active class when bold is active', () => {
    const editor = makeEditorMock({ bold: true });
    render(<FormatToolbar editor={editor as never} />);
    const btn = screen.getByRole('button', { name: 'Bold' });
    expect(btn.classList.contains('is-active')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('bold button does not have is-active class when bold is inactive', () => {
    const editor = makeEditorMock({ bold: false });
    render(<FormatToolbar editor={editor as never} />);
    const btn = screen.getByRole('button', { name: 'Bold' });
    expect(btn.classList.contains('is-active')).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('italic button has is-active class when italic is active', () => {
    const editor = makeEditorMock({ italic: true });
    render(<FormatToolbar editor={editor as never} />);
    const btn = screen.getByRole('button', { name: 'Italic' });
    expect(btn.classList.contains('is-active')).toBe(true);
  });

  it('underline button has is-active class when underline is active', () => {
    const editor = makeEditorMock({ underline: true });
    render(<FormatToolbar editor={editor as never} />);
    const btn = screen.getByRole('button', { name: 'Underline' });
    expect(btn.classList.contains('is-active')).toBe(true);
  });

  it('mousedown on Bold calls chain().focus().toggleBold().run()', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    const btn = screen.getByRole('button', { name: 'Bold' });
    const event = { preventDefault: vi.fn(), type: 'mousedown' };
    fireEvent.mouseDown(btn, event);
    expect(editor.chain).toHaveBeenCalled();
    expect(editor._chain['focus']).toHaveBeenCalled();
    expect(editor._chain['toggleBold']).toHaveBeenCalled();
  });

  it('mousedown on Italic calls toggleItalic', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Italic' }));
    expect(editor._chain['toggleItalic']).toHaveBeenCalled();
  });

  it('mousedown on Underline calls toggleUnderline', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Underline' }));
    expect(editor._chain['toggleUnderline']).toHaveBeenCalled();
  });

  it('mousedown on Strikethrough calls toggleStrike', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Strikethrough' }));
    expect(editor._chain['toggleStrike']).toHaveBeenCalled();
  });

  it('mousedown on Bullet list calls toggleBulletList', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Bullet list' }));
    expect(editor._chain['toggleBulletList']).toHaveBeenCalled();
  });

  it('mousedown on Blockquote calls toggleBlockquote', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Blockquote' }));
    expect(editor._chain['toggleBlockquote']).toHaveBeenCalled();
  });

  it('heading select change to h1 calls toggleHeading with level 1', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    const select = screen.getByRole('combobox', { name: 'Heading level' });
    fireEvent.change(select, { target: { value: 'h1' } });
    expect(editor._chain['toggleHeading']).toHaveBeenCalledWith({ level: 1 });
  });

  it('heading select change to body calls setParagraph', () => {
    const editor = makeEditorMock({ 'heading-1': true });
    render(<FormatToolbar editor={editor as never} />);
    const select = screen.getByRole('combobox', { name: 'Heading level' });
    fireEvent.change(select, { target: { value: 'body' } });
    expect(editor._chain['setParagraph']).toHaveBeenCalled();
  });

  it('subscribes to selectionUpdate and transaction on mount', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    expect(editor.on).toHaveBeenCalledWith('selectionUpdate', expect.any(Function));
    expect(editor.on).toHaveBeenCalledWith('transaction', expect.any(Function));
  });

  it('unsubscribes from editor events on unmount', () => {
    const editor = makeEditorMock();
    const { unmount } = render(<FormatToolbar editor={editor as never} />);
    unmount();
    expect(editor.off).toHaveBeenCalledWith('selectionUpdate', expect.any(Function));
    expect(editor.off).toHaveBeenCalledWith('transaction', expect.any(Function));
  });
});

// ─── Alignment buttons (GH #642) — mocked editor ─────────────────────────────

describe('FormatToolbar alignment buttons', () => {
  const ALIGN_NAMES = ['Align left', 'Align center', 'Align right', 'Justify'];

  it('Align left reads pressed when no alignment is set (unset default)', () => {
    const editor = makeEditorMock();
    render(<FormatToolbar editor={editor as never} />);
    const pressed = ALIGN_NAMES.map(
      (name) => screen.getByRole('button', { name }).getAttribute('aria-pressed'),
    );
    expect(pressed).toEqual(['true', 'false', 'false', 'false']);
  });

  it('only the active alignment reads pressed when center is set', () => {
    const editor = makeEditorMock({ 'align-center': true });
    render(<FormatToolbar editor={editor as never} />);
    const pressed = ALIGN_NAMES.map(
      (name) => screen.getByRole('button', { name }).getAttribute('aria-pressed'),
    );
    expect(pressed).toEqual(['false', 'true', 'false', 'false']);
    expect(screen.getByRole('button', { name: 'Align center' }).classList.contains('is-active')).toBe(true);
  });

  it.each([['Align center', 'center'], ['Align right', 'right'], ['Justify', 'justify']])(
    'mousedown on %s calls setTextAlign(%s) when inactive',
    (name, align) => {
      const editor = makeEditorMock();
      render(<FormatToolbar editor={editor as never} />);
      fireEvent.mouseDown(screen.getByRole('button', { name }));
      expect(editor._chain['setTextAlign']).toHaveBeenCalledWith(align);
      expect(editor._chain['unsetTextAlign']).not.toHaveBeenCalled();
    },
  );

  it('mousedown on the already-active alignment calls unsetTextAlign (toggle off)', () => {
    const editor = makeEditorMock({ 'align-right': true });
    render(<FormatToolbar editor={editor as never} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Align right' }));
    expect(editor._chain['unsetTextAlign']).toHaveBeenCalled();
    expect(editor._chain['setTextAlign']).not.toHaveBeenCalled();
  });

  it('mousedown on Align left always calls unsetTextAlign, never setTextAlign', () => {
    const editor = makeEditorMock({ 'align-center': true });
    render(<FormatToolbar editor={editor as never} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Align left' }));
    expect(editor._chain['unsetTextAlign']).toHaveBeenCalled();
    expect(editor._chain['setTextAlign']).not.toHaveBeenCalled();
  });
});

// ─── Alignment buttons (GH #642) — real shared-schema editor ─────────────────
// Uses the same extension set sharedRichTextSchema.test.ts pins (the exact set
// useRichEditor wires up, minus the window.api-dependent resolution extension)
// so these tests fail if the toolbar drifts from the persistence contract.

function makeRealEditor(content: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false, heading: false }),
      AlignedParagraph,
      AlignedHeading,
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
      WikiLink,
      Markdown,
    ],
    content,
  });
}

function markdownOf(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown() as string;
}

describe('FormatToolbar alignment against the real shared schema', () => {
  it('clicking Align center persists a {.center} marker and flips pressed state', () => {
    const editor = makeRealEditor('Hello world.');
    render(<FormatToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Align center' }));
    expect(markdownOf(editor)).toContain('{.center}');
    expect(screen.getByRole('button', { name: 'Align center' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Align left' }).getAttribute('aria-pressed')).toBe('false');
    editor.destroy();
  });

  it('clicking Align left after center resets to the marker-free default', () => {
    const editor = makeRealEditor('Hello world.');
    render(<FormatToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Align center' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Align left' }));
    expect(markdownOf(editor).trim()).toBe('Hello world.');
    expect(screen.getByRole('button', { name: 'Align left' }).getAttribute('aria-pressed')).toBe('true');
    editor.destroy();
  });

  it('re-clicking the active alignment toggles back to the marker-free default', () => {
    const editor = makeRealEditor('Hello world.');
    render(<FormatToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Align right' }));
    expect(markdownOf(editor)).toContain('{.right}');
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Align right' }));
    expect(markdownOf(editor).trim()).toBe('Hello world.');
    editor.destroy();
  });

  it('clicking Align left on an untouched document keeps its markdown byte-stable', () => {
    const editor = makeRealEditor('Hello world.');
    render(<FormatToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Align left' }));
    expect(markdownOf(editor).trim()).toBe('Hello world.');
    editor.destroy();
  });

  it('aligns headings too — marker rides alongside the heading level', () => {
    const editor = makeRealEditor('## Scene Two');
    render(<FormatToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Justify' }));
    expect(markdownOf(editor).trim()).toBe('## Scene Two {.justify}');
    editor.destroy();
  });
});

// ─── Beta 3 M10 — Read / Dictate / Assist action cluster (prototype 766–777) ──

describe('FormatToolbar actions (Beta 3 M10)', () => {
  it('renders no action buttons when actions are not provided', () => {
    const editor = makeEditorMock();
    const { container } = render(<FormatToolbar editor={editor as never} />);
    expect(screen.queryByRole('button', { name: 'Read aloud' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dictate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open the Writing Assistant' })).toBeNull();
    expect(container.querySelector('.fmt-spacer')).toBeNull();
  });

  it('renders and fires each provided action without stealing editor focus', () => {
    const editor = makeEditorMock();
    const onRead = vi.fn();
    const onDictate = vi.fn();
    const onAssist = vi.fn();
    render(
      <FormatToolbar editor={editor as never} actions={{ onRead, onDictate, onAssist }} />
    );
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Read aloud' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Dictate' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Open the Writing Assistant' }));
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onDictate).toHaveBeenCalledTimes(1);
    expect(onAssist).toHaveBeenCalledTimes(1);
  });

  it('renders only the buttons whose handlers exist and reflects dictation state', () => {
    const editor = makeEditorMock();
    render(
      <FormatToolbar editor={editor as never} actions={{ onDictate: vi.fn(), dictating: true }} />
    );
    expect(screen.queryByRole('button', { name: 'Read aloud' })).toBeNull();
    const dictate = screen.getByRole('button', { name: 'Dictate' });
    expect(dictate.getAttribute('aria-pressed')).toBe('true');
    expect(dictate.className).toContain('fmt-action--dictate-on');
  });
});
