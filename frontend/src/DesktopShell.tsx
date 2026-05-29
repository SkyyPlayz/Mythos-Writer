import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Story, Chapter, Scene, Block, Manifest, FocusPrefs } from './types';
import FocusModePrefsDialog from './FocusModePrefsDialog';
import { applyTheme, applyLiquidGlassTokens } from './theme';
import AppMenuBar from './AppMenuBar';
import LeftRail from './LeftRail';
import RightSidebar from './RightSidebar';
import BottomBar from './BottomBar';
import BlockEditor, { type BlockEditorApi } from './BlockEditor';
import type { WLSuggestion } from './WikiLinkHintExtension';
import EntityDetail from './EntityDetail';
import BrainstormPage from './BrainstormPage';
import KanbanBoard from './KanbanBoard';
import VaultGraphView from './VaultGraphView';
import { useTextPrompt } from './useTextPrompt';
import SettingsPanel from './SettingsPanel';
import PromptHistoryPanel from './PromptHistoryPanel';
import UpdateBanner from './UpdateBanner';
import BetaReadMargin from './BetaReadMargin';
import DepthSlider, { type ViewDepth } from './DepthSlider';
import { useVaultStore } from './stores/vaultStore';
import { useUIStore, DEFAULT_LAYOUT } from './stores/uiStore';
import './DesktopShell.css';

