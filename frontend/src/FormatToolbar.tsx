import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import './FormatToolbar.css';

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const HEADING_LEVELS: HeadingLevel[] = [1, 2, 3, 4, 5, 6];

function getActiveHeadingValue(editor: Editor): string {
  for (const level of HEADING_LEVELS) {
    if (editor.isActive('heading', { level })) return `h${level}`;
  }
  return 'body';
}

type TextAlignment = 'left' | 'center' | 'right' | 'justify';

// Shortcuts match the TextAlign extension's built-in keymap (Mod-Shift-L/E/R/J).
const ALIGNMENTS: Array<{ align: TextAlignment; label: string; shortcut: string }> = [
  { align: 'left',    label: 'Align left',    shortcut: 'Ctrl+Shift+L' },
  { align: 'center',  label: 'Align center',  shortcut: 'Ctrl+Shift+E' },
  { align: 'right',   label: 'Align right',   shortcut: 'Ctrl+Shift+R' },
  { align: 'justify', label: 'Justify',       shortcut: 'Ctrl+Shift+J' },
];

// Four-line "paragraph" glyph; per-line x-extents encode the alignment.
const ALIGN_ICON_X: Record<TextAlignment, Array<[number, number]>> = {
  left:    [[1.5, 12.5], [1.5, 8.5],  [1.5, 12.5], [1.5, 8.5]],
  center:  [[1.5, 12.5], [3.5, 10.5], [1.5, 12.5], [3.5, 10.5]],
  right:   [[1.5, 12.5], [5.5, 12.5], [1.5, 12.5], [5.5, 12.5]],
  justify: [[1.5, 12.5], [1.5, 12.5], [1.5, 12.5], [1.5, 12.5]],
};

