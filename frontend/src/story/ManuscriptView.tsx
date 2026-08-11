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
// onMoveParagraph / onPagePrefsChange, plus the M8 editing-model callbacks
// (onSplitParagraph / onMergeParagraph / onRemoveParagraph / onRenameScene /
// onRenameChapter — prototype paraKey/editPara/editTitle 5095–5146).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type UIEvent,
} from 'react';
import {
  breadcrumbs,
  buildBlocks,
  cursorScene,
  normalizeInlineTitle,
  scopeScenes,
  splitParagraphText,
  zoomStep,
  type ManuscriptBlock,
  type ManuscriptCursor,
  type ParagraphRef,
  type SceneStatus,
  type ZoomLevel,
} from './manuscriptModel';
import TitleRow from './TitleRow';
import DraftsCompareSplit from '../drafts/DraftsCompareSplit';
import DraftDiffView from '../drafts/DraftDiffView';
import type { SceneDraftEntry } from '../drafts/useSceneDrafts';
import SceneHistory from '../SceneHistory';
import { countWords } from '../wordStats';
import { pageModeChrome, PageModeRunes } from './pageMode';
import type { LiquidNeonPageCfg, LiquidNeonV2Settings } from '../theme/liquidNeonEngine';
import MarginRuler, { type RulerDrag } from './MarginRuler';
import PageSetupPopover from '../PageSetupPopover';
import DepthEdgeArrows from '../DepthEdgeArrows';
import {
  FONT_STEP_MAX,
  FONT_STEP_MIN,
  PAGE_WIDTH_MIN,
  PAGE_WIDTH_MAX,
  STORY_FONT_NAMES,
  STORY_PAGE_DEFAULTS,
  clampPageMargin,
  clampPageWidth,
  manuscriptFontStack,
  resolveFontName,
  resolveFontStep,
  resolveLineHeight,
  resolvePageMargin,
  resolvePageWidth,
  type StoryFontName,
  type StoryPagePrefs,
} from '../theme';
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
import CommentOpenCard from './CommentOpenCard';
import ParagraphRow from './ParagraphRow';
import { buildEntityTerms, type AutoLinkerMode } from '../AutoLinkerExtension';
import {
  applyAllAutoLinkHints,
  applyAutoLinkHint,
  wikiLinkFor,
  type EntityMatch,
} from './autoLinkText';
import { ReaderCard } from './ReaderBar';
import { useManuscriptReader } from './useManuscriptReader';
import {
  clearReadingSentenceHighlight,
  setReadingSentenceHighlight,
} from './readerHighlight';
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
  /**
   * M1-S3: the canonical page prefs (width/margin/font/size/line-height) —
   * ONE pref set shared by the toolbar, the ruler diamond pairs, and
   * PageSetupPopover. Absent → prototype defaults, local-only.
   */
  pagePrefs?: Partial<StoryPagePrefs>;
  /** M1-S3: fired when any page-pref control commits a change. */
  onPagePrefsChange?: (p: StoryPagePrefs) => void;
  /** M10: grip drag dropped one paragraph onto another (lands before target). */
  onMoveParagraph?: (from: ParagraphRef, to: ParagraphRef) => void;
  /**
   * M8: Enter splits the focused paragraph at the caret. The handler applies
   * the split to the story and returns the id of the block created for the
   * text after the caret (null = not applied). The caret then lands at the
   * start of that new paragraph. Absent → Enter commits-and-blurs (legacy).
   */
  onSplitParagraph?: (
    sceneId: string,
    blockId: string,
    before: string,
    after: string
  ) => string | null;
  /**
   * M8: Backspace at paragraph start merges into the previous paragraph.
   * Returns the surviving block + merged text (null = first block of the
   * scene / not applied). The caret lands at the end of the merged block.
   */
  onMergeParagraph?: (
    sceneId: string,
    blockId: string,
    currentText: string
  ) => { mergedBlockId: string; mergedText: string } | null;
  /**
   * M8: a paragraph emptied on blur is removed. Returns false when the
   * paragraph was kept (min 1 per scene) — it then commits as ' '.
   */
  onRemoveParagraph?: (sceneId: string, blockId: string) => boolean;
  /** M8: inline scene-heading rename (renaming a provisional scene persists it). */
  onRenameScene?: (sceneId: string, title: string) => void;
  /** M8: inline chapter-heading rename. */
  onRenameChapter?: (chapterId: string, title: string) => void;
  /** M10: Liquid Neon v2 settings driving the page-mode sheet chrome (M4's pageCfg). */
  liquidNeon?: Partial<LiquidNeonV2Settings> | null;
  /**
   * M7 (§5.1): page-style quick-switch inside the Page setup popover. Omit to
   * hide the switch entirely (style stays Settings-only, as it is today).
   */
  onPageStyleChange?: (mode: LiquidNeonPageCfg['mode']) => void;
  /** M7: "Choose image…" trigger for the Custom texture page style. */
  onPickPageTexture?: () => void;
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
  /** M1 row 3 (SKY-9013): Focus toggle on the title row (shell writingMode). */
  onToggleFocus?: () => void;
  /** M1 row 5 (SKY-9013): "+ Chapter" — appends a chapter to the story. */
  onAddChapter?: () => void;
  /** M1 row 5 (SKY-9013): "+ Scene" — adds a scene to the cursor's chapter. */
  onAddScene?: () => void;
  /** M2 (SKY-9017): creates a new Part (titles the first if untitled, else appends). */
  onAddPart?: () => void;
  /** M2: edit/create the part note (partId, existing text or '' for new). */
  onEditPartNote?: (partId: string, text: string) => void;
  /** M2: edit/create the chapter note (chapterId, existing text or '' for new). */
  onEditChapterNote?: (chapterId: string, text: string) => void;
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
  /**
   * SKY-9404 (M1-S4): Drafts v2 (title-row pill + popover, compare split,
   * full diff) — relocated from the deleted legacy scene branch. Present
   * only once a target scene resolves (the host gates this on its own scene
   * selection, same as before the move).
   */
  drafts?: ManuscriptDraftsControls;
  /** SKY-9404: the ⋯ menu's "Save snapshot now" action + its saved-at note. */
  onManualSnapshot?: () => void;
  snapshotSavedAt?: string | null;
  /** SKY-9404: the ⋯ menu's "History" action + the SceneHistory modal data. */
  sceneHistory?: ManuscriptHistoryControls;
  /** SKY-9404 (M1-S4): When cursor.zoom === 'scene', render this slot instead of
   *  the inline heading-zone block list — keeps TipTap/BlockEditor at scene depth
   *  while ManuscriptView provides the chrome (title row, ruler, page prefs). */
  sceneEditorSlot?: React.ReactNode;
  /**
   * SKY-9404 (M1-S4) / SKY-5904: on-canvas prev/next depth-step arrows, now
   * anchored to `.msv-sheet` (the depth-invariant page box, present at every
   * depth) instead of a scene-only wrapper — so they hug the page column at
   * book/part/chapter/scene alike, not the full-width canvas behind it.
   */
  edgeNav?: {
    canPrev: boolean;
    canNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  };
}