function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function blocksToMarkdown(scene: Scene): string {
  const lines: string[] = [
    `---`,
    `id: ${scene.id}`,
    `title: "${scene.title.replace(/"/g, '\\"')}"`,
    `draftState: ${scene.draftState ?? 'in-progress'}`,
    `updatedAt: ${now()}`,
    `---`,
    '',
  ];
  for (const block of [...scene.blocks].sort((a, b) => a.order - b.order)) {
    switch (block.type) {
      case 'heading':
        lines.push(`# ${block.content}`);
        break;
      case 'dialogue':
        lines.push(`> ${block.content}`);
        break;
      case 'action':
        lines.push(`**${block.content}**`);
        break;
      case 'description':
        lines.push(`*${block.content}*`);
        break;
      case 'note':
        lines.push(`<!-- ${block.content} -->`);
        break;
      default:
        lines.push(block.content);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Chapter doc view ───

interface ChapterDocViewProps {
  chapter: Chapter;
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene) => void;
}

function ChapterDocView({ chapter, selectedSceneId, onSelectScene }: ChapterDocViewProps) {
  const sortedScenes = useMemo(
    () => [...chapter.scenes].sort((a, b) => a.order - b.order),
    [chapter.scenes],
  );
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedSceneId]);

  return (
    <div className="chapter-doc-view">
      <div className="chapter-doc-header">{chapter.title}</div>
      <div className="chapter-doc-scenes">
        {sortedScenes.length === 0 ? (
          <div className="chapter-doc-empty">No scenes in this chapter yet.</div>
        ) : (
          sortedScenes.map((scene) => {
            const isActive = scene.id === selectedSceneId;
            const bodyText = scene.blocks
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((b) => b.content)
              .join('\n\n')
              .trim();
            return (
              <div
                key={scene.id}
                ref={isActive ? selectedRef : null}
                className={`chapter-doc-scene${isActive ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectScene(scene)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSelectScene(scene); } }}
                aria-pressed={isActive}
              >
                <div className="chapter-doc-scene-title">{scene.title}</div>
                {bodyText && (
                  <div className="chapter-doc-scene-excerpt">
                    {bodyText.slice(0, 300)}{bodyText.length > 300 ? '…' : ''}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Book outline view ───

interface BookOutlineViewProps {
  story: Story;
  selectedChapterId: string | null;
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter) => void;
}

function BookOutlineView({ story, selectedChapterId, selectedSceneId, onSelectScene }: BookOutlineViewProps) {
  const sortedChapters = useMemo(
    () => [...story.chapters].sort((a, b) => a.order - b.order),
    [story.chapters],
  );

  return (
    <div className="book-outline-view">
      <div className="book-outline-header">{story.title}</div>
      <div className="book-outline-body">
        {sortedChapters.length === 0 ? (
          <div className="book-outline-empty">No chapters yet.</div>
        ) : (
          sortedChapters.map((chapter) => {
            const isActiveChapter = chapter.id === selectedChapterId;
            const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
            return (
              <div key={chapter.id} className={`book-outline-chapter${isActiveChapter ? ' active-chapter' : ''}`}>
                <div className="book-outline-chapter-title">{chapter.title}</div>
                <div className="book-outline-scene-list">
                  {sortedScenes.length === 0 ? (
                    <div className="book-outline-no-scenes">No scenes</div>
                  ) : (
                    sortedScenes.map((scene) => {
                      const isActiveScene = scene.id === selectedSceneId;
                      return (
                        <div
                          key={scene.id}
                          className={`book-outline-scene${isActiveScene ? ' active-scene' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectScene(scene, chapter)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); onSelectScene(scene, chapter); }
                          }}
                          aria-pressed={isActiveScene}
                        >
                          {scene.title}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────

interface DragState {
  target: 'left' | 'right';
  startX: number;
  startWidth: number;
}

export default function DesktopShell() {
  const { requestText, promptModal } = useTextPrompt();

  // ─── Store subscriptions ───
  const layout = useUIStore((s) => s.layout);
  const view = useUIStore((s) => s.view);
  const writingMode = useUIStore((s) => s.writingMode);

  const stories = useVaultStore((s) => s.stories);
  const activeStoryId = useVaultStore((s) => s.activeStoryId);
  const activeChapterId = useVaultStore((s) => s.activeChapterId);
  const activeSceneId = useVaultStore((s) => s.activeSceneId);
  const activeEntity = useVaultStore((s) => s.activeEntity);

  // Derive full objects from IDs + stories
  const selectedStory = useMemo(
    () => stories.find((s) => s.id === activeStoryId) ?? null,
    [stories, activeStoryId],
  );
  const selectedChapter = useMemo(
    () => selectedStory?.chapters.find((c) => c.id === activeChapterId) ?? null,
    [selectedStory, activeChapterId],
  );
  const selectedScene = useMemo(
    () => selectedChapter?.scenes.find((s) => s.id === activeSceneId) ?? null,
    [selectedChapter, activeSceneId],
  );

  // ─── Local state (not in stores) ───
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeVaultRoot, setActiveVaultRoot] = useState<string>('');
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [budgetToast, setBudgetToast] = useState<string | null>(null);
  const budgetToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [betaReadComments, setBetaReadComments] = useState<BetaReadComment[]>([]);
  const [betaReadLoading, setBetaReadLoading] = useState(false);
  const [viewDepth, setViewDepth] = useState<ViewDepth>('scene');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorApiRef = useRef<BlockEditorApi | null>(null);
  const [wikiLinkSuggestions, setWikiLinkSuggestions] = useState<WLSuggestion[]>([]);
  const dragState = useRef<DragState | null>(null);

  // Keep manifest in a ref for use in effects/callbacks without stale closures
  const manifestRef = useRef<Manifest | null>(null);
  useEffect(() => { manifestRef.current = manifest; }, [manifest]);

  // ─── Layout auto-persist effect ───
  const layoutEffectInitRef = useRef(false);
  const scheduleManifestSave = useCallback((m: Manifest) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await (window as any).api.writeManifest(m); } catch (e) { console.error('Failed to persist manifest:', e); }
    }, 900);
  }, []);

  useEffect(() => {
    if (!layoutEffectInitRef.current) {
      layoutEffectInitRef.current = true;
      return;
    }
    const m = manifestRef.current;
    if (!m) return;
    const updated: Manifest = { ...m, layout };
    manifestRef.current = updated;
    setManifest(updated);
    scheduleManifestSave(updated);
  }, [layout, scheduleManifestSave]);

  // ─── Editor API forwarding ───

  const handleEditorReady = useCallback((api: BlockEditorApi) => {
    editorApiRef.current = api;
  }, []);

  const handleJumpToText = useCallback((text: string) => {
    editorApiRef.current?.jumpToText(text);
  }, []);

  const handleInsertWikiLink = useCallback((link: string, anchorText: string) => {
    editorApiRef.current?.insertWikiLink(link, anchorText);
  }, []);

  const handleEditorAcceptWikiLink = useCallback((id: string, link: string, anchorText: string) => {
    editorApiRef.current?.insertWikiLink(link, anchorText);
    setWikiLinkSuggestions((prev) => prev.filter((s) => s.id !== id));
    window.api?.suggestionsAccept?.(id).catch(() => {});
  }, []);

  const handleEditorRejectWikiLink = useCallback((id: string) => {
    setWikiLinkSuggestions((prev) => prev.filter((s) => s.id !== id));
    window.api?.suggestionsReject?.(id).catch(() => {});
  }, []);

  // ─── Beta-Read Mode ───

  const loadBetaReadComments = useCallback(async (sceneId: string) => {
    try {
      const res = await (window as any).api.betaReadList(sceneId);
      setBetaReadComments(res.comments ?? []);
    } catch {
      setBetaReadComments([]);
    }
  }, []);

  useEffect(() => {
    if (selectedScene) {
      loadBetaReadComments(selectedScene.id);
    } else {
      setBetaReadComments([]);
    }
  }, [selectedScene?.id, loadBetaReadComments]);

  const handleBetaReadRequest = useCallback(async (selectedText: string) => {
    const scene = useVaultStore.getState().activeSceneId
      ? useVaultStore.getState().stories
          .find((s) => s.id === useVaultStore.getState().activeStoryId)
          ?.chapters.find((c) => c.id === useVaultStore.getState().activeChapterId)
          ?.scenes.find((s) => s.id === useVaultStore.getState().activeSceneId) ?? null
      : null;
    if (!scene || betaReadLoading) return;
    setBetaReadLoading(true);
    try {
      const context = `You are a beta reader giving constructive feedback. Highlight strengths, flag anything confusing, and suggest one improvement. Be concise (2–4 sentences).\n\nPassage:\n\n${selectedText}`;
      const res = await (window as any).api.agentWritingAssistant(selectedText, context);
      const commentText: string = res?.text ?? 'No feedback generated.';
      await (window as any).api.betaReadCreate(scene.id, selectedText, commentText);
      await loadBetaReadComments(scene.id);
    } catch {
      // non-fatal
    } finally {
      setBetaReadLoading(false);
    }
  }, [betaReadLoading, loadBetaReadComments]);

  const handleBetaReadDismiss = useCallback(async (id: string) => {
    try {
      await (window as any).api.betaReadDismiss(id);
      setBetaReadComments((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // non-fatal
    }
  }, []);

  // ─── Budget cap toast ───

  useEffect(() => {
    if (!window.api.onBudgetCapHit) return;
    const unsub = window.api.onBudgetCapHit((event) => {
      const windowLabel = event.reason === 'daily_token_cap' ? 'daily' : 'hourly';
      const msg = `${event.agentLabel} paused: ${windowLabel} token cap reached.`;
      setBudgetToast(msg);
      if (budgetToastTimer.current) clearTimeout(budgetToastTimer.current);
      budgetToastTimer.current = setTimeout(() => setBudgetToast(null), 5000);
    });
    return () => {
      unsub();
      if (budgetToastTimer.current) clearTimeout(budgetToastTimer.current);
    };
  }, []);

  // ─── Vault loading ───

  const loadVault = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s, rootResult] = await Promise.all([
        (window as any).api.readManifest() as Promise<Manifest>,
        (window.api.settingsGet?.() ?? Promise.resolve(null)).catch(() => null),
        ((window as any).api.getVaultRoot?.() ?? Promise.resolve(null)).catch(() => null),
      ]);
      setManifest(m);
      manifestRef.current = m;
      useVaultStore.getState().setStories(m.stories ?? []);
      if (m.layout) {
        useUIStore.getState().setLayout({ ...DEFAULT_LAYOUT, ...m.layout });
      }
      if (s) {
        setAppSettings(s);
        applyTheme(s.theme);
        const lg = s.liquidGlass;
        if (lg?.background && lg.background !== 'default') {
          (window.api as any).loadBgImage?.(lg.background)
            .then((res: { dataUrl: string | null }) => applyLiquidGlassTokens(lg, res?.dataUrl))
            .catch(() => applyLiquidGlassTokens(lg));
        } else {
          applyLiquidGlassTokens(lg);
        }
      }
      if (rootResult?.vaultRoot) setActiveVaultRoot(rootResult.vaultRoot);
    } catch (e) {
      setError('Failed to load vault: ' + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVault();
  }, [loadVault]);

  // Handle project switches pushed from main process
  useEffect(() => {
    if (!(window as any).api?.onProjectSwitched) return;
    const unsub = (window as any).api.onProjectSwitched((data: { vaultRoot: string }) => {
      setActiveVaultRoot(data.vaultRoot);
      useVaultStore.getState().clearSelection();
      loadVault();
    });
    return () => unsub?.();
  }, [loadVault]);

  const handleProjectSwitched = useCallback((vaultRoot: string) => {
    setActiveVaultRoot(vaultRoot);
    useVaultStore.getState().clearSelection();
    loadVault();
  }, [loadVault]);

  // ─── Manifest persistence ───

  const updateManifest = useCallback((updatedStories: Story[]) => {
    useVaultStore.getState().setStories(updatedStories);
    const m = manifestRef.current;
    if (!m) return;
    const currentLayout = useUIStore.getState().layout;
    const updated: Manifest = { ...m, stories: updatedStories, layout: currentLayout };
    manifestRef.current = updated;
    setManifest(updated);
    scheduleManifestSave(updated);
  }, [scheduleManifestSave]);

  // ─── Writing mode keyboard shortcuts ───

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey) return;
      if (e.key === 'F' || e.key === 'f') { e.preventDefault(); useUIStore.getState().setWritingMode('focus'); }
      else if (e.key === 'E' || e.key === 'e') { e.preventDefault(); useUIStore.getState().setWritingMode('edit'); }
      else if (e.key === 'N' || e.key === 'n') { e.preventDefault(); useUIStore.getState().setWritingMode('normal'); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ─── Panel resize drag handlers ───

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const { target, startX, startWidth } = dragState.current;
      const delta = e.clientX - startX;
      const newWidth = Math.max(160, Math.min(500, startWidth + (target === 'left' ? delta : -delta)));
      useUIStore.getState().setLayout({
        ...useUIStore.getState().layout,
        [target === 'left' ? 'leftWidth' : 'rightWidth']: newWidth,
      });
    };

    const onMouseUp = () => {
      dragState.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startDrag = useCallback((target: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    const { layout: currLayout } = useUIStore.getState();
    dragState.current = {
      target,
      startX: e.clientX,
      startWidth: target === 'left' ? currLayout.leftWidth : currLayout.rightWidth,
    };
  }, []);

  const adjustPanelWidth = useCallback((target: 'left' | 'right', delta: number) => {
    const { layout: currLayout } = useUIStore.getState();
    const key = target === 'left' ? 'leftWidth' : 'rightWidth';
    const newWidth = Math.max(160, Math.min(500, currLayout[key] + delta));
    useUIStore.getState().setLayout({ ...currLayout, [key]: newWidth });
  }, []);

  // ─── Story/scene management ───

  const persistSceneMarkdown = useCallback(async (scene: Scene) => {
    try {
      await (window as any).api.writeVault(scene.path, blocksToMarkdown(scene));
    } catch (e) {
      console.error('Failed to write scene markdown:', e);
    }
  }, []);

  const handleBlocksChange = useCallback((blocks: Block[]) => {
    const { stories: currentStories, activeStoryId: sid, activeChapterId: cid, activeSceneId: scid } = useVaultStore.getState();
    const story = currentStories.find((s) => s.id === sid) ?? null;
    const chapter = story?.chapters.find((c) => c.id === cid) ?? null;
    const scene = chapter?.scenes.find((s) => s.id === scid) ?? null;
    if (!scene || !chapter || !story) return;
    const updatedScene: Scene = { ...scene, blocks, updatedAt: now() };
    const updatedStories = currentStories.map((st) =>
      st.id !== story.id ? st : {
        ...st,
        chapters: st.chapters.map((ch) =>
          ch.id !== chapter.id ? ch : {
            ...ch,
            scenes: ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
    persistSceneMarkdown(updatedScene);
    const content = blocks.map((b) => b.content).join('\n\n');
    (window as any).api.snapshotSave?.(scene.id, content).catch(() => {});
  }, [updateManifest, persistSceneMarkdown]);

  const handleDraftStateChange = useCallback((state: import('./types').DraftState) => {
    const { stories: currentStories, activeStoryId: sid, activeChapterId: cid, activeSceneId: scid } = useVaultStore.getState();
    const story = currentStories.find((s) => s.id === sid) ?? null;
    const chapter = story?.chapters.find((c) => c.id === cid) ?? null;
    const scene = chapter?.scenes.find((s) => s.id === scid) ?? null;
    if (!scene || !chapter || !story) return;
    const updatedScene: Scene = { ...scene, draftState: state, updatedAt: now() };
    const updatedStories = currentStories.map((st) =>
      st.id !== story.id ? st : {
        ...st,
        chapters: st.chapters.map((ch) =>
          ch.id !== chapter.id ? ch : {
            ...ch,
            scenes: ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
  }, [updateManifest]);

  const createStory = useCallback(async () => {
    const title = await requestText('Story title:');
    if (!title?.trim()) return;
    const id = generateId();
    const story: Story = {
      id, title: title.trim(), path: `stories/${id}`,
      chapters: [], createdAt: now(), updatedAt: now(),
    };
    updateManifest([...useVaultStore.getState().stories, story]);
  }, [updateManifest, requestText]);

  const createChapter = useCallback(async (storyId: string) => {
    const title = await requestText('Chapter title:');
    if (!title?.trim()) return;
    const id = generateId();
    const currentStories = useVaultStore.getState().stories;
    const chapter: Chapter = {
      id, title: title.trim(),
      path: `stories/${storyId}/chapters/${id}`,
      order: currentStories.find((s) => s.id === storyId)?.chapters.length ?? 0,
      scenes: [], createdAt: now(), updatedAt: now(),
    };
    updateManifest(currentStories.map((s) =>
      s.id !== storyId ? s : { ...s, chapters: [...s.chapters, chapter] }
    ));
  }, [updateManifest, requestText]);

  const createScene = useCallback(async (storyId: string, chapterId: string) => {
    const title = await requestText('Scene title:');
    if (!title?.trim()) return;
    const id = generateId();
    const currentStories = useVaultStore.getState().stories;
    const story = currentStories.find((s) => s.id === storyId)!;
    const chapter = story.chapters.find((c) => c.id === chapterId)!;
    const scene: Scene = {
      id, title: title.trim(),
      path: `stories/${storyId}/chapters/${chapterId}/scenes/${id}.md`,
      order: chapter.scenes.length, chapterId, storyId,
      blocks: [], draftState: 'in-progress',
      createdAt: now(), updatedAt: now(),
    };
    updateManifest(currentStories.map((s) =>
      s.id !== storyId ? s : {
        ...s,
        chapters: s.chapters.map((ch) =>
          ch.id !== chapterId ? ch : { ...ch, scenes: [...ch.scenes, scene] }
        ),
      }
    ));
    (window as any).api?.writeVault?.(scene.path, blocksToMarkdown(scene)).catch(() => {});
  }, [updateManifest, requestText]);

  const handleReorderScenes = useCallback((storyId: string, chapterId: string, orderedIds: string[]) => {
    const currentStories = useVaultStore.getState().stories;
    const updatedStories = currentStories.map((s) =>
      s.id !== storyId ? s : {
        ...s,
        chapters: s.chapters.map((ch) =>
          ch.id !== chapterId ? ch : {
            ...ch,
            scenes: orderedIds.map((id, idx) => {
              const sc = ch.scenes.find((scene) => scene.id === id)!;
              return { ...sc, order: idx };
            }),
          }
        ),
      }
    );
    updateManifest(updatedStories);
  }, [updateManifest]);

  const handleOpenSceneByPath = useCallback((scenePath: string) => {
    const { stories: currentStories, setActiveScene } = useVaultStore.getState();
    for (const story of currentStories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((sc) => sc.path === scenePath);
        if (scene) {
          setActiveScene(story.id, chapter.id, scene.id);
          return;
        }
      }
    }
  }, []);

  // ─── Header depth slider navigation ───

  const depthCanPrev = useMemo(() => {
    if (!selectedStory) return false;
    if (viewDepth === 'scene') {
      if (!selectedChapter || !selectedScene) return false;
      const sorted = [...selectedChapter.scenes].sort((a, b) => a.order - b.order);
      return sorted.findIndex((s) => s.id === selectedScene.id) > 0;
    }
    if (viewDepth === 'chapter') {
      if (!selectedChapter) return false;
      const sorted = [...selectedStory.chapters].sort((a, b) => a.order - b.order);
      return sorted.findIndex((c) => c.id === selectedChapter.id) > 0;
    }
    return stories.findIndex((s) => s.id === selectedStory.id) > 0;
  }, [viewDepth, selectedScene, selectedChapter, selectedStory, stories]);

  const depthCanNext = useMemo(() => {
    if (!selectedStory) return false;
    if (viewDepth === 'scene') {
      if (!selectedChapter || !selectedScene) return false;
      const sorted = [...selectedChapter.scenes].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === selectedScene.id);
      return idx >= 0 && idx < sorted.length - 1;
    }
    if (viewDepth === 'chapter') {
      if (!selectedChapter) return false;
      const sorted = [...selectedStory.chapters].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((c) => c.id === selectedChapter.id);
      return idx >= 0 && idx < sorted.length - 1;
    }
    const idx = stories.findIndex((s) => s.id === selectedStory.id);
    return idx >= 0 && idx < stories.length - 1;
  }, [viewDepth, selectedScene, selectedChapter, selectedStory, stories]);

  const depthContextLabel = useMemo(() => {
    if (!selectedStory) return '';
    if (viewDepth === 'scene' && selectedChapter && selectedScene) {
      return `${selectedChapter.title} › ${selectedScene.title}`;
    }
    if (viewDepth === 'chapter' && selectedChapter) {
      return `${selectedStory.title} › ${selectedChapter.title}`;
    }
    return selectedStory.title;
  }, [viewDepth, selectedScene, selectedChapter, selectedStory]);

  const handleDepthPrev = useCallback(() => {
    const { stories: currentStories, setActiveScene } = useVaultStore.getState();
    const story = currentStories.find((s) => s.id === useVaultStore.getState().activeStoryId) ?? null;
    const chapter = story?.chapters.find((c) => c.id === useVaultStore.getState().activeChapterId) ?? null;
    const scene = chapter?.scenes.find((s) => s.id === useVaultStore.getState().activeSceneId) ?? null;
    if (!story) return;
    if (viewDepth === 'scene') {
      if (!chapter || !scene) return;
      const sorted = [...chapter.scenes].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === scene.id);
      if (idx > 0) setActiveScene(story.id, chapter.id, sorted[idx - 1].id);
    } else if (viewDepth === 'chapter') {
      if (!chapter) return;
      const sorted = [...story.chapters].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((c) => c.id === chapter.id);
      if (idx > 0) {
        const prev = sorted[idx - 1];
        const firstScene = [...prev.scenes].sort((a, b) => a.order - b.order)[0];
        if (firstScene) {
          setActiveScene(story.id, prev.id, firstScene.id);
        } else {
          setActiveScene(story.id, prev.id, null);
        }
      }
    } else {
      const idx = currentStories.findIndex((s) => s.id === story.id);
      if (idx > 0) {
        const prev = currentStories[idx - 1];
        const firstCh = [...prev.chapters].sort((a, b) => a.order - b.order)[0];
        const firstSc = firstCh ? [...firstCh.scenes].sort((a, b) => a.order - b.order)[0] : null;
        if (firstSc && firstCh) {
          setActiveScene(prev.id, firstCh.id, firstSc.id);
        } else if (firstCh) {
          setActiveScene(prev.id, firstCh.id, null);
        } else {
          setActiveScene(prev.id, null, null);
        }
      }
    }
  }, [viewDepth]);

  const handleDepthNext = useCallback(() => {
    const { stories: currentStories, setActiveScene } = useVaultStore.getState();
    const story = currentStories.find((s) => s.id === useVaultStore.getState().activeStoryId) ?? null;
    const chapter = story?.chapters.find((c) => c.id === useVaultStore.getState().activeChapterId) ?? null;
    const scene = chapter?.scenes.find((s) => s.id === useVaultStore.getState().activeSceneId) ?? null;
    if (!story) return;
    if (viewDepth === 'scene') {
      if (!chapter || !scene) return;
      const sorted = [...chapter.scenes].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === scene.id);
      if (idx >= 0 && idx < sorted.length - 1) setActiveScene(story.id, chapter.id, sorted[idx + 1].id);
    } else if (viewDepth === 'chapter') {
      if (!chapter) return;
      const sorted = [...story.chapters].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((c) => c.id === chapter.id);
      if (idx >= 0 && idx < sorted.length - 1) {
        const next = sorted[idx + 1];
        const firstScene = [...next.scenes].sort((a, b) => a.order - b.order)[0];
        if (firstScene) {
          setActiveScene(story.id, next.id, firstScene.id);
        } else {
          setActiveScene(story.id, next.id, null);
        }
      }
    } else {
      const idx = currentStories.findIndex((s) => s.id === story.id);
      if (idx >= 0 && idx < currentStories.length - 1) {
        const next = currentStories[idx + 1];
        const firstCh = [...next.chapters].sort((a, b) => a.order - b.order)[0];
        const firstSc = firstCh ? [...firstCh.scenes].sort((a, b) => a.order - b.order)[0] : null;
        if (firstSc && firstCh) {
          setActiveScene(next.id, firstCh.id, firstSc.id);
        } else if (firstCh) {
          setActiveScene(next.id, firstCh.id, null);
        } else {
          setActiveScene(next.id, null, null);
        }
      }
    }
  }, [viewDepth]);

  const handleViewDepthChange = useCallback((newDepth: ViewDepth) => {
    setViewDepth(newDepth);
    if (newDepth === 'scene') {
      const { activeSceneId: scid, activeChapterId: cid, activeStoryId: sid, stories: currentStories, setActiveScene } = useVaultStore.getState();
      if (!scid && cid && sid) {
        const story = currentStories.find((s) => s.id === sid);
        const chapter = story?.chapters.find((c) => c.id === cid);
        if (chapter) {
          const first = [...chapter.scenes].sort((a, b) => a.order - b.order)[0];
          if (first) setActiveScene(sid, cid, first.id);
        }
      }
    }
  }, []);

  if (loading) {
    return (
      <div className="shell-loading">
        <div className="shell-loading-inner">
          <div className="shell-loading-spinner" />
          <p>Loading your vault…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="shell-error">
        <p>{error}</p>
      </div>
    );
  }

  const agentFlags = {
    writingAssistant: appSettings?.agents?.writingAssistant?.enabled ?? true,
    brainstorm: appSettings?.agents?.brainstorm?.enabled ?? true,
    archive: appSettings?.agents?.archive?.enabled ?? true,
  };

  const focusPrefs: FocusPrefs = layout.focusPrefs ?? { showLeftSidebar: false, showRightSidebar: false, showBottomBar: false };
  const showLeftSidebar = writingMode !== 'focus' || focusPrefs.showLeftSidebar;
  const showRightSidebar = writingMode !== 'focus' || focusPrefs.showRightSidebar;
  const showBottomBar = writingMode !== 'focus' || focusPrefs.showBottomBar;
  const openModals = useUIStore.getState().openModals;
  const settingsOpen = openModals.includes('settings');
  const historyOpen = openModals.includes('history');
  const focusModePrefsOpen = openModals.includes('focusModePrefs');
  const closeModal = useUIStore.getState().closeModal;

  return (
    <div className={`desktop-shell writing-mode-${writingMode}`}>
      <UpdateBanner />
      <AppMenuBar
        activeVaultRoot={activeVaultRoot}
        onProjectSwitched={handleProjectSwitched}
      />
      {settingsOpen && (
        <SettingsPanel
          onClose={() => closeModal('settings')}
          onSaved={(s) => {
            setAppSettings(s);
            applyTheme(s.theme);
            applyLiquidGlassTokens(s.liquidGlass);
          }}
        />
      )}
      {historyOpen && (
        <PromptHistoryPanel onClose={() => closeModal('history')} />
      )}
      {focusModePrefsOpen && (
        <FocusModePrefsDialog
          prefs={focusPrefs}
          onChange={(prefs) => useUIStore.getState().setLayout({ ...layout, focusPrefs: prefs })}
          onClose={() => closeModal('focusModePrefs')}
        />
      )}
      {view === 'brainstorm' && (
        <BrainstormPage onClose={() => useUIStore.getState().setView('editor')} enabled={agentFlags.brainstorm} />
      )}
      {view === 'kanban' && (
        <div className="shell-kanban">
          {selectedStory ? (
            <KanbanBoard
              key={selectedStory.id}
              boardPath={`${selectedStory.path}/kanban.md`}
              storyTitle={selectedStory.title}
            />
          ) : (
            <div className="shell-editor-empty">
              <div className="shell-editor-empty-icon">🗂️</div>
              <h2>No Story Selected</h2>
              <p>Select a story from the Editor view to open its Scene Board.</p>
            </div>
          )}
        </div>
      )}
      {view === 'graph' && (
        <div className="shell-graph">
          <VaultGraphView onOpenNote={handleOpenSceneByPath} />
        </div>
      )}
      {view === 'editor' && <div className="shell-panels">
      {/* Left rail */}
      {showLeftSidebar && (
        <div className="shell-left" style={{ width: layout.leftWidth }}>
          <LeftRail
            onCreateStory={createStory}
            onCreateChapter={createChapter}
            onCreateScene={createScene}
            onReorderScenes={handleReorderScenes}
            onOpenVaultPath={handleOpenSceneByPath}
          />
        </div>
      )}

      {/* Left resize handle */}
      {showLeftSidebar && (
        <div
          role="separator"
          aria-label="Resize left panel"
          aria-orientation="vertical"
          aria-valuenow={layout.leftWidth}
          aria-valuemin={160}
          aria-valuemax={500}
          tabIndex={0}
          className="shell-divider shell-divider-left"
          onMouseDown={(e) => startDrag('left', e)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); adjustPanelWidth('left', +8); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); adjustPanelWidth('left', -8); }
            else if (e.key === 'Home') { e.preventDefault(); useUIStore.getState().setLayout({ ...layout, leftWidth: 160 }); }
            else if (e.key === 'End') { e.preventDefault(); useUIStore.getState().setLayout({ ...layout, leftWidth: 500 }); }
          }}
        />
      )}

      {/* Center + bottom */}
      <div className="shell-center-column">
        <div className="shell-editor">
          {selectedStory && (
            <DepthSlider
              depth={viewDepth}
              onDepthChange={handleViewDepthChange}
              canPrev={depthCanPrev}
              canNext={depthCanNext}
              onPrev={handleDepthPrev}
              onNext={handleDepthNext}
              contextLabel={depthContextLabel}
            />
          )}
          {viewDepth === 'book' && selectedStory ? (
            <BookOutlineView
              story={selectedStory}
              selectedChapterId={selectedChapter?.id ?? null}
              selectedSceneId={selectedScene?.id ?? null}
              onSelectScene={(sc, ch) => {
                useVaultStore.getState().setActiveScene(selectedStory.id, ch.id, sc.id);
                setViewDepth('scene');
              }}
            />
          ) : viewDepth === 'chapter' && selectedChapter ? (
            <ChapterDocView
              chapter={selectedChapter}
              selectedSceneId={selectedScene?.id ?? null}
              onSelectScene={(sc) => {
                if (selectedStory) {
                  useVaultStore.getState().setActiveScene(selectedStory.id, selectedChapter.id, sc.id);
                  setViewDepth('scene');
                }
              }}
            />
          ) : selectedScene ? (
            <div className="shell-editor-beta-wrap">
              <BlockEditor
                key={selectedScene.id}
                scene={selectedScene}
                onBlocksChange={handleBlocksChange}
                onDraftStateChange={handleDraftStateChange}
                onEditorReady={handleEditorReady}
                onBetaReadRequest={handleBetaReadRequest}
                wikiLinkSuggestions={wikiLinkSuggestions}
                onAcceptWikiLink={handleEditorAcceptWikiLink}
                onRejectWikiLink={handleEditorRejectWikiLink}
              />
              {(betaReadComments.length > 0 || betaReadLoading) && (
                <div className="shell-beta-margin">
                  {betaReadLoading && (
                    <div className="br-loading" aria-live="polite">
                      <span className="wa-spinner" aria-hidden="true" />
                      Reading…
                    </div>
                  )}
                  <BetaReadMargin
                    comments={betaReadComments}
                    onDismiss={handleBetaReadDismiss}
                  />
                </div>
              )}
            </div>
          ) : activeEntity ? (
            <EntityDetail
              key={activeEntity.id}
              entity={activeEntity}
              onClose={() => useVaultStore.getState().clearSelection()}
              onUpdated={(updated) => useVaultStore.getState().setActiveEntity(updated)}
              onDeleted={() => useVaultStore.getState().clearSelection()}
              onOpenScene={handleOpenSceneByPath}
            />
          ) : (
            <div className="shell-editor-empty">
              <div className="shell-editor-empty-icon">✍️</div>
              <h2>Welcome to Mythos Writer</h2>
              <p>Select a scene from the left panel to start writing.</p>
              <p className="shell-editor-empty-sub">
                No stories yet? Click the <strong>+</strong> button in the Stories panel to create your first story.
              </p>
            </div>
          )}
        </div>
        {showBottomBar && <BottomBar />}
      </div>

      {/* Right resize handle */}
      {showRightSidebar && (
        <div
          role="separator"
          aria-label="Resize right panel"
          aria-orientation="vertical"
          aria-valuenow={layout.rightWidth}
          aria-valuemin={160}
          aria-valuemax={500}
          tabIndex={0}
          className="shell-divider shell-divider-right"
          onMouseDown={(e) => startDrag('right', e)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); adjustPanelWidth('right', +8); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); adjustPanelWidth('right', -8); }
            else if (e.key === 'Home') { e.preventDefault(); useUIStore.getState().setLayout({ ...layout, rightWidth: 160 }); }
            else if (e.key === 'End') { e.preventDefault(); useUIStore.getState().setLayout({ ...layout, rightWidth: 500 }); }
          }}
        />
      )}

      {/* Right sidebar */}
      {showRightSidebar && (
        <div className="shell-right" style={{ width: layout.rightWidth }}>
          <RightSidebar
            writingAssistantEnabled={agentFlags.writingAssistant}
            archiveEnabled={agentFlags.archive}
            scanIntervalSeconds={appSettings?.agents?.writingAssistant?.scanIntervalSeconds ?? 30}
            onJumpToText={handleJumpToText}
            onInsertWikiLink={handleInsertWikiLink}
            onWikiLinkSuggestionsChange={setWikiLinkSuggestions}
          />
        </div>
      )}
      </div>}{/* end shell-panels */}
      {budgetToast && (
        <div className="budget-toast" role="alert" aria-live="assertive">
          {budgetToast}
        </div>
      )}
      {promptModal}
    </div>
  );
}