function AlignIcon({ align }: { align: TextAlignment }) {
  return (
    <svg
      className="fmt-align-icon"
      viewBox="0 0 14 14"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      {ALIGN_ICON_X[align].map(([x1, x2], i) => (
        <line
          key={i}
          x1={x1}
          y1={2.5 + i * 3}
          x2={x2}
          y2={2.5 + i * 3}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/**
 * Beta 3 M10 — optional Read / Dictate / Assist buttons (Liquid Neon
 * prototype toolbar 766–777, dictBtnSt/dictDotSt 4815–4816). Each button
 * renders only when its handler is provided, so surfaces that reuse this
 * toolbar without voice/assistant wiring (e.g. Notes) are unchanged.
 */
export interface FormatToolbarActions {
  onRead?: () => void;
  onDictate?: () => void;
  dictating?: boolean;
  onAssist?: () => void;
}

interface Props {
  editor: Editor | null;
  actions?: FormatToolbarActions;
}

/**
 * Word-style formatting toolbar bound to Tiptap commands.
 * Subscribes to editor selection/transaction events so active-mark state
 * stays current without the parent needing to lift any state.
 */
export default function FormatToolbar({ editor, actions }: Props) {
  // Force re-render on every selection change / transaction so isActive() is fresh.
  const [, tick] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const update = () => tick(n => n + 1);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  if (!editor) {
    // Skeleton bar keeps layout stable while editor initialises.
    return <div className="fmt-toolbar fmt-toolbar--skeleton" aria-hidden="true" />;
  }

  const ed = editor; // narrowed — closures don't inherit outer narrowing
  const headingValue = getActiveHeadingValue(ed);
  const isBold      = ed.isActive('bold');
  const isItalic    = ed.isActive('italic');
  const isUnderline = ed.isActive('underline');
  const isStrike    = ed.isActive('strike');
  const isBullet    = ed.isActive('bulletList');
  const isOrdered   = ed.isActive('orderedList');
  const isQuote     = ed.isActive('blockquote');
  const isCode      = ed.isActive('code');
  const isCodeBlock = ed.isActive('codeBlock');

  // TextAlign ships defaultAlignment: null, so an untouched block reports no
  // textAlign attr at all — fold that unset default into "left" so exactly one
  // alignment button reads pressed at any time (GH #642).
  const isAlignCenter  = ed.isActive({ textAlign: 'center' });
  const isAlignRight   = ed.isActive({ textAlign: 'right' });
  const isAlignJustify = ed.isActive({ textAlign: 'justify' });
  const isAlignLeft    = ed.isActive({ textAlign: 'left' })
    || (!isAlignCenter && !isAlignRight && !isAlignJustify);
  const alignActive: Record<TextAlignment, boolean> = {
    left: isAlignLeft, center: isAlignCenter, right: isAlignRight, justify: isAlignJustify,
  };

  function applyHeading(value: string) {
    if (!editor) return;
    if (value === 'body') {
      ed.chain().focus().setParagraph().run();
    } else {
      const level = parseInt(value[1], 10) as HeadingLevel;
      ed.chain().focus().toggleHeading({ level }).run();
    }
  }

  function applyAlign(align: TextAlignment) {
    if (!editor) return;
    // `left` is the persisted default (alignedBlocks.ts never writes a marker
    // for it), so clicking Left — or re-clicking the active alignment — resets
    // the attribute entirely, keeping unaligned documents byte-stable on disk.
    if (align === 'left' || ed.isActive({ textAlign: align })) {
      ed.chain().focus().unsetTextAlign().run();
    } else {
      ed.chain().focus().setTextAlign(align).run();
    }
  }

  return (
    <div
      className="fmt-toolbar"
      role="toolbar"
      aria-label="Text formatting"
    >
      {/* ── Heading / paragraph select ───────────────────────────────── */}
      <select
        className="fmt-heading-select"
        value={headingValue}
        aria-label="Heading level"
        title="Heading level"
        onChange={(e) => applyHeading(e.target.value)}
      >
        <option value="body">Body</option>
        <option value="h1">H1 — Heading 1</option>
        <option value="h2">H2 — Heading 2</option>
        <option value="h3">H3 — Heading 3</option>
        <option value="h4">H4 — Heading 4</option>
        <option value="h5">H5 — Heading 5</option>
        <option value="h6">H6 — Heading 6</option>
      </select>

      <div className="fmt-sep" role="separator" aria-orientation="vertical" />

      {/* ── Inline marks ─────────────────────────────────────────────── */}
      <button
        type="button"
        className={`fmt-btn fmt-btn--bold${isBold ? ' is-active' : ''}`}
        aria-label="Bold"
        aria-pressed={isBold}
        title="Bold (Ctrl+B)"
        onMouseDown={(e) => { e.preventDefault(); ed.chain().focus().toggleBold().run(); }}
      >
        <strong>B</strong>
      </button>

      <button
        type="button"
        className={`fmt-btn fmt-btn--italic${isItalic ? ' is-active' : ''}`}
        aria-label="Italic"
        aria-pressed={isItalic}
        title="Italic (Ctrl+I)"
        onMouseDown={(e) => { e.preventDefault(); ed.chain().focus().toggleItalic().run(); }}
      >
        <em>I</em>
      </button>

      <button
        type="button"
        className={`fmt-btn fmt-btn--underline${isUnderline ? ' is-active' : ''}`}
        aria-label="Underline"
        aria-pressed={isUnderline}
        title="Underline (Ctrl+U)"
        onMouseDown={(e) => { e.preventDefault(); ed.chain().focus().toggleUnderline().run(); }}
      >
        <span style={{ textDecoration: 'underline' }}>U</span>
      </button>

      <button
        type="button"
        className={`fmt-btn fmt-btn--strike${isStrike ? ' is-active' : ''}`}
        aria-label="Strikethrough"
        aria-pressed={isStrike}
        title="Strikethrough"
        onMouseDown={(e) => { e.preventDefault(); ed.chain().focus().toggleStrike().run(); }}
      >
        <s>S</s>
      </button>

      <div className="fmt-sep" role="separator" aria-orientation="vertical" />

      {/* ── Block nodes ──────────────────────────────────────────────── */}
      <button
        type="button"
        className={`fmt-btn${isBullet ? ' is-active' : ''}`}
        aria-label="Bullet list"
        aria-pressed={isBullet}
        title="Bullet list"
        onMouseDown={(e) => { e.preventDefault(); ed.chain().focus().toggleBulletList().run(); }}
      >
        <span aria-hidden="true" className="fmt-list-icon">•≡</span>
      </button>

      <button
        type="button"
        className={`fmt-btn${isOrdered ? ' is-active' : ''}`}
        aria-label="Numbered list"
        aria-pressed={isOrdered}
        title="Numbered list"
        onMouseDown={(e) => { e.preventDefault(); ed.chain().focus().toggleOrderedList().run(); }}
      >
        <span aria-hidden="true" className="fmt-list-icon">1≡</span>
      </button>

      <button
        type="button"
        className={`fmt-btn${isQuote ? ' is-active' : ''}`}
        aria-label="Blockquote"
        aria-pressed={isQuote}
        title="Blockquote"
        onMouseDown={(e) => { e.preventDefault(); ed.chain().focus().toggleBlockquote().run(); }}
      >
        <span aria-hidden="true">❝</span>
      </button>

      <div className="fmt-sep" role="separator" aria-orientation="vertical" />

      {/* ── Text alignment (GH #642) ─────────────────────────────────── */}
      {ALIGNMENTS.map(({ align, label, shortcut }) => (
        <button
          key={align}
          type="button"
          className={`fmt-btn${alignActive[align] ? ' is-active' : ''}`}
          aria-label={label}
          aria-pressed={alignActive[align]}
          title={`${label} (${shortcut})`}
          onMouseDown={(e) => { e.preventDefault(); applyAlign(align); }}
        >
          <AlignIcon align={align} />
        </button>
      ))}

      <div className="fmt-sep" role="separator" aria-orientation="vertical" />

      {/* ── Code ─────────────────────────────────────────────────────── */}
      <button
        type="button"
        className={`fmt-btn fmt-btn--mono${isCode ? ' is-active' : ''}`}
        aria-label="Inline code"
        aria-pressed={isCode}
        title="Inline code"
        onMouseDown={(e) => { e.preventDefault(); ed.chain().focus().toggleCode().run(); }}
      >
        <span aria-hidden="true">{"`·`"}</span>
      </button>

      <button
        type="button"
        className={`fmt-btn fmt-btn--mono${isCodeBlock ? ' is-active' : ''}`}
        aria-label="Code block"
        aria-pressed={isCodeBlock}
        title="Code block"
        onMouseDown={(e) => { e.preventDefault(); ed.chain().focus().toggleCodeBlock().run(); }}
      >
        <span aria-hidden="true">{"{ }"}</span>
      </button>

      {/* ── Read / Dictate / Assist (Beta 3 M10, prototype 766–777) ──── */}
      {(actions?.onRead || actions?.onDictate || actions?.onAssist) && (
        <div className="fmt-spacer" aria-hidden="true" />
      )}
      {actions?.onRead && (
        <button
          type="button"
          className="fmt-action fmt-action--read"
          aria-label="Read aloud"
          title="Read aloud"
          onMouseDown={(e) => { e.preventDefault(); actions.onRead?.(); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 10v4h4l5 4V6l-5 4z" />
            <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" />
          </svg>
          Read
        </button>
      )}
      {actions?.onDictate && (
        <button
          type="button"
          className={`fmt-action fmt-action--dictate${actions.dictating ? ' fmt-action--dictate-on' : ''}`}
          aria-label="Dictate"
          aria-pressed={!!actions.dictating}
          title="Dictate"
          onMouseDown={(e) => { e.preventDefault(); actions.onDictate?.(); }}
        >
          <span className="fmt-dict-dot" aria-hidden="true" />
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <rect x="9.5" y="3.5" width="5" height="10" rx="2.5" />
            <path d="M6 11a6 6 0 0 0 12 0M12 17v3.5" />
          </svg>
          Dictate
        </button>
      )}
      {actions?.onAssist && (
        <button
          type="button"
          className="fmt-action fmt-action--assist"
          aria-label="Open the Writing Coach"
          title="Open the Writing Coach"
          onMouseDown={(e) => { e.preventDefault(); actions.onAssist?.(); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
            <circle cx="12" cy="12" r="3.4" />
          </svg>
          Assist
        </button>
      )}
    </div>
  );
}
