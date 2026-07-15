// Beta 3 M9+M10 — Heading-zoom manuscript view (the centerpiece).
//
// Renders the continuous manuscript sheet from the Liquid Neon prototype
// (design-handoff/prototype/"Mythos Writer - Liquid Neon.dc.html": zoom
// control 718–722, chevrons 723–728, breadcrumbs 729–734, page-width slider
// 736–740, toolbar v2 742–777 (fmtBtns/alignBtns/listBtns 4111–4114,
// dictBtnSt 4815), floating page arrows 809–810, sheet + runes + edge drag
// 851–906 (startDrag 3392–3400), paragraph grip drag 3705–3719, ←/→ keys
// 3919–3922) on top of the pure model in manuscriptModel.ts.
//
// Self-contained: pure UI + local fold/width/toolbar state. Persistence stays
// with the caller via onEditParagraph / onCycleStatus / onCursorChange /
// onMoveParagraph / onPageWidthChange.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type UIEvent,
} from 'react';
import {
  breadcrumbs,
  buildBlocks,
  zoomStep,
  type ManuscriptBlock,
  type ManuscriptCursor,
  type ParagraphRef,
  type SceneStatus,
  type ZoomLevel,
} from './manuscriptModel';
import { pageModeChrome, PageModeRunes } from './pageMode';
import type { LiquidNeonV2Settings } from '../theme/liquidNeonEngine';
import {
  AGENT_ACTION_SUCCESS_TOAST,
  findAnchorSceneId,
  isValidAnchor,
  runAgentAction,
  useStoryComments,
  type AgentAction,
  type StoryComment,
} from '../comments';
import CommentSelectionBar from './CommentSelectionBar';
import CommentsGutter from './CommentsGutter';
import ParagraphRow from './ParagraphRow';
import { buildEntityTerms, type AutoLinkerMode } from '../AutoLinkerExtension';
import {
  applyAllAutoLinkHints,
  applyAutoLinkHint,
  wikiLinkFor,
  type EntityMatch,
} from './autoLinkText';
import ReaderBar from './ReaderBar';
import { useManuscriptReader } from './useManuscriptReader';
import { showLnToast } from '../theme/lnToast';
import type { TtsEngineSettings, TtsVoicePrefs } from '../hooks/useTtsPlayer';
import type { Story } from '../types';
import './ManuscriptView.css';

export interface ManuscriptViewProps {
  story: Story;
  cursor: ManuscriptCursor;
  onCursorChange: (cursor: ManuscriptCursor) => void;
  /** Fired on blur/Enter of an edited paragraph with the new plain text. */
  onEditParagraph: (sceneId: string, blockId: string, newText: string) => void;
  /** Fired when a scene's status dot is clicked (todo → draft → done → todo). */
  onCycleStatus: (sceneId: string) => void;
  /** Initial sheet width in px (prototype default 1000, range 520–3000). */
  pageWidth?: number;
  /** M10: fired when the width slider or a page-edge drag commits a new width. */
  onPageWidthChange?: (px: number) => void;
  /** M10: grip drag dropped one paragraph onto another (lands before target). */
  onMoveParagraph?: (from: ParagraphRef, to: ParagraphRef) => void;
  /** M10: Liquid Neon v2 settings driving the page-mode sheet chrome (M4's pageCfg). */
  liquidNeon?: Partial<LiquidNeonV2Settings> | null;
  /**
   * M10 toolbar actions (prototype 766–777). Dictate/Assist hide when their
   * handler is absent. Read is built in (W0.4): the toolbar's single Read
   * button toggles the M13 reader dock — the old zoombar reader chip and the
   * onRead prop were the duplicated instance (GAP P0#4).
   */
  onDictate?: () => void;
  dictating?: boolean;
  onAssist?: () => void;
  /**
   * M11: true while the shell is in Focus writing mode — comments hide unless
   * the "Show in focus" override is on (prototype commentsVisible 3600).
   */
  focusMode?: boolean;
  /**
   * M23: archive auto-[[link]]ing in the continuous manuscript (same entity
   * matching as the scene editor's AutoLinkerExtension). 'suggest' underlines
   * mentions — click to link; 'auto' additionally links on paragraph commit.
   */
  autoLinkEntities?: EntityEntry[];
  autoLinkMode?: AutoLinkerMode;
  /**
   * M13: TTS engine config (AppSettings.tts) for the reader — Piper/cloud
   * when configured, OS speechSynthesis otherwise (same stack as Beta 2).
   */
  ttsSettings?: TtsEngineSettings & { voiceId?: string };
  /** M13: stored voice prefs (AppSettings.voice) seed the reader's speed/voice. */
  voicePrefs?: TtsVoicePrefs;
}

