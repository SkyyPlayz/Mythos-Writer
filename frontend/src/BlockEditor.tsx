import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useRef, useState, useEffect, useCallback } from 'react';
import type { Block, Scene, DraftState } from './types';
import { WikiLink } from './WikiLinkExtension';
import { WikiLinkHintExtension, WIKI_LINK_HINT_META, type WLSuggestion } from './WikiLinkHintExtension';
import SceneHistory from './SceneHistory';
import './BlockEditor.css';

export interface BlockEditorApi {
  jumpToText: (text: string) => void;
  insertWikiLink: (link: string, anchorText: string) => void;
}

interface Props {
  scene: Scene;
  onBlocksChange: (blocks: Block[]) => void;
  onDraftStateChange: (state: DraftState) => void;
  onEditorReady?: (api: BlockEditorApi) => void;
  /** Called when user triggers Beta-Read on a selection. */
  onBetaReadRequest?: (selectedText: string) => void;
  /** Archive wiki-link suggestions to highlight inline. */
  wikiLinkSuggestions?: WLSuggestion[];
  onAcceptWikiLink?: (id: string, link: string, anchorText: string) => void;
  onRejectWikiLink?: (id: string) => void;
}

const DRAFT_STATE_LABELS: Record<DraftState, string> = {
  'in-progress': 'In Progress',
  review: 'Review',
  final: 'Final',
};

