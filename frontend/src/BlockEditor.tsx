import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useRef, useState, useEffect, useCallback } from 'react';
import type { Block, Scene, DraftState, WritingMode, HeaderDepth } from './types';
import { WikiLink } from './WikiLinkExtension';
import SceneHistory from './SceneHistory';
import './BlockEditor.css';

export interface BlockEditorApi {
  jumpToText: (text: string) => void;
  insertWikiLink: (link: string, anchorText: string) => void;
}

type AgentSource = 'writing-assistant' | 'brainstorm' | 'archive';

const AGENT_LABELS: Record<AgentSource, string> = {
  'writing-assistant': 'Writing Assistant',
  brainstorm: 'Brainstorm',
  archive: 'Archive',
};

interface InlineSuggestion {
  id: string;
  source_agent: AgentSource;
  target: string;
  confidence: number;
  rationale: string;
  payload?: string;
  status: string;
}

interface EditOverlayProps {
  scenePath: string;
}

function EditSuggestionOverlay({ scenePath }: EditOverlayProps) {
  const [suggestions, setSuggestions] = useState<InlineSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = (window as unknown as Window).api;
        if (typeof api?.suggestionsList === 'function') {
          const result = await api.suggestionsList();
          if (!cancelled) {
            const proposed = (result.suggestions ?? []).filter(
              (s: Suggestion) => s.status === 'proposed'
            );
            setSuggestions(proposed as InlineSuggestion[]);
          }
        }
      } catch {
        // non-fatal — overlay stays empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scenePath]);

  const handleAction = useCallback(async (id: string, action: 'accept' | 'reject') => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    try {
      const api = (window as unknown as Window).api;
      if (action === 'accept') {
        await api.suggestionsAccept?.(id);
      } else {
        await api.suggestionsReject?.(id);
      }
    } catch {
      // optimistic update already applied
    }
  }, []);

  if (loading) {
    return (
      <div className="edit-overlay edit-overlay-loading" aria-label="Loading suggestions" aria-live="polite">
        <span className="edit-overlay-spinner" aria-hidden="true" /> Loading suggestions…
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="edit-overlay edit-overlay-empty" role="status">
        <span className="edit-overlay-check" aria-hidden="true">✓</span>
        No pending suggestions — all caught up!
      </div>
    );
  }

  return (
    <div className="edit-overlay" role="region" aria-label="Edit mode suggestions">
      <div className="edit-overlay-header">
        <button
          className="edit-overlay-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse suggestions' : 'Expand suggestions'}
        >
          <span className="edit-overlay-toggle-icon" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          Suggestions
        </button>
        <span className="edit-overlay-count" aria-label={`${suggestions.length} pending`}>
          {suggestions.length}
        </span>
      </div>
      {expanded && (
        <ul className="edit-overlay-list" aria-label="Pending suggestions">
          {suggestions.map((s) => {
            const confidencePct = Math.round(s.confidence * 100);
            return (
              <li key={s.id} className="edit-suggestion-item" aria-label={`${AGENT_LABELS[s.source_agent] ?? s.source_agent} suggestion`}>
                <div className="edit-suggestion-meta">
                  <span className={`edit-agent-badge edit-agent-${s.source_agent}`}>
                    {AGENT_LABELS[s.source_agent] ?? s.source_agent}
                  </span>
                  <span className="edit-suggestion-confidence" aria-label={`Confidence ${confidencePct}%`}>
                    {confidencePct}%
                  </span>
                </div>
                <p className="edit-suggestion-rationale">{s.rationale}</p>
                {s.payload && (
                  <p className="edit-suggestion-payload">{s.payload}</p>
                )}
                <div className="edit-suggestion-actions">
                  <button
                    className="edit-btn edit-btn-accept"
                    onClick={() => handleAction(s.id, 'accept')}
                    aria-label={`Accept ${AGENT_LABELS[s.source_agent] ?? s.source_agent} suggestion`}
                  >
                    Accept
                  </button>
                  <button
                    className="edit-btn edit-btn-reject"
                    onClick={() => handleAction(s.id, 'reject')}
                    aria-label={`Reject ${AGENT_LABELS[s.source_agent] ?? s.source_agent} suggestion`}
                  >
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface Props {
  scene: Scene;
  onBlocksChange: (blocks: Block[]) => void;
  onDraftStateChange: (state: DraftState) => void;
  onEditorReady?: (api: BlockEditorApi) => void;
  writingMode?: WritingMode;
  // Beta-read and wiki-link props passed from DesktopShell (consumed there, not in this component)
  onBetaReadRequest?: (selectedText: string) => void;
  wikiLinkSuggestions?: unknown[];
  onAcceptWikiLink?: (id: string, link: string, anchorText: string) => void;
  onRejectWikiLink?: (id: string) => void;
  // Header depth slider
  headerDepth?: HeaderDepth;
  onHeaderDepthChange?: (depth: HeaderDepth) => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  canNavigatePrev?: boolean;
  canNavigateNext?: boolean;
  sectionLabel?: string;
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

const DEPTH_LABELS: Record<HeaderDepth, string> = {
  book: 'Book',
  chapter: 'Chapter',
  scene: 'Scene',
};

export default function BlockEditor({ scene, onBlocksChange, onDraftStateChange, onEditorReady, writingMode, headerDepth, onHeaderDepthChange, onNavigate, canNavigatePrev, canNavigateNext, sectionLabel }: Props) {
  const [draftState, setDraftState] = useState<DraftState>(scene.draftState ?? 'in-progress');
  const [showHistory, setShowHistory] = useState(false);
  const changeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBlocksChangeRef = useRef(onBlocksChange);
  onBlocksChangeRef.current = onBlocksChange;
  const blockIdRef = useRef(scene.blocks[0]?.id ?? crypto.randomUUID());
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

  const editor = useEditor({
    extensions: [StarterKit, WikiLink, Markdown],
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

  const handleDraftChange = (state: DraftState) => {
    setDraftState(state);
    onDraftStateChange(state);
  };

  const handleHistoryRestore = (content: string) => {
    if (!editor) return;
    editor.commands.setContent(content);
    setShowHistory(false);
  };

  const currentEditorContent = editor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (editor.storage as any).markdown?.getMarkdown?.() ?? ''
    : blocksToMarkdownBody(scene.blocks);

  const activeDepth: HeaderDepth = headerDepth ?? 'scene';
  const displayLabel = sectionLabel ?? scene.title;

  return (
    <div className="block-editor">
      <div className="block-editor-toolbar">
        <div className="toolbar-left">
          <div className="depth-nav-group">
            <button
              className="depth-nav-arrow"
              disabled={!canNavigatePrev}
              onClick={() => onNavigate?.('prev')}
              aria-label="Previous section"
              title="Previous section"
            >
              ‹
            </button>
            <span className="depth-section-label" title={displayLabel}>{displayLabel}</span>
            <button
              className="depth-nav-arrow"
              disabled={!canNavigateNext}
              onClick={() => onNavigate?.('next')}
              aria-label="Next section"
              title="Next section"
            >
              ›
            </button>
          </div>
          {onHeaderDepthChange && (
            <div className="depth-selector" role="group" aria-label="View depth">
              {(Object.keys(DEPTH_LABELS) as HeaderDepth[]).map((d) => (
                <button
                  key={d}
                  className={`depth-btn${activeDepth === d ? ' active' : ''}`}
                  onClick={() => onHeaderDepthChange(d)}
                  aria-pressed={activeDepth === d}
                  title={`${DEPTH_LABELS[d]} view`}
                >
                  {DEPTH_LABELS[d]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="toolbar-right">
          <div className="draft-state-group">
            {(Object.keys(DRAFT_STATE_LABELS) as DraftState[]).map((s) => (
              <button
                key={s}
                className={`draft-btn draft-${s}${draftState === s ? ' active' : ''}`}
                onClick={() => handleDraftChange(s)}
              >
                {DRAFT_STATE_LABELS[s]}
              </button>
            ))}
          </div>
          <button className="btn-history" onClick={() => setShowHistory(true)}>History</button>
        </div>
      </div>
      {writingMode === 'edit' && (
        <EditSuggestionOverlay scenePath={scene.path} />
      )}
      <div className="tiptap-editor-wrap">
        <EditorContent editor={editor} className="tiptap-content" />
      </div>
      {showHistory && (
        <SceneHistory
          sceneId={scene.id}
          scenePath={scene.path}
          currentContent={currentEditorContent}
          onRestore={handleHistoryRestore}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
