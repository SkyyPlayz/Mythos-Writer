import { useState, useEffect, useCallback, useRef } from 'react';
import type { Story, Chapter, Scene, Block, Manifest, DraftState, LayoutPrefs, EntityEntry } from './types';
import { applyTheme } from './theme';
import LeftRail from './LeftRail';
import RightSidebar from './RightSidebar';
import BottomBar from './BottomBar';
import BlockEditor, { type BlockEditorApi } from './BlockEditor';
import EntityDetail from './EntityDetail';
import BrainstormPage from './BrainstormPage';
import KanbanBoard from './KanbanBoard';
import VaultGraphView from './VaultGraphView';
import SettingsPanel from './SettingsPanel';
import PromptHistoryPanel from './PromptHistoryPanel';
import UpdateBanner from './UpdateBanner';
import SearchBar from './SearchBar';
import BetaReadMargin from './BetaReadMargin';
import './DesktopShell.css';

const DEFAULT_LAYOUT: LayoutPrefs = {
  leftWidth: 240,
  rightWidth: 260,
  bottomHeight: 32,
  rightTab: 'notes',
  leftTab: 'stories',
};

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

type AppView = 'editor' | 'brainstorm' | 'kanban' | 'graph';

interface SearchResultItem {
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

interface AppMenuBarProps {
  view: AppView;
  onSetView: (v: AppView) => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onSearchNavigate: (result: SearchResultItem) => void;
}

function AppMenuBar({ view, onSetView, onOpenSettings, onOpenHistory, onSearchNavigate }: AppMenuBarProps) {
  return (
    <div className="app-menu-bar">
      <span className="app-menu-brand">Mythos</span>
      <div className="app-menu-items">
        <div className="app-menu-item" tabIndex={0}>
          File
          <div className="app-menu-dropdown">
            <button className="app-menu-dropdown-item" onClick={() => (window as any).api?.newStory?.()}>New Story</button>
            <button className="app-menu-dropdown-item" onClick={() => (window as any).api?.openVault?.()}>Open Vault…</button>
            <div className="app-menu-separator" />
            <button className="app-menu-dropdown-item" onClick={onOpenHistory}>Prompt History…</button>
            <div className="app-menu-separator" />
            <button className="app-menu-dropdown-item" onClick={onOpenSettings}>Settings…</button>
          </div>
        </div>
      </div>
      <SearchBar onNavigate={onSearchNavigate} />
      <div className="app-menu-view-toggle">
        <button
          className={`app-menu-view-btn${view === 'editor' ? ' active' : ''}`}
          onClick={() => onSetView('editor')}
          aria-pressed={view === 'editor'}
        >
          Editor
        </button>
        <button
          className={`app-menu-view-btn${view === 'brainstorm' ? ' active' : ''}`}
          onClick={() => onSetView('brainstorm')}
          aria-pressed={view === 'brainstorm'}
        >
          Brainstorm
        </button>
        <button
          className={`app-menu-view-btn${view === 'kanban' ? ' active' : ''}`}
          onClick={() => onSetView('kanban')}
          aria-pressed={view === 'kanban'}
        >
          Board
        </button>
        <button
          className={`app-menu-view-btn${view === 'graph' ? ' active' : ''}`}
          onClick={() => onSetView('graph')}
          aria-pressed={view === 'graph'}
        >
          Graph
        </button>
      </div>
      <button
        className="app-menu-gear-btn"
        onClick={onOpenSettings}
        aria-label="Open settings"
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}

interface DragState {
  target: 'left' | 'right';
  startX: number;
  startWidth: number;
}

export default function DesktopShell() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<EntityEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutPrefs>(DEFAULT_LAYOUT);
  const [view, setView] = useState<AppView>('editor');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [budgetToast, setBudgetToast] = useState<string | null>(null);
  const budgetToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [betaReadComments, setBetaReadComments] = useState<BetaReadComment[]>([]);
  const [betaReadLoading, setBetaReadLoading] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorApiRef = useRef<BlockEditorApi | null>(null);

  const handleEditorReady = useCallback((api: BlockEditorApi) => {
    editorApiRef.current = api;
  }, []);

  const handleJumpToText = useCallback((text: string) => {
    editorApiRef.current?.jumpToText(text);
  }, []);

  const handleInsertWikiLink = useCallback((link: string, anchorText: string) => {
    editorApiRef.current?.insertWikiLink(link, anchorText);
  }, []);
  const dragState = useRef<DragState | null>(null);

  // ─── Beta-Read Mode (MYT-237) ───

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
    if (!selectedScene || betaReadLoading) return;
    setBetaReadLoading(true);
    try {
      const context = `You are a beta reader giving constructive feedback. Highlight strengths, flag anything confusing, and suggest one improvement. Be concise (2–4 sentences).\n\nPassage:\n\n${selectedText}`;
      const res = await (window as any).api.agentWritingAssistant(selectedText, context);
      const commentText: string = res?.text ?? 'No feedback generated.';
      await (window as any).api.betaReadCreate(selectedScene.id, selectedText, commentText);
      await loadBetaReadComments(selectedScene.id);
    } catch {
      // non-fatal
    } finally {
      setBetaReadLoading(false);
    }
  }, [selectedScene, betaReadLoading, loadBetaReadComments]);

  const handleBetaReadDismiss = useCallback(async (id: string) => {
    try {
      await (window as any).api.betaReadDismiss(id);
      setBetaReadComments((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // non-fatal
    }
  }, []);

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

  useEffect(() => {
    (async () => {
      try {
        const [m, s] = await Promise.all([
          (window as any).api.readManifest() as Promise<Manifest>,
          (window.api.settingsGet?.() ?? Promise.resolve(null)).catch(() => null),
        ]);
        setManifest(m);
        setStories(m.stories ?? []);
        if (m.layout) {
          setLayout({ ...DEFAULT_LAYOUT, ...m.layout });
        }
        if (s) setAppSettings(s);
      } catch (e) {
        setError('Failed to load vault: ' + String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persistManifest = useCallback(async (m: Manifest) => {
    try {
      await (window as any).api.writeManifest(m);
    } catch (e) {
      console.error('Failed to persist manifest:', e);
    }
  }, []);

  const scheduleManifestSave = useCallback((m: Manifest) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistManifest(m), 900);
  }, [persistManifest]);

  const updateManifest = useCallback((updatedStories: Story[], updatedLayout?: LayoutPrefs) => {
    setStories(updatedStories);
    if (!manifest) return;
    const updated: Manifest = {
      ...manifest,
      stories: updatedStories,
      layout: updatedLayout ?? layout,
    };
    setManifest(updated);
    scheduleManifestSave(updated);
  }, [manifest, layout, scheduleManifestSave]);

  const persistLayout = useCallback((newLayout: LayoutPrefs) => {
    setLayout(newLayout);
    if (!manifest) return;
    const updated: Manifest = { ...manifest, layout: newLayout };
    setManifest(updated);
    scheduleManifestSave(updated);
  }, [manifest, scheduleManifestSave]);

  // ─── Panel resize drag handlers ───

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const { target, startX, startWidth } = dragState.current;
      const delta = e.clientX - startX;
      const newWidth = Math.max(160, Math.min(500, startWidth + (target === 'left' ? delta : -delta)));
      setLayout((prev) => {
        const next = { ...prev, [target === 'left' ? 'leftWidth' : 'rightWidth']: newWidth };
        return next;
      });
    };

    const onMouseUp = () => {
      if (!dragState.current) return;
      dragState.current = null;
      setLayout((curr) => {
        persistLayout(curr);
        return curr;
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [persistLayout]);

  const startDrag = useCallback((target: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = {
      target,
      startX: e.clientX,
      startWidth: target === 'left' ? layout.leftWidth : layout.rightWidth,
    };
  }, [layout]);

  // ─── Story/scene management ───

  const persistSceneMarkdown = useCallback(async (scene: Scene) => {
    try {
      await (window as any).api.writeVault(scene.path, blocksToMarkdown(scene));
    } catch (e) {
      console.error('Failed to write scene markdown:', e);
    }
  }, []);

  const handleBlocksChange = useCallback((blocks: Block[]) => {
    if (!selectedScene || !selectedChapter || !selectedStory) return;
    const updatedScene: Scene = { ...selectedScene, blocks, updatedAt: now() };
    setSelectedScene(updatedScene);
    const updatedStories = stories.map((story) =>
      story.id !== selectedStory.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== selectedChapter.id ? ch : {
            ...ch,
            scenes: ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
    persistSceneMarkdown(updatedScene);
    const content = blocks.map((b) => b.content).join('\n\n');
    (window as any).api.snapshotSave?.(selectedScene.id, content).catch(() => {});
  }, [selectedScene, selectedChapter, selectedStory, stories, updateManifest, persistSceneMarkdown]);

  const handleDraftStateChange = useCallback((state: DraftState) => {
    if (!selectedScene || !selectedChapter || !selectedStory) return;
    const updatedScene: Scene = { ...selectedScene, draftState: state, updatedAt: now() };
    setSelectedScene(updatedScene);
    const updatedStories = stories.map((story) =>
      story.id !== selectedStory.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== selectedChapter.id ? ch : {
            ...ch,
            scenes: ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
  }, [selectedScene, selectedChapter, selectedStory, stories, updateManifest]);

  const createStory = useCallback(() => {
    const title = prompt('Story title:');
    if (!title?.trim()) return;
    const id = generateId();
    const story: Story = {
      id, title: title.trim(), path: `stories/${id}`,
      chapters: [], createdAt: now(), updatedAt: now(),
    };
    updateManifest([...stories, story]);
  }, [stories, updateManifest]);

  const createChapter = useCallback((storyId: string) => {
    const title = prompt('Chapter title:');
    if (!title?.trim()) return;
    const id = generateId();
    const chapter: Chapter = {
      id, title: title.trim(),
      path: `stories/${storyId}/chapters/${id}`,
      order: stories.find((s) => s.id === storyId)?.chapters.length ?? 0,
      scenes: [], createdAt: now(), updatedAt: now(),
    };
    updateManifest(stories.map((s) =>
      s.id !== storyId ? s : { ...s, chapters: [...s.chapters, chapter] }
    ));
  }, [stories, updateManifest]);

  const createScene = useCallback((storyId: string, chapterId: string) => {
    const title = prompt('Scene title:');
    if (!title?.trim()) return;
    const id = generateId();
    const story = stories.find((s) => s.id === storyId)!;
    const chapter = story.chapters.find((c) => c.id === chapterId)!;
    const scene: Scene = {
      id, title: title.trim(),
      path: `stories/${storyId}/chapters/${chapterId}/scenes/${id}.md`,
      order: chapter.scenes.length, chapterId, storyId,
      blocks: [], draftState: 'in-progress',
      createdAt: now(), updatedAt: now(),
    };
    updateManifest(stories.map((s) =>
      s.id !== storyId ? s : {
        ...s,
        chapters: s.chapters.map((ch) =>
          ch.id !== chapterId ? ch : { ...ch, scenes: [...ch.scenes, scene] }
        ),
      }
    ));
    (window as any).api?.writeVault?.(scene.path, blocksToMarkdown(scene)).catch(() => {});
  }, [stories, updateManifest]);

  const handleReorderScenes = useCallback((storyId: string, chapterId: string, orderedIds: string[]) => {
    const updatedStories = stories.map((s) =>
      s.id !== storyId ? s : {
        ...s,
        chapters: s.chapters.map((ch) =>
          ch.id !== chapterId ? ch : {
            ...ch,
            scenes: orderedIds.map((id, idx) => {
              const scene = ch.scenes.find((sc) => sc.id === id)!;
              return { ...scene, order: idx };
            }),
          }
        ),
      }
    );
    updateManifest(updatedStories);
  }, [stories, updateManifest]);

  const handleSelectScene = useCallback((scene: Scene, chapter: Chapter, story: Story) => {
    setSelectedScene(scene);
    setSelectedChapter(chapter);
    setSelectedStory(story);
    setSelectedEntity(null);
  }, []);

  // Navigate to a scene from a backlink click by looking it up by path in the loaded stories
  const handleOpenSceneByPath = useCallback((scenePath: string) => {
    for (const story of stories) {
      for (const chapter of story.chapters) {
        const scene = chapter.scenes.find((sc) => sc.path === scenePath);
        if (scene) {
          handleSelectScene(scene, chapter, story);
          return;
        }
      }
    }
  }, [stories, handleSelectScene]);

  const handleSelectEntity = useCallback((entity: EntityEntry) => {
    setSelectedEntity(entity);
    setSelectedScene(null);
    setSelectedChapter(null);
    setSelectedStory(null);
  }, []);

  const handleSearchNavigate = useCallback((result: SearchResultItem) => {
    if (result.vault === 'story') {
      // Navigate to scene by docId
      for (const story of stories) {
        for (const chapter of story.chapters) {
          const scene = chapter.scenes.find((sc) => sc.id === result.docId);
          if (scene) {
            handleSelectScene(scene, chapter, story);
            setView('editor');
            return;
          }
        }
      }
    } else {
      // Navigate to entity by docId — look up in manifest entities
      (window as any).api?.entityRead(result.docId)
        .then((entry: EntityEntry | null) => {
          if (entry) {
            handleSelectEntity(entry);
            setView('editor');
          }
        })
        .catch(() => {});
    }
  }, [stories, handleSelectScene, handleSelectEntity]);

  const handleNavigateScene = useCallback((direction: 'prev' | 'next') => {
    if (!selectedStory || !selectedScene) return;
    const allScenes: { scene: Scene; chapter: Chapter }[] = [];
    for (const ch of [...selectedStory.chapters].sort((a, b) => a.order - b.order)) {
      for (const sc of [...ch.scenes].sort((a, b) => a.order - b.order)) {
        allScenes.push({ scene: sc, chapter: ch });
      }
    }
    const idx = allScenes.findIndex((s) => s.scene.id === selectedScene.id);
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx >= 0 && nextIdx < allScenes.length) {
      const { scene, chapter } = allScenes[nextIdx];
      handleSelectScene(scene, chapter, selectedStory);
    }
  }, [selectedStory, selectedScene, handleSelectScene]);

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

  return (
    <div className="desktop-shell">
      <UpdateBanner />
      <AppMenuBar view={view} onSetView={setView} onOpenSettings={() => setSettingsOpen(true)} onOpenHistory={() => setHistoryOpen(true)} onSearchNavigate={handleSearchNavigate} />
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => { setAppSettings(s); applyTheme(s.theme ?? 'system'); }}
        />
      )}
      {historyOpen && (
        <PromptHistoryPanel onClose={() => setHistoryOpen(false)} />
      )}
      {view === 'brainstorm' && (
        <BrainstormPage onClose={() => setView('editor')} enabled={agentFlags.brainstorm} />
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
      <div className="shell-left" style={{ width: layout.leftWidth }}>
        <LeftRail
          activeTab={layout.leftTab}
          onTabChange={(tab) => persistLayout({ ...layout, leftTab: tab })}
          stories={stories}
          selectedSceneId={selectedScene?.id ?? null}
          selectedEntityId={selectedEntity?.id ?? null}
          onSelectScene={handleSelectScene}
          onSelectEntity={handleSelectEntity}
          onCreateStory={createStory}
          onCreateChapter={createChapter}
          onCreateScene={createScene}
          onReorderScenes={handleReorderScenes}
          onOpenVaultPath={handleOpenSceneByPath}
        />
      </div>

      {/* Left resize handle */}
      <div
        className="shell-divider shell-divider-left"
        onMouseDown={(e) => startDrag('left', e)}
      />

      {/* Center + bottom */}
      <div className="shell-center-column">
        <div className="shell-editor">
          {selectedScene ? (
            <div className="shell-editor-beta-wrap">
              <BlockEditor
                key={selectedScene.id}
                scene={selectedScene}
                onBlocksChange={handleBlocksChange}
                onDraftStateChange={handleDraftStateChange}
                onEditorReady={handleEditorReady}
                onBetaReadRequest={handleBetaReadRequest}
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
          ) : selectedEntity ? (
            <EntityDetail
              key={selectedEntity.id}
              entity={selectedEntity}
              onClose={() => setSelectedEntity(null)}
              onUpdated={(updated) => setSelectedEntity(updated)}
              onDeleted={() => setSelectedEntity(null)}
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
        <BottomBar
          selectedScene={selectedScene}
          selectedChapter={selectedChapter}
          selectedStory={selectedStory}
          onNavigateScene={handleNavigateScene}
        />
      </div>

      {/* Right resize handle */}
      <div
        className="shell-divider shell-divider-right"
        onMouseDown={(e) => startDrag('right', e)}
      />

      {/* Right sidebar */}
      <div className="shell-right" style={{ width: layout.rightWidth }}>
        <RightSidebar
          activeTab={layout.rightTab}
          onTabChange={(tab) => persistLayout({ ...layout, rightTab: tab })}
          selectedScene={selectedScene}
          selectedChapter={selectedChapter}
          selectedStory={selectedStory}
          writingAssistantEnabled={agentFlags.writingAssistant}
          archiveEnabled={agentFlags.archive}
          scanIntervalSeconds={appSettings?.agents?.writingAssistant?.scanIntervalSeconds ?? 30}
          isPageFocused={view === 'editor'}
          onJumpToText={handleJumpToText}
          onInsertWikiLink={handleInsertWikiLink}
        />
      </div>
      </div>}{/* end shell-panels */}
      {budgetToast && (
        <div className="budget-toast" role="alert" aria-live="assertive">
          {budgetToast}
        </div>
      )}
    </div>
  );
}