const ZOOM_LEVELS: Array<[ZoomLevel, string]> = [
  ['book', 'Full Book'],
  ['part', 'Part'],
  ['chapter', 'Chapter'],
  ['scene', 'Scene'],
];

const STATUS_TIP: Record<SceneStatus, string> = {
  done: 'Complete',
  draft: 'In draft',
  todo: 'Not started',
};

// ── Toolbar v2 vocab (prototype 744–764, alignIc/listIcs 2967–2977) ──────────

const STYLE_OPTIONS = ['Body Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Quote'];
const FONT_OPTIONS = ['Lora', 'Georgia', 'Palatino Linotype', 'Inter'];
const FSIZE_MIN = 9;
const FSIZE_MAX = 18;

type FmtKey = 'b' | 'i' | 'u' | 's';
type AlignKey = 'left' | 'center' | 'right' | 'justify';

const FMT_KEYS: Array<{ k: FmtKey; label: string }> = [
  { k: 'b', label: 'Bold' },
  { k: 'i', label: 'Italic' },
  { k: 'u', label: 'Underline' },
  { k: 's', label: 'Strikethrough' },
];

const ALIGN_PATHS: Array<{ k: AlignKey; label: string; p: string }> = [
  { k: 'left', label: 'Align left', p: 'M4 7h16M4 12h10M4 17h13' },
  { k: 'center', label: 'Align center', p: 'M4 7h16M7 12h10M6 17h12' },
  { k: 'right', label: 'Align right', p: 'M4 7h16M10 12h10M7 17h13' },
  { k: 'justify', label: 'Justify', p: 'M4 7h16M4 12h16M4 17h16' },
];

const LIST_PATHS: Array<{ k: string; label: string; p: string }> = [
  { k: 'ul', label: 'Bulleted list', p: 'M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01' },
  { k: 'ol', label: 'Numbered list', p: 'M10 7h10M10 12h10M10 17h10M4 5.5h1.5v3M4 11h2l-2 2.6h2M4.2 16h1.6a.9.9 0 0 1 0 1.8H5a.9.9 0 0 0 0 1.8h1.8' },
  { k: 'indent', label: 'Indent', p: 'M13 7h7M13 12h7M13 17h7M4 9l3 3-3 3' },
  { k: 'outdent', label: 'Outdent', p: 'M13 7h7M13 12h7M13 17h7M7 9l-3 3 3 3' },
];

/** Prototype fam mapping (4117). */
function fontStack(font: string): string {
  if (font === 'Inter') return "'Inter',sans-serif";
  if (font === 'Lora') return "'Lora',Georgia,serif";
  return "'" + font + "',Georgia,serif";
}

// ── Lazy windowing (GH#843): render only ~WINDOW blocks around the viewport,
//    replacing everything outside with top/bottom spacers sized from an
//    average block-height estimate. Keeps a 1,000-scene story smooth.
const WINDOW = 120;
const EST_BLOCK_H = 96;
/** Re-window only after the start index moves this far (scroll hysteresis). */
const WINDOW_HYSTERESIS = 24;

// ── Page width (prototype state 3227 + startDrag 3392–3400) ──────────────────
const PAGE_W_MIN = 520;
const PAGE_W_MAX = 3000;
const clampPageW = (w: number) => Math.max(PAGE_W_MIN, Math.min(PAGE_W_MAX, w));

const CHEVRON_RIGHT = (size: number) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const CHEVRON_LEFT = (size: number) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

const PLUS_ICON = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const TB_ICON = (path: string) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={path} />
  </svg>
);

const NO_COMMENTS: readonly StoryComment[] = [];

