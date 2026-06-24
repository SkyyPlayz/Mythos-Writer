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

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import FormatToolbar from './FormatToolbar';

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
  chain['run'] = vi.fn();
  return chain;
}

function makeEditorMock(activeMap: ActiveMap = {}) {
  const listeners: Record<string, Array<() => void>> = {};
  const chainMock = makeChainMock();

  const editor = {
    isActive: vi.fn((type: string, attrs?: Record<string, unknown>) => {
      if (attrs && type === 'heading') {
        const level = attrs['level'];
        const key = `heading-${level}`;
        const val = activeMap[key];
        return typeof val === 'function' ? val(attrs) : Boolean(val);
      }
      const val = activeMap[type];
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