/** SKY-9404: Drafts v2 data + handlers, moved from the deleted scene branch. */
export interface ManuscriptDraftsControls {
  drafts: SceneDraftEntry[];
  currentLabel: string;
  currentContent: string;
  documentLabel: string;
  error: string | null;
  popoverOpen: boolean;
  onTogglePopover: () => void;
  onClosePopover: () => void;
  onCompare: (draft: SceneDraftEntry) => void;
  onRestore: (draft: SceneDraftEntry) => void;
  splitOpen: boolean;
  onToggleSplit: () => void;
  onCloseSplit: () => void;
  diffOpen: boolean;
  onOpenDiff: () => void;
  onCloseDiff: () => void;
  selectedTs: string | null;
  onSelectTs: (ts: string) => void;
  onLoadDraft: (draft: SceneDraftEntry) => void;
  undoLabel: string | null;
  onUndo: () => void;
}

/** SKY-9404: SceneHistory modal data + handlers, moved from the scene branch. */
export interface ManuscriptHistoryControls {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  sceneId: string;
  scenePath: string;
  currentContent: string;
  onRestore: (content: string) => void;
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

// ── Toolbar v2 vocab (prototype 744–764, alignIc 2967–2977). SKY-7930: the
//    prototype's list/indent buttons had no data model to act on (manuscript
//    paragraphs are plain text — no list/indent markup) and were removed.

const STYLE_OPTIONS = ['Body Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Quote'];
// Spec order (§5.1): 1.85 is the toolbar default (LINE_HEIGHT_DEFAULT, theme.ts).
const LINE_SPACING_OPTIONS = ['1.15', '1.3', '1.5', '1.85', '2', '2.5', '3', '3.5', '4', '5', '6'];

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

// ── Lazy windowing (GH#843): render only ~WINDOW blocks around the viewport,
//    replacing everything outside with top/bottom spacers sized from an
//    average block-height estimate. Keeps a 1,000-scene story smooth.
const WINDOW = 120;
const EST_BLOCK_H = 96;
/** Re-window only after the start index moves this far (scroll hysteresis). */
const WINDOW_HYSTERESIS = 24;

// ── Page geometry (prototype state 3227 + startDrag 3392–3400): the canonical
//    clamps live in theme.ts beside StoryPagePrefs (M1-S3).
const clampPageW = clampPageWidth;

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
  pagePrefs,
  onPagePrefsChange,
  onMoveParagraph,
  onSplitParagraph,
  onMergeParagraph,
  onRemoveParagraph,
  onRenameScene,
  onRenameChapter,
  liquidNeon,
  onPageStyleChange,
  onPickPageTexture,
  onDictate,
  dictating = false,
  onAssist,
  focusMode = false,
  onToggleFocus,
  onAddChapter,
  onAddScene,
  onAddPart,
  onEditPartNote,
  onEditChapterNote,
  autoLinkEntities,
  autoLinkMode = 'off',
  ttsSettings,
  voicePrefs,
  drafts,
  onManualSnapshot,
  snapshotSavedAt,
  sceneHistory,
  sceneEditorSlot,
  edgeNav,
}: ManuscriptViewProps) {
  // Per-heading fold state, keyed by chapter/scene id (prototype `collapsed`).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // M1-S3: page geometry + type mirror the canonical prefs; local state gives
  // live drag feedback, the sync effects below follow external pref changes
  // (popover, another control, settings load after mount).
  const [pageW, setPageW] = useState(() => resolvePageWidth(pagePrefs));
  const [marginPx, setMarginPx] = useState(() => resolvePageMargin(pagePrefs));
  const [winStart, setWinStart] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Last text committed per paragraph block — prevents Enter+blur double-fires.
  const committedRef = useRef(new Map<string, string>());

  // M10 toolbar state (prototype 3251: styleSel/font/fsize/fmt/align).
  const [styleSel, setStyleSel] = useState('Body Text');
  const [font, setFont] = useState<StoryFontName>(() => resolveFontName(pagePrefs));
  const [fsize, setFsize] = useState(() => resolveFontStep(pagePrefs));
  const [lineSpacing, setLineSpacing] = useState(() => String(resolveLineHeight(pagePrefs)));
  const [fmt, setFmt] = useState<Record<FmtKey, boolean>>({ b: false, i: false, u: false, s: false });
  const [align, setAlign] = useState<AlignKey>('left');

  // M1-S3: one commit path for every page-pref control — toolbar selects,
  // ruler diamonds, edge drags, and the popover all end here.
  const commitPrefs = useCallback(
    (patch: Partial<StoryPagePrefs>) => {
      onPagePrefsChange?.({ ...STORY_PAGE_DEFAULTS, ...pagePrefs, ...patch });
    },
    [onPagePrefsChange, pagePrefs]
  );

  // Mirror a full prefs object into the local live state — used by the popover
  // (which edits whole prefs) so the sheet follows instantly even when the
  // view is uncontrolled, and by the sync effect below for external changes.
  const applyPrefsLocal = useCallback((p: Partial<StoryPagePrefs> | undefined) => {
    setPageW(resolvePageWidth(p));
    setMarginPx(resolvePageMargin(p));
    setFont(resolveFontName(p));
    setFsize(resolveFontStep(p));
    setLineSpacing(String(resolveLineHeight(p)));
  }, []);

  // M7: "Page setup" popover (width + page style) — replaces the always-open
  // width strip so the control surface matches §5.1's "compact popover, not
  // a strip".
  const [pageSetupOpen, setPageSetupOpen] = useState(false);

  // M10 page-edge drag + paragraph grip drag state.
  const [edgeDragging, setEdgeDragging] = useState(false);
  // M1-S3: live ruler-diamond drag — feeds the page-corner value badge.
  const [rulerDrag, setRulerDrag] = useState<RulerDrag | null>(null);
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

  // M1 row 3 (SKY-9013): scope stats + the status chip's target scene.
  const scene = useMemo(() => cursorScene(story, cursor), [story, cursor]);
  const scopeWords = useMemo(
    () =>
      scopeScenes(story, cursor).reduce(
        (sum, sc) => sum + countWords(sc.blocks.map((b) => b.content).join('\n\n')),
        0
      ),
    [story, cursor]
  );

  // M10: page-mode sheet chrome from M4's persisted settings (pageCfg).
  const pageChrome = useMemo(() => pageModeChrome(liquidNeon), [liquidNeon]);
  // M7: display name for the Page setup popover's custom-texture row.
  const textureFileName = liquidNeon?.pageCfg?.textureUrl?.split(/[\\/]/).pop();

  // Follow persisted prefs when they change elsewhere (popover edits, settings
  // load after mount) — every control mirrors the one canonical pref set.
  useEffect(() => {
    applyPrefsLocal(pagePrefs);
  }, [pagePrefs, applyPrefsLocal]);

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
  // M8 (§1 keyboard map): Alt+←/→ hops scenes (chapters at chapter zoom) even
  // FROM inside a paragraph — plain arrows stay in the text. Any in-flight
  // contentEditable edit is blur-committed before the scope swaps it out.
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
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.closest?.('[contenteditable="true"]')) {
          active.blur();
        }
        step(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
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

  // M8 §14.2 "drag state can't get stuck": abandoned grip drags (mouseup
  // outside any paragraph), Escape, and losing window focus all clear it.
  useEffect(() => {
    if (!dragPara) return;
    const clear = () => {
      updateDragPara(null);
      setDropKey(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    window.addEventListener('mouseup', clear);
    window.addEventListener('blur', clear);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mouseup', clear);
      window.removeEventListener('blur', clear);
      window.removeEventListener('keydown', onKeyDown);
    };
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

  // M11: paint the sentence being read inside the block wash (§5.1). Uses the
  // CSS Custom Highlight API so the contentEditable DOM is never touched;
  // degrades to the block-level wash where the API is unavailable (jsdom).
  const readerRange = reader.curRange;
  useEffect(() => {
    if (!readerKey || !readerRange) {
      clearReadingSentenceHighlight();
      return;
    }
    const el = scrollRef.current?.querySelector(`[data-testid="msv-para-${readerKey}"]`);
    setReadingSentenceHighlight(el, readerRange.start, readerRange.end);
    return () => clearReadingSentenceHighlight();
  }, [readerKey, readerRange, blocks]);

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
      // M8 (prototype editPara): a paragraph emptied on blur is removed;
      // the model keeps a minimum of one per scene — a kept survivor
      // commits as the prototype's single-space placeholder instead.
      if (onRemoveParagraph && text.trim() === '') {
        if (onRemoveParagraph(sceneId, blockId)) {
          committedRef.current.delete(blockId);
          return;
        }
        text = ' ';
      }
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
    [onEditParagraph, onRemoveParagraph, autoLinkMode, autoLinkTerms]
  );

  // ── M8: Enter split / Backspace merge + caret hand-off ──
  // The follow-up caret target renders on the NEXT story pass (the split /
  // merge lands in the caller's state first), so it is parked in a ref and
  // claimed by the effect below once its paragraph exists in the DOM.
  const pendingCaretRef = useRef<{ blockId: string; place: 'start' | 'end' } | null>(null);

  useEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-testid="msv-para-${pending.blockId}"]`
    );
    if (!el) return;
    pendingCaretRef.current = null;
    el.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(pending.place === 'start');
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {
      // jsdom's Selection API is partial — focus alone is enough there.
    }
  }, [blocks]);

  const handleRowSplit = useCallback(
    (sceneId: string, blockId: string, text: string, offset: number, el: HTMLElement) => {
      if (!onSplitParagraph) return;
      const { before, after } = splitParagraphText(text, offset);
      // Blur first, with the commit suppressed (the split itself persists
      // both halves): once unfocused, the row's memo gate lets the content
      // change re-render through React — never mutate its DOM by hand, the
      // children may be React-managed comment/hint spans.
      committedRef.current.set(blockId, text);
      el.blur();
      const newBlockId = onSplitParagraph(sceneId, blockId, before, after);
      if (!newBlockId) {
        committedRef.current.delete(blockId); // split refused — restore the baseline
        return;
      }
      committedRef.current.set(blockId, before);
      committedRef.current.set(newBlockId, after);
      pendingCaretRef.current = { blockId: newBlockId, place: 'start' };
    },
    [onSplitParagraph]
  );

  const handleRowMergeUp = useCallback(
    (sceneId: string, blockId: string, currentText: string): boolean => {
      if (!onMergeParagraph) return false;
      const res = onMergeParagraph(sceneId, blockId, currentText);
      if (!res) return false;
      committedRef.current.set(res.mergedBlockId, res.mergedText);
      // The merged-away row unmounts — a stray blur must not re-commit it.
      committedRef.current.set(blockId, currentText);
      pendingCaretRef.current = { blockId: res.mergedBlockId, place: 'end' };
      return true;
    },
    [onMergeParagraph]
  );

  // ── M8: inline heading renames (prototype editTitle) ──
  // Empty renames revert; normalization differences are written back so the
  // heading never displays text the story does not hold. Renaming a
  // provisional scene persists it (§1.5) — the shell's handler owns that.
  const commitHeadingRename = useCallback(
    (kind: 'chapter' | 'scene', id: string, originalTitle: string, el: HTMLElement) => {
      const raw = el.textContent ?? '';
      const title = normalizeInlineTitle(raw);
      if (!title) {
        el.textContent = originalTitle;
        return;
      }
      if (title !== raw) el.textContent = title;
      if (title === originalTitle) return;
      if (kind === 'chapter') onRenameChapter?.(id, title);
      else onRenameScene?.(id, title);
    },
    [onRenameChapter, onRenameScene]
  );

  // §1: Enter commits inline renames (blur runs the commit handler).
  const headingKeyDown = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }, []);

  const commitPageWidth = useCallback(
    (w: number) => {
      const next = clampPageW(w);
      // Locked pairs (plan §M1 row 6): margins are absolute px carried across
      // page resizes — clamped down only when the new width no longer fits.
      const nextMargin = clampPageMargin(marginPx, next);
      setPageW(next);
      setMarginPx(nextMargin);
      commitPrefs({ pageWidthPx: next, pageMarginPx: nextMargin });
    },
    [commitPrefs, marginPx]
  );

  const commitPageMargin = useCallback(
    (m: number) => {
      const next = clampPageMargin(m, pageW);
      setMarginPx(next);
      commitPrefs({ pageMarginPx: next });
    },
    [commitPrefs, pageW]
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
      // Prototype paraDown: drop any live text selection so the drag never
      // extends it (user-select is suppressed for the drag's duration too).
      if (typeof window.getSelection === 'function') {
        window.getSelection()?.removeAllRanges();
      }
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

  // SKY-9480: a plain click that lands inside an already-selected range
  // doesn't reliably collapse the selection on mouseup (browser-dependent —
  // see the analogous Control+End/ProseMirror resync race SKY-7550 already
  // guards against for Enter). At scene depth, applying a heading level (or
  // any block command that leaves its target selected) followed by a click
  // to resume typing can therefore leave a stale, non-empty
  // window.getSelection() at mouseup — nothing to do with a real drag
  // selection. Track the mousedown point and only treat the mouseup as a
  // comment-selection intent when the pointer actually moved (a drag) or
  // this was a double/triple click (word/paragraph select), matching how
  // real text selections are made; a bare click never qualifies.
  const pageMouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const handlePageMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    pageMouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Prototype pageMouseUp (3616–3620): capture 4–219-char selections.
  const handlePageMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const down = pageMouseDownPos.current;
    pageMouseDownPos.current = null;
    const dragged = !!down && (Math.abs(e.clientX - down.x) > 2 || Math.abs(e.clientY - down.y) > 2);
    if (!dragged && e.detail < 2) return;
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
  // M9 (v2 prototype seg pick 4664): opening a comment dismisses a pending
  // selection composer ({ cOpen: sg.cid, cSel: null }).
  const handleOpenComment = useCallback(
    (id: string | null) => {
      setOpenCommentId(id);
      clearSelectionBar();
    },
    [clearSelectionBar]
  );

  // M9: the open comment card (v2 prototype cOpenData 6502) — the open id
  // resolved against the live list, so resolving/removing closes the card.
  const openComment = useMemo(
    () => (openCommentId ? comments.find((c) => c.id === openCommentId) ?? null : null),
    [openCommentId, comments]
  );

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
    fontFamily: manuscriptFontStack(font),
    fontSize: `${(fsize * 1.42).toFixed(1)}px`,
    lineHeight: lineSpacing,
  };
  // M1-S3: margins are absolute px on the page surface (plan §M1 row 6) —
  // horizontal padding tracks the margin diamonds; vertical stays the sheet's.
  const sheetStyle: CSSProperties = {
    ...pageChrome.sheetStyle,
    paddingLeft: marginPx,
    paddingRight: marginPx,
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
      case 'h1':
        // M2 (SKY-9017): Part heading — emitted only for multi-part stories.
        return (
          <div key={b.id} className="msv-part-heading" role="heading" aria-level={1} data-testid={`msv-h1-${b.partId}`}>
            <div className="msv-part-heading-label">{b.label}</div>
            {b.title && <div className="msv-part-heading-title">{b.title}</div>}
          </div>
        );
      case 'note-slot': {
        // M2 (SKY-9017): chapter/part note — epigraph when filled, affordance when empty.
        const hasNote = b.note.length > 0;
        if (hasNote) {
          return (
            <div key={b.id} className="msv-epigraph" data-testid={`msv-note-${b.slotKind}-${b.partId ?? b.chapterId}`}>
              {b.note[0].content}
            </div>
          );
        }
        // Empty affordance: only show when the edit handler is wired.
        const canEdit =
          b.slotKind === 'part' ? !!onEditPartNote : !!onEditChapterNote;
        if (!canEdit) return null;
        return (
          <button
            key={b.id}
            type="button"
            className="msv-note-affordance"
            data-testid={`msv-note-affordance-${b.slotKind}-${b.partId ?? b.chapterId}`}
            onClick={() => {
              if (b.slotKind === 'part' && b.partId) onEditPartNote?.(b.partId, '');
              else if (b.slotKind === 'chapter' && b.chapterId) onEditChapterNote?.(b.chapterId, '');
            }}
          >
            {b.slotKind === 'part' ? '+ PART NOTE' : '+ CHAPTER NOTE'}
          </button>
        );
      }
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
              {/* M8: chapter titles are inline-editable (prototype editTitle). */}
              <div
                className="msv-h2-title"
                data-testid={`msv-chapter-title-${b.chapterId}`}
                contentEditable={!!onRenameChapter}
                suppressContentEditableWarning
                spellCheck={false}
                {...(onRenameChapter
                  ? {
                      role: 'textbox' as const,
                      'aria-label': 'Chapter title — Enter commits',
                      onBlur: (e: ReactFocusEvent<HTMLElement>) =>
                        commitHeadingRename('chapter', b.chapterId, b.title, e.currentTarget),
                      onKeyDown: headingKeyDown,
                    }
                  : {})}
              >
                {b.title}
              </div>
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
              {/* M8: scene titles are inline-editable; renaming a provisional
                  scene persists it (§1.5 — the shell's rename handler). */}
              <span
                className="msv-h3-title"
                data-testid={`msv-scene-title-${b.sceneId}`}
                contentEditable={!!onRenameScene}
                suppressContentEditableWarning
                spellCheck={false}
                {...(onRenameScene
                  ? {
                      role: 'textbox' as const,
                      'aria-label': 'Scene title — Enter commits',
                      onBlur: (e: ReactFocusEvent<HTMLElement>) =>
                        commitHeadingRename('scene', b.sceneId, b.title, e.currentTarget),
                      onKeyDown: headingKeyDown,
                    }
                  : {})}
              >
                {b.title}
              </span>
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
            dragging={
              !!dragPara && dragPara.sceneId === b.sceneId && dragPara.blockId === b.blockId
            }
            dropCap={b.first && (cursor.zoom === 'scene' || cursor.zoom === 'chapter')}
            paraStyle={paraStyle}
            onCommit={commitParagraph}
            onSplit={onSplitParagraph ? handleRowSplit : undefined}
            onMergeUp={onMergeParagraph ? handleRowMergeUp : undefined}
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
      {/* M1 row 3 (SKY-9013): depth-invariant title row (prototype 897–948). */}
      <TitleRow
        story={story}
        cursor={cursor}
        scene={scene}
        wordCount={scopeWords}
        commentCount={comments.length}
        commentsOpen={showComments}
        onToggleComments={() => setShowComments(!showComments)}
        onCycleStatus={onCycleStatus}
        focusActive={focusMode}
        onToggleFocus={onToggleFocus}
        drafts={
          drafts
            ? {
                drafts: drafts.drafts,
                currentLabel: drafts.currentLabel,
                currentContent: drafts.currentContent,
                documentLabel: drafts.documentLabel,
                popoverOpen: drafts.popoverOpen,
                onTogglePopover: drafts.onTogglePopover,
                onClosePopover: drafts.onClosePopover,
                onCompare: drafts.onCompare,
                onRestore: drafts.onRestore,
                splitOpen: drafts.splitOpen,
                onToggleSplit: drafts.onToggleSplit,
              }
            : undefined
        }
        onManualSnapshot={onManualSnapshot}
        snapshotSavedAt={snapshotSavedAt}
        onOpenSceneHistory={sceneHistory?.onOpen}
      />
      {/* M1 row 4 — zoom bar (prototype 949–970) */}
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
        {/* M1-S3: chrome is depth-invariant (AC #1) — the chevrons render at
            every depth and disable where stepping is impossible (book scope
            has no siblings) instead of unmounting and shifting the row. */}
        <div className="msv-zoom-nav">
          <button
            type="button"
            className="msv-zoom-arrow"
            data-testid="msv-zoom-prev"
            title="Previous (←)"
            disabled={cursor.zoom === 'book'}
            onClick={() => step(-1)}
          >
            {CHEVRON_LEFT(11)}
          </button>
          <button
            type="button"
            className="msv-zoom-arrow"
            data-testid="msv-zoom-next"
            title="Next (→)"
            disabled={cursor.zoom === 'book'}
            onClick={() => step(1)}
          >
            {CHEVRON_RIGHT(11)}
          </button>
        </div>
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
            (prototype 748) and toggles the same M13 reader dock. M1 moved the
            comments chip to row 3 and the page chip to row 5 (prototype rows). */}
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
          onChange={(e) => {
            const f = e.target.value as StoryFontName;
            setFont(f);
            commitPrefs({ fontName: f });
          }}
        >
          {STORY_FONT_NAMES.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <div className="msv-tb-size">
          <button
            type="button"
            className="msv-tb-size-btn"
            data-testid="msv-size-down"
            aria-label="Decrease font size"
            onClick={() => {
              const s = Math.max(FONT_STEP_MIN, fsize - 1);
              setFsize(s);
              commitPrefs({ fontSizeStep: s });
            }}
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
            onClick={() => {
              const s = Math.min(FONT_STEP_MAX, fsize + 1);
              setFsize(s);
              commitPrefs({ fontSizeStep: s });
            }}
          >
            +
          </button>
        </div>
        <select
          className="msv-tb-select msv-tb-line-spacing"
          data-testid="msv-line-spacing-select"
          aria-label="Line spacing"
          value={lineSpacing}
          onChange={(e) => {
            setLineSpacing(e.target.value);
            commitPrefs({ lineHeightX: Number(e.target.value) });
          }}
        >
          {LINE_SPACING_OPTIONS.map((ls) => (
            <option key={ls} value={ls}>
              {ls}
            </option>
          ))}
        </select>
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
        {/* M1 row 5 (SKY-9013): structure actions (prototype 1003–1011).
            "+ Part" is enabled now that M2 (SKY-9017) landed the Parts data model. */}
        <button
          type="button"
          className="msv-tb-add"
          data-testid="msv-add-part"
          title="Add a part to the story"
          disabled={!onAddPart}
          onClick={onAddPart}
        >
          + Part
        </button>
        {onAddChapter && (
          <button
            type="button"
            className="msv-tb-add"
            data-testid="msv-add-chapter"
            title="Add a chapter to the end of the story"
            onClick={onAddChapter}
          >
            + Chapter
          </button>
        )}
        {onAddScene && (
          <button
            type="button"
            className="msv-tb-add"
            data-testid="msv-add-scene"
            title="Add a new scene to this chapter"
            onClick={onAddScene}
          >
            + Scene
          </button>
        )}
        {/* M1 row 5: page chip — page setup as a compact popover (spec #5a). */}
        <div className="msv-page-setup-anchor">
          <button
            type="button"
            className={`msv-page-setup-btn${pageSetupOpen ? ' msv-page-setup-btn--on' : ''}`}
            data-testid="msv-page-setup-btn"
            title="Page setup — width and page style"
            aria-label="Page setup"
            aria-pressed={pageSetupOpen}
            onClick={() => setPageSetupOpen((v) => !v)}
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
              <path d="M3 12h18M6 8l-3 4 3 4M18 8l3 4-3 4" />
            </svg>
            <span className="msv-page-setup-readout">{pageW}px</span>
          </button>
          <PageSetupPopover
            isOpen={pageSetupOpen}
            onClose={() => setPageSetupOpen(false)}
            prefs={{
              ...STORY_PAGE_DEFAULTS,
              ...pagePrefs,
              pageWidthPx: pageW,
              pageMarginPx: marginPx,
              fontName: font,
              fontSizeStep: fsize,
              lineHeightX: Number(lineSpacing),
            }}
            onPrefsChange={(p) => {
              applyPrefsLocal(p);
              onPagePrefsChange?.(p);
            }}
            pageStyle={pageChrome.mode}
            onPageStyleChange={(mode) => onPageStyleChange?.(mode)}
            textureFileName={textureFileName}
            onPickPageTexture={onPickPageTexture}
          />
        </div>
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
            Coach
          </button>
        )}
      </div>

      {/* M7 / M1-S3 (§5.1, plan row 6): ONE ruler, two diamond pairs on the
          same track — outer drags page width, inner drags margins; live values
          render as the page-corner badge. */}
      <MarginRuler
        pageWidth={pageW}
        marginPx={marginPx}
        min={PAGE_WIDTH_MIN}
        max={PAGE_WIDTH_MAX}
        gutterOpen={commentsVisible}
        onChange={setPageW}
        onCommit={commitPageWidth}
        onMarginChange={setMarginPx}
        onMarginCommit={commitPageMargin}
        onDragLive={setRulerDrag}
      />

      {/* M11: page + comments gutter share a row (prototype 806 / 911) */}
      <div className="msv-body">
        {/* SKY-9404 (M1-S4): row wrapper — column layout normally; becomes a
            flex row hosting the drafts compare split when it's open (moved
            from the deleted legacy scene branch's shell-drafts-splitrow). */}
        <div className={`shell-drafts-splitrow${drafts?.splitOpen ? ' shell-drafts-splitrow--open' : ''}`}>
        {/* page scroll area with floating arrows (prototype 808–810) */}
        <div
          className="msv-page"
          ref={scrollRef}
          onScroll={handleScroll}
          onMouseDown={handlePageMouseDown}
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
          {/* M9: open comment card (v2 prototype cOpenData 1063–1085) */}
          {openComment && (
            <CommentOpenCard
              comment={openComment}
              onClose={() => setOpenCommentId(null)}
              onResolve={handleResolveComment}
              onAgentAction={handleAgentAction}
              commentsInFocus={commentsInFocus}
              onToggleCommentsInFocus={() => setCommentsInFocus(!commentsInFocus)}
            />
          )}
          <div className="msv-sheet-wrap" style={sheetWrapStyle}>
            <div
              className="msv-sheet"
              style={sheetStyle}
              data-testid="msv-sheet"
              data-page-mode={pageChrome.mode}
            >
              {pageChrome.mode === 'scroll' && <PageModeRunes sym={pageChrome.sym} />}
              {/* SKY-9404/SKY-5904: anchored to .msv-sheet (depth-invariant,
                  position: relative at every depth) so the arrows hug the
                  actual page edges instead of the full-width canvas behind it. */}
              {edgeNav && (
                <DepthEdgeArrows
                  depth={cursor.zoom}
                  canPrev={edgeNav.canPrev}
                  canNext={edgeNav.canNext}
                  onPrev={edgeNav.onPrev}
                  onNext={edgeNav.onNext}
                />
              )}
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
              {(edgeDragging || rulerDrag) && (
                <div className="msv-width-badge" data-testid="msv-width-badge">
                  {rulerDrag?.kind === 'margin'
                    ? `${rulerDrag.px} px margin`
                    : `${rulerDrag?.px ?? pageW} px page`}
                </div>
              )}
              <div style={{ height: topPad }} data-testid="msv-spacer-top" aria-hidden="true" />
              {sceneEditorSlot ?? visible.map(renderBlock)}
              <div
                style={{ height: bottomPad }}
                data-testid="msv-spacer-bottom"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
        {/* SKY-9404 (M1-S4): drafts compare split, moved from the deleted
            legacy scene branch — docked beside the page when open. */}
        {drafts?.splitOpen && (
          <DraftsCompareSplit
            scopeLabel={drafts.documentLabel}
            drafts={drafts.drafts}
            currentLabel={drafts.currentLabel}
            currentContent={drafts.currentContent}
            selectedTs={drafts.selectedTs}
            onSelectTs={drafts.onSelectTs}
            onFullDiff={drafts.onOpenDiff}
            onLoadDraft={drafts.onLoadDraft}
            undoLabel={drafts.undoLabel}
            onUndo={drafts.onUndo}
            onClose={drafts.onCloseSplit}
            error={drafts.error}
          />
        )}
        {/* SKY-9404: full side-by-side diff — covers the page area (chrome
            rows stay usable); current draft ALWAYS the left/green column. */}
        {drafts?.diffOpen && (() => {
          const diffDraft =
            drafts.drafts.find((d) => d.ts === drafts.selectedTs) ?? drafts.drafts[0] ?? null;
          return diffDraft ? (
            <div className="shell-drafts-diff-cover" data-testid="shell-drafts-diff-cover">
              <DraftDiffView
                documentLabel={drafts.documentLabel}
                currentLabel={drafts.currentLabel}
                previousLabel={diffDraft.label}
                currentText={drafts.currentContent}
                previousText={diffDraft.content}
                previousOptions={drafts.drafts.map((d) => ({ id: d.ts, label: d.label }))}
                selectedPreviousId={diffDraft.ts}
                onSelectPrevious={drafts.onSelectTs}
                onClose={drafts.onCloseDiff}
              />
            </div>
          ) : null;
        })()}
        </div>
        {/* M11: margin gutter dock (v2 prototype gutterOpen 6775): comments
            when visible, plus the Reader card while the reader is open —
            docked above the comments, centered when they're hidden. */}
        {((commentsVisible && comments.length > 0) || reader.open) && (
          <CommentsGutter
            comments={commentsVisible ? comments : NO_COMMENTS}
            openId={openCommentId}
            onToggleOpen={handleToggleOpenComment}
            onResolve={handleResolveComment}
            onAgentAction={handleAgentAction}
            readerSlot={
              reader.open ? <ReaderCard reader={reader} ttsSettings={ttsSettings} /> : null
            }
          />
        )}
      </div>
      {/* SKY-9404: scene history modal, moved from the deleted legacy scene
          branch. `SceneHistory` renders via a portal (position: fixed), so
          mount position within the tree doesn't affect layout. */}
      {sceneHistory?.open && (
        <SceneHistory
          sceneId={sceneHistory.sceneId}
          scenePath={sceneHistory.scenePath}
          currentContent={sceneHistory.currentContent}
          onRestore={sceneHistory.onRestore}
          onClose={sceneHistory.onClose}
        />
      )}
    </div>
  );
}