export default function ManuscriptView({
  story,
  cursor,
  onCursorChange,
  onEditParagraph,
  onCycleStatus,
  pageWidth = 1000,
  onPageWidthChange,
  onMoveParagraph,
  liquidNeon,
  onDictate,
  dictating = false,
  onAssist,
  focusMode = false,
  autoLinkEntities,
  autoLinkMode = 'off',
  ttsSettings,
  voicePrefs,
}: ManuscriptViewProps) {
  // Per-heading fold state, keyed by chapter/scene id (prototype `collapsed`).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [pageW, setPageW] = useState(() => clampPageW(pageWidth));
  const [winStart, setWinStart] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Last text committed per paragraph block — prevents Enter+blur double-fires.
  const committedRef = useRef(new Map<string, string>());

  // M10 toolbar state (prototype 3251: styleSel/font/fsize/fmt/align).
  const [styleSel, setStyleSel] = useState('Body Text');
  const [font, setFont] = useState('Lora');
  const [fsize, setFsize] = useState(12);
  const [fmt, setFmt] = useState<Record<FmtKey, boolean>>({ b: false, i: false, u: false, s: false });
  const [align, setAlign] = useState<AlignKey>('left');

  // M10 page-edge drag + paragraph grip drag state.
  const [edgeDragging, setEdgeDragging] = useState(false);
  const [dragPara, setDragPara] = useState<ParagraphRef | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  // Mirror of dragPara so the row-facing drag handlers can stay
  // reference-stable — their identities feed ParagraphRow's memo gate.
  const dragParaRef = useRef<ParagraphRef | null>(null);
  const updateDragPara = useCallback((ref: ParagraphRef | null) => {
    dragParaRef.current = ref;
    setDragPara(ref);
  }, []);

  // ── M11 comments (store binding + selection/open UI state) ──
  const {
    ordered: comments,
    showComments,
    commentsInFocus,
    setShowComments,
    setCommentsInFocus,
    create: createStoryComment,
    resolve: resolveStoryComment,
  } = useStoryComments(story);
  /** Pending selection anchor (prototype cSel) — non-null shows the bar. */
  const [selAnchor, setSelAnchor] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState('');
  /** Expanded gutter card (prototype cOpen). */
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);

  // ── M13 TTS reader (existing Beta-2 stack via useTtsPlayer) ──
  const reader = useManuscriptReader(story, cursor, ttsSettings, voicePrefs);

  // Prototype commentsVisible (3600): hidden in Focus unless overridden.
  const commentsVisible = showComments && (!focusMode || commentsInFocus);

  // ── M23 auto-[[link]]ing (same terms as the scene editor's TipTap plugin) ──
  const autoLinkTerms = useMemo(
    () =>
      autoLinkMode !== 'off' && autoLinkEntities && autoLinkEntities.length > 0
        ? buildEntityTerms(autoLinkEntities)
        : [],
    [autoLinkEntities, autoLinkMode]
  );

  const commentsByScene = useMemo(() => {
    const map = new Map<string, StoryComment[]>();
    for (const c of comments) {
      const arr = map.get(c.sceneId);
      if (arr) arr.push(c);
      else map.set(c.sceneId, [c]);
    }
    return map;
  }, [comments]);

  const blocks = useMemo(() => buildBlocks(story, cursor, collapsed), [story, cursor, collapsed]);
  const crumbs = useMemo(() => breadcrumbs(story, cursor), [story, cursor]);

  // M10: page-mode sheet chrome from M4's persisted settings (pageCfg).
  const pageChrome = useMemo(() => pageModeChrome(liquidNeon), [liquidNeon]);

  // Follow persisted width when it changes elsewhere (settings load after mount).
  useEffect(() => {
    setPageW(clampPageW(pageWidth));
  }, [pageWidth]);

  const toggleFold = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => onCursorChange(zoomStep(story, cursor, dir)),
    [story, cursor, onCursorChange]
  );

  // Reset the window and scroll position whenever the scope changes.
  const scopeKey = `${cursor.zoom}:${cursor.part}:${cursor.chapter}:${cursor.scene}`;
  useEffect(() => {
    setWinStart(0);
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [scopeKey]);

  // ←/→ hop same-level siblings (prototype 3919–3922), except while typing.
  // W0.4: Ctrl/Cmd+Alt+↑/↓ steps the zoom level here too — the shell's
  // DepthSlider (which owned that shortcut) no longer mounts while the
  // manuscript's own doc header is the single zoom bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const depthMod = (e.ctrlKey || e.metaKey) && e.altKey;
      if (depthMod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const idx = ZOOM_LEVELS.findIndex(([level]) => level === cursor.zoom);
        const next = ZOOM_LEVELS[idx + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) {
          e.preventDefault();
          onCursorChange({ ...cursor, zoom: next[0] });
        }
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (cursor.zoom === 'book') return;
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // isContentEditable is unimplemented in jsdom — also check the attribute.
      if (target?.isContentEditable || target?.closest?.('[contenteditable="true"]')) return;
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, onCursorChange, step]);

  // Abandoned grip drags (mouseup outside any paragraph) clear the drag state.
  useEffect(() => {
    if (!dragPara) return;
    const clear = () => {
      updateDragPara(null);
      setDropKey(null);
    };
    window.addEventListener('mouseup', clear);
    return () => window.removeEventListener('mouseup', clear);
  }, [dragPara, updateDragPara]);

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const start = Math.max(0, Math.floor(e.currentTarget.scrollTop / EST_BLOCK_H) - WINDOW / 3);
      if (Math.abs(start - winStart) >= WINDOW_HYSTERESIS) setWinStart(start);
    },
    [winStart]
  );

  // M13: keep the paragraph being read in view (prototype "highlight follows").
  // If the block fell outside the lazy render window, jump the window first
  // and approximate the scroll offset from the block-height estimate.
  const readerKey = reader.curKey;
  useEffect(() => {
    if (!readerKey) return;
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-testid="msv-para-${readerKey}"]`);
    if (el) {
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }
    const bi = blocks.findIndex((blk) => blk.kind === 'para' && blk.blockId === readerKey);
    if (bi < 0) return;
    setWinStart(Math.max(0, bi - Math.floor(WINDOW / 3)));
    container.scrollTop = bi * EST_BLOCK_H;
  }, [readerKey, blocks]);

  // M13: selection-bar Read — speak just the highlighted passage.
  const handleReadSelection = useCallback(() => {
    if (!selAnchor) return;
    if (reader.readSelection(selAnchor)) {
      setSelAnchor(null);
      setCommentInput('');
      return;
    }
    showLnToast(
      reader.muted
        ? 'Voice is muted — unmute it to listen'
        : 'Voice unavailable — configure a TTS engine in Settings'
    );
  }, [selAnchor, reader]);

  const commitParagraph = useCallback(
    (sceneId: string, blockId: string, original: string, el: HTMLElement) => {
      let text = el.textContent ?? '';
      // M23 'auto' mode: link entity mentions on commit (the plain-text
      // analog of BlockEditor's auto-on-save apply path).
      if (autoLinkMode === 'auto' && autoLinkTerms.length > 0) {
        text = applyAllAutoLinkHints(text, autoLinkTerms);
      }
      const prev = committedRef.current.get(blockId) ?? original;
      if (text === prev) return;
      committedRef.current.set(blockId, text);
      onEditParagraph(sceneId, blockId, text);
    },
    [onEditParagraph, autoLinkMode, autoLinkTerms]
  );

  const commitPageWidth = useCallback(
    (w: number) => {
      const next = clampPageW(w);
      setPageW(next);
      onPageWidthChange?.(next);
    },
    [onPageWidthChange]
  );

  // Prototype startDrag (3392–3400): the page is centered, so each edge moves
  // the width by twice the pointer delta, signed per side.
  const startEdgeDrag = useCallback(
    (side: 1 | -1) => (e: ReactMouseEvent) => {
      e.preventDefault();
      const sx = e.clientX;
      const sw = pageW;
      const mv = (ev: MouseEvent) => {
        setPageW(clampPageW(sw + (ev.clientX - sx) * side * 2));
        setEdgeDragging(true);
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
        setEdgeDragging(false);
        commitPageWidth(sw + (ev.clientX - sx) * side * 2);
      };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    },
    [pageW, commitPageWidth]
  );

  const edgeKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        commitPageWidth(pageW + 20);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        commitPageWidth(pageW - 20);
      }
    },
    [pageW, commitPageWidth]
  );

  // Paragraph grip drag (prototype paraDown/paraOver/paraDrop 3705–3719).
  // Row-facing callbacks read the drag state through dragParaRef instead of
  // closing over it, so their identities survive drag-state renders and the
  // ParagraphRow memo keeps untouched rows from re-rendering.
  const handleGripDown = useCallback(
    (sceneId: string, blockId: string, e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      updateDragPara({ sceneId, blockId });
    },
    [updateDragPara]
  );

  const handleParaOver = useCallback((blockId: string) => {
    if (dragParaRef.current) setDropKey((prev) => (prev === blockId ? prev : blockId));
  }, []);

  const handleParaDrop = useCallback(
    (sceneId: string, blockId: string) => {
      const d = dragParaRef.current;
      updateDragPara(null);
      setDropKey(null);
      if (!d || (d.sceneId === sceneId && d.blockId === blockId)) return;
      onMoveParagraph?.(d, { sceneId, blockId });
    },
    [onMoveParagraph, updateDragPara]
  );

  // ── M11 comment handlers ──

  // Prototype pageMouseUp (3616–3620): capture 4–219-char selections.
  const handlePageMouseUp = useCallback(() => {
    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    const text = sel ? String(sel).trim() : '';
    if (isValidAnchor(text)) {
      setSelAnchor(text);
      setOpenCommentId(null);
    }
  }, []);

  const clearSelectionBar = useCallback(() => {
    setSelAnchor(null);
    setCommentInput('');
  }, []);

  // Prototype addCommentFromSel (3621–3629).
  const handleSaveComment = useCallback(() => {
    const body = commentInput.trim();
    if (!selAnchor || !body) return;
    const sceneId = findAnchorSceneId(story, selAnchor);
    if (!sceneId) {
      showLnToast('Select text inside a paragraph to comment on it');
      clearSelectionBar();
      return;
    }
    createStoryComment({ sceneId, anchor: selAnchor, text: body });
    setShowComments(true);
    clearSelectionBar();
    showLnToast('Comment added — visible in the editor');
  }, [commentInput, selAnchor, story, createStoryComment, setShowComments, clearSelectionBar]);

  const handleResolveComment = useCallback(
    (comment: StoryComment) => {
      resolveStoryComment(comment.id);
      setOpenCommentId((open) => (open === comment.id ? null : open));
      showLnToast('Comment resolved');
    },
    [resolveStoryComment]
  );

  const handleAgentAction = useCallback((comment: StoryComment, action: AgentAction) => {
    void runAgentAction(comment, action).then((result) => {
      if (!result.ok) {
        showLnToast(result.error ?? 'Archive action failed');
        return;
      }
      setOpenCommentId((open) => (open === comment.id ? null : open));
      const message = AGENT_ACTION_SUCCESS_TOAST[action];
      if (message) showLnToast(message);
    });
  }, []);

  const handleToggleOpenComment = useCallback((id: string) => {
    setOpenCommentId((open) => (open === id ? null : id));
  }, []);

  // Anchored underlines open (not toggle) their card — stable for ParagraphRow.
  const handleOpenComment = useCallback((id: string | null) => {
    setOpenCommentId(id);
  }, []);

  // M23: click an auto-link hint → replace the mention with its [[wiki link]].
  const handleApplyAutoLink = useCallback(
    (sceneId: string, blockId: string, content: string, hint: EntityMatch) => {
      const next = applyAutoLinkHint(content, hint);
      committedRef.current.set(blockId, next);
      onEditParagraph(sceneId, blockId, next);
      showLnToast(`Linked ${wikiLinkFor(hint)}`);
    },
    [onEditParagraph]
  );

  // Clamp the window so it always covers real blocks (folding shrinks the list).
  const start = Math.max(0, Math.min(winStart, Math.max(0, blocks.length - WINDOW)));
  const end = Math.min(blocks.length, start + WINDOW);
  const topPad = start * EST_BLOCK_H;
  const bottomPad = (blocks.length - end) * EST_BLOCK_H;
  const visible = blocks.slice(start, end);

  // Prototype sheetWrapSt (4118) + pSt (4119) — toolbar state applied to the sheet.
  const sheetWrapStyle: CSSProperties = {
    width: `${pageW}px`,
    fontFamily: fontStack(font),
    fontSize: `${(fsize * 1.42).toFixed(1)}px`,
  };
  // Memoized so its identity only changes with the toolbar state — it is
  // shallow-compared by every ParagraphRow's memo gate.
  const paraStyle = useMemo<CSSProperties>(
    () => ({
      textAlign: align,
      fontWeight: fmt.b ? 600 : 400,
      fontStyle: fmt.i ? 'italic' : 'normal',
      textDecoration:
        [fmt.u ? 'underline' : '', fmt.s ? 'line-through' : ''].join(' ').trim() || 'none',
    }),
    [align, fmt]
  );

  const renderFoldPill = (ownerId: string, text: string) => (
    <button
      key={`pill-${ownerId}`}
      type="button"
      className="msv-fold-pill"
      data-testid={`msv-pill-${ownerId}`}
      onClick={() => toggleFold(ownerId)}
    >
      {PLUS_ICON}
      {text}
    </button>
  );

  const renderBlock = (b: ManuscriptBlock) => {
    switch (b.kind) {
      case 'h2':
        return (
          <div key={b.id}>
            <div className="msv-h2" data-testid={`msv-h2-${b.chapterId}`}>
              <button
                type="button"
                className={`msv-fold${b.folded ? '' : ' msv-fold--open'}`}
                data-testid={`msv-fold-${b.chapterId}`}
                title={b.folded ? 'Expand chapter' : 'Collapse chapter'}
                aria-expanded={!b.folded}
                onClick={() => toggleFold(b.chapterId)}
              >
                {CHEVRON_RIGHT(13)}
              </button>
              <div className="msv-h2-label">{b.label}</div>
              <div className="msv-h2-title">{b.title}</div>
            </div>
            {b.folded &&
              renderFoldPill(
                b.chapterId,
                `${b.childCount} scene${b.childCount === 1 ? '' : 's'} hidden — click to expand`
              )}
          </div>
        );
      case 'h3':
        return (
          <div key={b.id}>
            <div className="msv-h3" data-testid={`msv-h3-${b.sceneId}`}>
              <button
                type="button"
                className={`msv-fold${b.folded ? '' : ' msv-fold--open'}`}
                data-testid={`msv-fold-${b.sceneId}`}
                title={b.folded ? 'Expand scene' : 'Collapse scene'}
                aria-expanded={!b.folded}
                onClick={() => toggleFold(b.sceneId)}
              >
                {CHEVRON_RIGHT(13)}
              </button>
              <span className="msv-h3-title">{b.title}</span>
              <button
                type="button"
                className={`msv-dot msv-dot--${b.status}`}
                data-testid={`msv-dot-${b.sceneId}`}
                title={STATUS_TIP[b.status]}
                aria-label={`Scene status: ${STATUS_TIP[b.status]} — click to cycle`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCycleStatus(b.sceneId);
                }}
              />
            </div>
            {b.folded && renderFoldPill(b.sceneId, 'Scene collapsed — click to expand')}
          </div>
        );
      case 'para':
        // Perf audit P3: paragraphs render through a memoized row so that
        // view-level re-renders (comments arriving, reader ticks, width
        // drags) leave untouched rows — and their contentEditables — alone.
        // Everything passed here is reference-stable while unchanged; see
        // ParagraphRow.tsx for the memo gate and the mid-edit caret guard.
        return (
          <ParagraphRow
            key={b.id}
            sceneId={b.sceneId}
            blockId={b.blockId}
            content={b.content}
            comments={
              commentsVisible ? commentsByScene.get(b.sceneId) ?? NO_COMMENTS : NO_COMMENTS
            }
            autoLinkTerms={autoLinkTerms}
            reading={readerKey === b.blockId}
            showDropLine={!!dragPara && dropKey === b.blockId}
            paraStyle={paraStyle}
            onCommit={commitParagraph}
            onGripDown={handleGripDown}
            onParaOver={handleParaOver}
            onParaDrop={handleParaDrop}
            onOpenComment={handleOpenComment}
            onApplyAutoLink={handleApplyAutoLink}
          />
        );
    }
  };

  return (
    <div className={`msv-root${dragPara ? ' msv-root--dragging-para' : ''}`} data-testid="msv-root">
      {/* zoom bar (prototype 717–741) */}
      <div className="msv-zoombar">
        <div className="msv-zoom-seg" role="group" aria-label="Zoom level">
          {ZOOM_LEVELS.map(([level, label]) => (
            <button
              key={level}
              type="button"
              className={`msv-zoom-opt${cursor.zoom === level ? ' msv-zoom-opt--active' : ''}`}
              data-testid={`msv-zoom-${level}`}
              aria-pressed={cursor.zoom === level}
              onClick={() => onCursorChange({ ...cursor, zoom: level })}
            >
              {label}
            </button>
          ))}
        </div>
        {cursor.zoom !== 'book' && (
          <div className="msv-zoom-nav">
            <button
              type="button"
              className="msv-zoom-arrow"
              data-testid="msv-zoom-prev"
              title="Previous (←)"
              onClick={() => step(-1)}
            >
              {CHEVRON_LEFT(11)}
            </button>
            <button
              type="button"
              className="msv-zoom-arrow"
              data-testid="msv-zoom-next"
              title="Next (→)"
              onClick={() => step(1)}
            >
              {CHEVRON_RIGHT(11)}
            </button>
          </div>
        )}
        <nav className="msv-crumbs" aria-label="Breadcrumbs" data-testid="msv-crumbs">
          {crumbs.map((c, i) => (
            <span key={`${c.cursor.zoom}-${c.label}`} className="msv-crumb-item">
              <button
                type="button"
                className={`msv-crumb${i === crumbs.length - 1 ? ' msv-crumb--current' : ''}`}
                data-testid={`msv-crumb-${i}`}
                onClick={() => onCursorChange(c.cursor)}
              >
                {c.label}
              </button>
              {i < crumbs.length - 1 && (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#586a88"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="msv-crumb-sep"
                  aria-hidden="true"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              )}
            </span>
          ))}
        </nav>
        <div className="msv-flex-spacer" />
        {/* W0.4 (GAP P0#4): the zoombar's duplicate Read chip is gone — the
            single Read button lives right-aligned on the format toolbar below
            (prototype 748) and toggles the same M13 reader dock. */}
        {/* M11: comments chip (prototype 697–699 / commentsChipSt 4842) */}
        <button
          type="button"
          className={`msv-comments-chip${showComments ? ' msv-comments-chip--on' : ''}`}
          data-testid="msv-comments-chip"
          title="Show / hide comments"
          aria-pressed={showComments}
          onClick={() => setShowComments(!showComments)}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M21 12c0 4-4 7-9 7s-9-3-9-7 4-7 9-7 9 3 9 7z" />
          </svg>
          {comments.length}
        </button>
        <div className="msv-width-ctl" title="Page width — also drag the page edges">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#8e9db8"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 12h18M6 8l-3 4 3 4M18 8l3 4-3 4" />
          </svg>
          <input
            type="range"
            min={PAGE_W_MIN}
            max={PAGE_W_MAX}
            value={pageW}
            data-testid="msv-width-slider"
            aria-label="Page width"
            onChange={(e) => commitPageWidth(Number(e.target.value))}
          />
          <span className="msv-width-readout">{pageW}px</span>
        </div>
      </div>

      {/* toolbar v2 (prototype 742–777) */}
      <div className="msv-toolbar" role="toolbar" aria-label="Manuscript formatting" data-testid="msv-toolbar">
        <select
          className="msv-tb-select"
          data-testid="msv-style-select"
          aria-label="Paragraph style"
          value={styleSel}
          onChange={(e) => setStyleSel(e.target.value)}
        >
          {STYLE_OPTIONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          className="msv-tb-select msv-tb-font"
          data-testid="msv-font-select"
          aria-label="Font"
          value={font}
          onChange={(e) => setFont(e.target.value)}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <div className="msv-tb-size">
          <button
            type="button"
            className="msv-tb-size-btn"
            data-testid="msv-size-down"
            aria-label="Decrease font size"
            onClick={() => setFsize((s) => Math.max(FSIZE_MIN, s - 1))}
          >
            −
          </button>
          <span className="msv-tb-size-val" data-testid="msv-size-val">
            {fsize}
          </span>
          <button
            type="button"
            className="msv-tb-size-btn"
            data-testid="msv-size-up"
            aria-label="Increase font size"
            onClick={() => setFsize((s) => Math.min(FSIZE_MAX, s + 1))}
          >
            +
          </button>
        </div>
        <div className="msv-tb-sep" role="separator" aria-orientation="vertical" />
        {FMT_KEYS.map(({ k, label }) => (
          <button
            key={k}
            type="button"
            className={`msv-tb-btn msv-tb-fmt-${k}${fmt[k] ? ' msv-tb-btn--active' : ''}`}
            data-testid={`msv-fmt-${k}`}
            aria-label={label}
            aria-pressed={fmt[k]}
            onClick={() => setFmt((prev) => ({ ...prev, [k]: !prev[k] }))}
          >
            <span className={`msv-tb-glyph msv-tb-glyph--${k}`}>{k.toUpperCase()}</span>
          </button>
        ))}
        <div className="msv-tb-sep" role="separator" aria-orientation="vertical" />
        {ALIGN_PATHS.map(({ k, label, p }) => (
          <button
            key={k}
            type="button"
            className={`msv-tb-btn${align === k ? ' msv-tb-btn--active' : ''}`}
            data-testid={`msv-align-${k}`}
            aria-label={label}
            aria-pressed={align === k}
            onClick={() => setAlign(k)}
          >
            {TB_ICON(p)}
          </button>
        ))}
        <div className="msv-tb-sep" role="separator" aria-orientation="vertical" />
        {LIST_PATHS.map(({ k, label, p }) => (
          <button key={k} type="button" className="msv-tb-btn" aria-label={label} title={label}>
            {TB_ICON(p)}
          </button>
        ))}
        <div className="msv-flex-spacer" />
        {/* W0.4 (GAP P0#4): the ONE Read button — right-aligned on the format
            toolbar per the prototype (748), wired to the M13 reader dock the
            deleted zoombar chip used to open. */}
        <button
          type="button"
          className={`msv-tb-action msv-tb-read${reader.open ? ' msv-tb-read--on' : ''}`}
          data-testid="msv-tb-read"
          title={reader.open ? 'Close the reader' : 'Read aloud — open the reader'}
          aria-pressed={reader.open}
          onClick={() => (reader.open ? reader.close() : reader.openReader())}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 10v4h4l5 4V6l-5 4z" />
            <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" />
          </svg>
          Read
        </button>
        {onDictate && (
          <button
            type="button"
            className={`msv-tb-action msv-tb-dictate${dictating ? ' msv-tb-dictate--on' : ''}`}
            data-testid="msv-tb-dictate"
            title="Dictate"
            aria-pressed={dictating}
            onClick={onDictate}
          >
            <span className="msv-dict-dot" aria-hidden="true" />
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="9.5" y="3.5" width="5" height="10" rx="2.5" />
              <path d="M6 11a6 6 0 0 0 12 0M12 17v3.5" />
            </svg>
            Dictate
          </button>
        )}
        {onAssist && (
          <button
            type="button"
            className="msv-tb-action msv-tb-assist"
            data-testid="msv-tb-assist"
            title="Open the Writing Coach"
            onClick={onAssist}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
              <circle cx="12" cy="12" r="3.4" />
            </svg>
            Assist
          </button>
        )}
      </div>

      {/* M11: page + comments gutter share a row (prototype 806 / 911) */}
      <div className="msv-body">
        {/* page scroll area with floating arrows (prototype 808–810) */}
        <div
          className="msv-page"
          ref={scrollRef}
          onScroll={handleScroll}
          onMouseUp={handlePageMouseUp}
          data-testid="msv-page"
        >
          {cursor.zoom !== 'book' && (
            <>
              <button
                type="button"
                className="msv-page-arrow msv-page-arrow--prev"
                data-testid="msv-page-prev"
                title="Previous (←)"
                onClick={() => step(-1)}
              >
                {CHEVRON_LEFT(14)}
              </button>
              <button
                type="button"
                className="msv-page-arrow msv-page-arrow--next"
                data-testid="msv-page-next"
                title="Next (→)"
                onClick={() => step(1)}
              >
                {CHEVRON_RIGHT(14)}
              </button>
            </>
          )}
          {/* M11: selection comment bar (prototype 811–824) */}
          {selAnchor !== null && (
            <CommentSelectionBar
              selectionText={selAnchor}
              value={commentInput}
              onChange={setCommentInput}
              onSave={handleSaveComment}
              onCancel={clearSelectionBar}
              onRead={handleReadSelection}
            />
          )}
          <div className="msv-sheet-wrap" style={sheetWrapStyle}>
            <div
              className="msv-sheet"
              style={pageChrome.sheetStyle}
              data-testid="msv-sheet"
              data-page-mode={pageChrome.mode}
            >
              {pageChrome.mode === 'scroll' && <PageModeRunes sym={pageChrome.sym} />}
              {/* page-edge drag handles (prototype 861–865, startDrag 3392–3400) */}
              <div
                className="msv-edge msv-edge--l"
                data-testid="msv-edge-l"
                title="Drag to resize page"
                role="separator"
                aria-orientation="vertical"
                aria-label="Drag to resize page width"
                tabIndex={0}
                onMouseDown={startEdgeDrag(-1)}
                onKeyDown={edgeKeyDown}
              >
                <div className="msv-edge-bar" />
              </div>
              <div
                className="msv-edge msv-edge--r"
                data-testid="msv-edge-r"
                title="Drag to resize page"
                role="separator"
                aria-orientation="vertical"
                aria-label="Drag to resize page width"
                tabIndex={0}
                onMouseDown={startEdgeDrag(1)}
                onKeyDown={edgeKeyDown}
              >
                <div className="msv-edge-bar" />
              </div>
              {edgeDragging && (
                <div className="msv-width-badge" data-testid="msv-width-badge">
                  {pageW} px
                </div>
              )}
              <div style={{ height: topPad }} data-testid="msv-spacer-top" aria-hidden="true" />
              {visible.map(renderBlock)}
              <div
                style={{ height: bottomPad }}
                data-testid="msv-spacer-bottom"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
        {/* M11: margin gutter dock (prototype 911–963) */}
        {commentsVisible && (
          <CommentsGutter
            comments={comments}
            openId={openCommentId}
            onToggleOpen={handleToggleOpenComment}
            onResolve={handleResolveComment}
            onAgentAction={handleAgentAction}
            commentsInFocus={commentsInFocus}
            onToggleCommentsInFocus={() => setCommentsInFocus(!commentsInFocus)}
          />
        )}
      </div>
      {/* M13: audiobook bar (prototype Book-preview bar 641–658) */}
      {reader.open && <ReaderBar reader={reader} ttsSettings={ttsSettings} />}
    </div>
  );
}
