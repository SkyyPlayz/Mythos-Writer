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

interface Props {
  editor: Editor | null;
}

/**
 * Word-style formatting toolbar bound to Tiptap commands.
 * Subscribes to editor selection/transaction events so active-mark state
 * stays current without the parent needing to lift any state.
 */
export default function FormatToolbar({ editor }: Props) {
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

  function applyHeading(value: string) {
    if (!editor) return;
    if (value === 'body') {
      ed.chain().focus().setParagraph().run();
    } else {
      const level = parseInt(value[1], 10) as HeadingLevel;
      ed.chain().focus().toggleHeading({ level }).run();
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
    </div>
  );
}