export function blocksToMarkdownBody(blocks: Block[]): string {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  const lines: string[] = [];
  for (const block of sorted) {
    if (!block.content.trim()) continue;
    switch (block.type) {
      case 'heading': lines.push(`# ${block.content}`); break;
      case 'dialogue': lines.push(`> ${block.content}`); break;
      case 'action': lines.push(`**${block.content}**`); break;
      case 'description': lines.push(`*${block.content}*`); break;
      case 'note': lines.push(`<!-- ${block.content} -->`); break;
      default: lines.push(block.content);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export default function BlockEditor({ scene, onBlocksChange, onDraftStateChange, onEditorReady, onBetaReadRequest, wikiLinkSuggestions, onAcceptWikiLink, onRejectWikiLink }: Props) {
  const [draftState, setDraftState] = useState<DraftState>(scene.draftState ?? 'in-progress');
  const [selectionText, setSelectionText] = useState<string>('');
  const [betaReadBubble, setBetaReadBubble] = useState<{ top: number; left: number } | null>(null);
  const [hintTooltip, setHintTooltip] = useState<{
    id: string; link: string; anchor: string; top: number; left: number;
  } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const lastSnapshotContentRef = useRef<string>('');
  const onAcceptWikiLinkRef = useRef(onAcceptWikiLink);
  onAcceptWikiLinkRef.current = onAcceptWikiLink;
  const onRejectWikiLinkRef = useRef(onRejectWikiLink);
  onRejectWikiLinkRef.current = onRejectWikiLink;
  const changeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBlocksChangeRef = useRef(onBlocksChange);
  onBlocksChangeRef.current = onBlocksChange;
  const blockIdRef = useRef(scene.blocks[0]?.id ?? crypto.randomUUID());
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const onBetaReadRef = useRef(onBetaReadRequest);
  onBetaReadRef.current = onBetaReadRequest;
  const editorWrapRef = useRef<HTMLDivElement | null>(null);

  const editor = useEditor({
    extensions: [StarterKit, WikiLink, WikiLinkHintExtension, Markdown],
    content: blocksToMarkdownBody(scene.blocks),
    onUpdate({ editor }) {
      // tiptap-markdown adds storage.markdown at runtime; cast to bypass static type gap
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (editor.storage as any).markdown.getMarkdown() as string;
      // tiptap-markdown v0.9 omits a trailing newline; add it for tooling compatibility.
      const markdown = raw.endsWith('\n') ? raw : `${raw}\n`;
      if (changeRef.current) clearTimeout(changeRef.current);
      changeRef.current = setTimeout(() => {
        onBlocksChangeRef.current([{
          id: blockIdRef.current,
          type: 'prose',
          content: markdown,
          order: 0,
          updatedAt: new Date().toISOString(),
        }]);
      }, 800);
    },
    onSelectionUpdate({ editor }) {
      const { from, to } = editor.state.selection;
      const text = from === to ? '' : editor.state.doc.textBetween(from, to, ' ');
      const trimmed = text.trim();
      setSelectionText(trimmed);
      if (trimmed.length > 3 && editorWrapRef.current) {
        // Position the bubble relative to the editorWrap using the native selection
        const nativeSel = window.getSelection();
        if (nativeSel && nativeSel.rangeCount > 0) {
          const range = nativeSel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const wrapRect = editorWrapRef.current.getBoundingClientRect();
          setBetaReadBubble({
            top: rect.top - wrapRect.top - 36,
            left: Math.max(0, rect.left - wrapRect.left + rect.width / 2 - 52),
          });
        } else {
          setBetaReadBubble(null);
        }
      } else {
        setBetaReadBubble(null);
      }
    },
  });

  // Expose jump-to-text and insert-wiki-link APIs to the parent once the editor is ready
  useEffect(() => {
    if (!editor) return;
    const cb = onEditorReadyRef.current;
    if (!cb) return;

    const findTextRange = (text: string): { from: number; to: number } | null => {
      const needle = text.toLowerCase();
      let result: { from: number; to: number } | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (result) return false;
        if (node.isText && node.text) {
          const idx = node.text.toLowerCase().indexOf(needle);
          if (idx >= 0) {
            result = { from: pos + idx, to: pos + idx + text.length };
          }
        }
        return true;
      });
      return result;
    };

    cb({
      jumpToText: (text: string) => {
        const range = findTextRange(text);
        if (range) {
          editor.commands.setTextSelection(range);
          editor.commands.scrollIntoView();
        }
      },
      insertWikiLink: (link: string, anchorText: string) => {
        const range = findTextRange(anchorText);
        if (range) {
          editor.chain().setTextSelection(range).insertContent(link).run();
        } else {
          editor.chain().focus().insertContent(link).run();
        }
      },
    });
  // Run only when the editor instance changes (new scene key causes remount)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Push updated wiki-link hint suggestions into the ProseMirror plugin
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(WIKI_LINK_HINT_META, wikiLinkSuggestions ?? [])
    );
  }, [editor, wikiLinkSuggestions]);

  const handleHintMouseOver = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.archive-wl-hint') as HTMLElement | null;
    if (!el || !editorWrapRef.current) return;
    const rect = el.getBoundingClientRect();
    const wrapRect = editorWrapRef.current.getBoundingClientRect();
    setHintTooltip({
      id: el.dataset.wlId ?? '',
      link: el.dataset.wlLink ?? '',
      anchor: el.dataset.wlAnchor ?? '',
      top: rect.bottom - wrapRect.top + 6,
      left: rect.left - wrapRect.left,
    });
  }, []);

  const handleHintMouseLeave = useCallback((e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest('.wl-hint-tooltip')) return;
    setHintTooltip(null);
  }, []);

  const handleDraftChange = (state: DraftState) => {
    setDraftState(state);
    onDraftStateChange(state);
  };

  const handleBetaReadClick = useCallback(() => {
    if (!selectionText) return;
    onBetaReadRef.current?.(selectionText);
    setBetaReadBubble(null);
    setSelectionText('');
    editor?.commands.setTextSelection(editor.state.selection.from);
  }, [selectionText, editor]);

  const getCurrentMarkdown = useCallback((): string => {
    if (!editor) return '';
    const raw = (editor.storage as any).markdown.getMarkdown() as string; // eslint-disable-line @typescript-eslint/no-explicit-any
    return raw.endsWith('\n') ? raw : `${raw}\n`;
  }, [editor]);

  const takeSnapshot = useCallback(async () => {
    const markdown = getCurrentMarkdown();
    if (markdown === lastSnapshotContentRef.current) return;
    try {
      await window.api.snapshotSave(scene.id, markdown);
      lastSnapshotContentRef.current = markdown;
      setLastSavedAt(new Date().toLocaleTimeString());
    } catch {
      // non-fatal
    }
  }, [getCurrentMarkdown, scene.id]);

  const handleRestore = useCallback((restoredContent: string) => {
    if (!editor) return;
    editor.commands.setContent(restoredContent);
    lastSnapshotContentRef.current = restoredContent;
    setShowHistory(false);
  }, [editor]);

  return (
    <div className="block-editor">
      <div className="block-editor-toolbar">
        <span className="scene-name">{scene.title}</span>
        <div className="draft-state-group">
          {(Object.keys(DRAFT_STATE_LABELS) as DraftState[]).map((s) => (
            <button
              key={s}
              className={`draft-btn draft-${s}${draftState === s ? ' active' : ''}`}
              onClick={() => handleDraftChange(s)}
              aria-pressed={draftState === s}
            >
              {DRAFT_STATE_LABELS[s]}
            </button>
          ))}
        </div>
        <span className="scene-autosave">
          {lastSavedAt ? `Snapshot saved ${lastSavedAt}` : 'No snapshot yet'}
        </span>
        <button className="btn-save-snapshot" onClick={takeSnapshot}>
          Save snapshot now
        </button>
        <button className="btn-history" onClick={() => setShowHistory(true)}>
          History
        </button>
      </div>
      <div
        className="tiptap-editor-wrap"
        ref={editorWrapRef}
        style={{ position: 'relative' }}
        onMouseOver={handleHintMouseOver}
        onMouseLeave={handleHintMouseLeave}
      >
        {hintTooltip && (
          <div
            className="wl-hint-tooltip"
            style={{ top: hintTooltip.top, left: hintTooltip.left }}
            onMouseLeave={() => setHintTooltip(null)}
          >
            <span className="wl-hint-tooltip-link">{hintTooltip.link}</span>
            <button
              className="wl-hint-btn wl-hint-accept"
              onMouseDown={(e) => {
                e.preventDefault();
                onAcceptWikiLinkRef.current?.(hintTooltip.id, hintTooltip.link, hintTooltip.anchor);
                setHintTooltip(null);
              }}
              aria-label={`Accept wiki-link ${hintTooltip.link}`}
            >
              Accept
            </button>
            <button
              className="wl-hint-btn wl-hint-reject"
              onMouseDown={(e) => {
                e.preventDefault();
                onRejectWikiLinkRef.current?.(hintTooltip.id);
                setHintTooltip(null);
              }}
              aria-label={`Reject wiki-link ${hintTooltip.link}`}
            >
              Reject
            </button>
          </div>
        )}
        {betaReadBubble && (
          <button
            className="beta-read-bubble"
            style={{ top: betaReadBubble.top, left: betaReadBubble.left }}
            onMouseDown={(e) => { e.preventDefault(); handleBetaReadClick(); }}
            aria-label="Beta-read selected text"
            title="Send to Beta-Read assistant"
          >
            Beta-Read
          </button>
        )}
        <EditorContent editor={editor} className="tiptap-content" />
      </div>

      {showHistory && (
        <SceneHistory
          sceneId={scene.id}
          scenePath={scene.path}
          currentContent={getCurrentMarkdown()}
          onRestore={handleRestore}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
