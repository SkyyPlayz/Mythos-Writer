import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { Scene, Story, Chapter } from './types';
import WritingAssistantPanel from './WritingAssistantPanel';
import VaultAgentPanel from './VaultAgentPanel';
import ArchivePanel from './ArchivePanel';
import GettingStartedPanel from './components/GettingStartedPanel/GettingStartedPanel';
import DraftHistoryPanel from './DraftHistoryPanel';
import { isGettingStartedVisible, type GettingStartedItemId, type GettingStartedProgress } from './gettingStartedReducer';
import './RightSidebar.css';

type Tab = 'notes' | 'properties' | 'ai' | 'outline';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  selectedScene: Scene | null;
  selectedChapter: Chapter | null;
  selectedStory: Story | null;
  writingAssistantEnabled?: boolean;
  archiveEnabled?: boolean;
  scanIntervalSeconds?: number;
  waScanInterval?: number | 'on-save' | 'manual';
  isPageFocused?: boolean;
  onJumpToText?: (text: string) => void;
  onInsertWikiLink?: (link: string, anchorText: string) => void;
  onWikiLinkSuggestionsChange?: (suggestions: Array<{ id: string; anchorText: string; wikiLink: string }>) => void;
  onSelectScene?: (scene: Scene, chapter: Chapter) => void;
  gettingStartedProgress?: GettingStartedProgress | null;
  onGettingStartedAction?: (itemId: GettingStartedItemId) => void;
  onDismissGettingStarted?: () => void;
  onToggleGsCollapsed?: () => void;
  currentSceneContent?: string;
  onDraftRestore?: (content: string) => void;
}

const SIDEBAR_TABS: { id: Tab; label: string }[] = [
  { id: 'notes', label: 'Notes' },
  { id: 'properties', label: 'Properties' },
  { id: 'ai', label: 'Assistant' },
  { id: 'outline', label: 'Outline' },
];

const NOTES_SAVE_DEBOUNCE_MS = 600;

function NotesPanel({ scene }: { scene: Scene | null }) {
  const [note, setNote] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedSceneIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scene) {
      setNote('');
      loadedSceneIdRef.current = null;
      return;
    }
    if (scene.id === loadedSceneIdRef.current) return;
    loadedSceneIdRef.current = scene.id;
    setNote('');
    window.api.notesGet?.(scene.id).then((res) => {
      if (loadedSceneIdRef.current === scene.id) setNote(res.content);
    }).catch(() => {});
  }, [scene]);

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const persistNote = (sceneId: string, value: string) => {
    window.api.notesSet?.(sceneId, value).catch(() => {});
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNote(value);
    if (!scene) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistNote(scene.id, value), NOTES_SAVE_DEBOUNCE_MS);
  };

  const handleBlur = () => {
    if (!scene) return;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    persistNote(scene.id, note);
  };

  if (!scene) {
    return (
      <div className="sidebar-empty">
        <div className="sidebar-empty-icon">📝</div>
        <p>Select a scene to add notes.</p>
        <p className="sidebar-empty-sub">Notes are private workspace annotations — they won&apos;t appear in your exported story.</p>
      </div>
    );
  }

  return (
    <div className="sidebar-notes">
      <textarea
        className="notes-textarea"
        value={note}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Scene notes, reminders, loose ideas…"
        aria-label="Scene notes"
      />
    </div>
  );
}

function PropertiesPanel({
  scene,
  chapter,
  story,
}: {
  scene: Scene | null;
  chapter: Chapter | null;
  story: Story | null;
}) {
  if (!scene || !chapter || !story) {
    return (
      <div className="sidebar-empty">
        <div className="sidebar-empty-icon">🏷️</div>
        <p>Select a scene to see its properties.</p>
        <p className="sidebar-empty-sub">Word count, draft state, creation date, and more.</p>
      </div>
    );
  }

  const wordCount = scene.blocks
    .map((b) => b.content.trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);

  const blocksByType = scene.blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.type] = (acc[b.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="sidebar-properties">
      <div className="prop-group">
        <div className="prop-label">Scene</div>
        <div className="prop-value prop-title">{scene.title}</div>
      </div>
      <div className="prop-row">
        <div className="prop-group">
          <div className="prop-label">Story</div>
          <div className="prop-value">{story.title}</div>
        </div>
        <div className="prop-group">
          <div className="prop-label">Chapter</div>
          <div className="prop-value">{chapter.title}</div>
        </div>
      </div>
      <div className="prop-row">
        <div className="prop-group">
          <div className="prop-label">Words</div>
          <div className="prop-value prop-stat">{wordCount.toLocaleString()}</div>
        </div>
        <div className="prop-group">
          <div className="prop-label">Blocks</div>
          <div className="prop-value prop-stat">{scene.blocks.length}</div>
        </div>
      </div>
      <div className="prop-group">
        <div className="prop-label">Draft state</div>
        <div className={`prop-value prop-draft draft-${scene.draftState ?? 'in-progress'}`}>
          {scene.draftState ?? 'in-progress'}
        </div>
      </div>
      {Object.keys(blocksByType).length > 0 && (
        <div className="prop-group">
          <div className="prop-label">Block breakdown</div>
          <div className="prop-breakdown">
            {Object.entries(blocksByType).map(([type, count]) => (
              <span key={type} className="prop-breakdown-item">
                {type}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="prop-group">
        <div className="prop-label">Last updated</div>
        <div className="prop-value prop-date">
          {new Date(scene.updatedAt).toLocaleString()}
        </div>
      </div>
      <div className="prop-group">
        <div className="prop-label">Created</div>
        <div className="prop-value prop-date">
          {new Date(scene.createdAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

type AiSubTab = 'writing' | 'vault' | 'archive';

const AI_SUB_TABS: { id: AiSubTab; label: string }[] = [
  { id: 'writing', label: 'Writing' },
  { id: 'vault', label: 'Vault' },
  { id: 'archive', label: 'Archive' },
];

function AiPanel({
  scene,
  writingAssistantEnabled = true,
  archiveEnabled = true,
  scanIntervalSeconds = 30,
  waScanInterval,
  isPageFocused = true,
  onJumpToText = () => {},
  onInsertWikiLink = () => {},
  onWikiLinkSuggestionsChange,
}: {
  scene: Scene | null;
  writingAssistantEnabled?: boolean;
  archiveEnabled?: boolean;
  scanIntervalSeconds?: number;
  waScanInterval?: number | 'on-save' | 'manual';
  isPageFocused?: boolean;
  onJumpToText?: (text: string) => void;
  onInsertWikiLink?: (link: string, anchorText: string) => void;
  onWikiLinkSuggestionsChange?: (suggestions: Array<{ id: string; anchorText: string; wikiLink: string }>) => void;
}) {
  const [subTab, setSubTab] = useState<AiSubTab>('writing');
  const subTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleSubTabKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
    let nextIdx = idx;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextIdx = (idx + 1) % AI_SUB_TABS.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextIdx = (idx - 1 + AI_SUB_TABS.length) % AI_SUB_TABS.length;
    } else {
      return;
    }
    setSubTab(AI_SUB_TABS[nextIdx].id);
    subTabRefs.current[nextIdx]?.focus();
  }, []);

  return (
    <div className="ai-panel">
      <div className="ai-subtabs" role="tablist" aria-label="AI assistant panels">
        {AI_SUB_TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { subTabRefs.current[i] = el; }}
            id={`ai-subtab-${t.id}`}
            role="tab"
            aria-selected={subTab === t.id}
            aria-controls="ai-subtabpanel"
            tabIndex={subTab === t.id ? 0 : -1}
            className={`ai-subtab${subTab === t.id ? ' active' : ''}`}
            onClick={() => setSubTab(t.id)}
            onKeyDown={(e) => handleSubTabKeyDown(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="ai-subtabpanel" role="tabpanel" aria-labelledby={`ai-subtab-${subTab}`}>
        {subTab === 'writing' && (
          <WritingAssistantPanel
            scene={scene}
            enabled={writingAssistantEnabled}
            scanIntervalSeconds={scanIntervalSeconds}
            waScanInterval={waScanInterval}
            isActive={isPageFocused}
          />
        )}
        {subTab === 'vault' && <VaultAgentPanel scene={scene} enabled={archiveEnabled} />}
        {subTab === 'archive' && (
          <ArchivePanel
            scene={scene}
            enabled={archiveEnabled}
            onJumpToText={onJumpToText}
            onInsertWikiLink={onInsertWikiLink}
            onWikiLinkSuggestionsChange={onWikiLinkSuggestionsChange}
          />
        )}
      </div>
    </div>
  );
}

function OutlineSidebarPanel({
  story,
  selectedChapterId,
  selectedSceneId,
  onSelectScene,
}: {
  story: Story | null;
  selectedChapterId: string | null;
  selectedSceneId: string | null;
  onSelectScene?: (scene: Scene, chapter: Chapter) => void;
}) {
  const sortedChapters = useMemo(
    () => (story ? [...story.chapters].sort((a, b) => a.order - b.order) : []),
    [story],
  );
  const activeSceneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeSceneRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedSceneId]);

  if (!story) {
    return (
      <div className="sidebar-empty">
        <div className="sidebar-empty-icon">📖</div>
        <p>Select a story to see its outline.</p>
      </div>
    );
  }

  return (
    <div className="outline-sidebar-panel">
      <div className="outline-sidebar-story-title">{story.title}</div>
      {sortedChapters.length === 0 ? (
        <div className="outline-sidebar-empty">No chapters yet.</div>
      ) : (
        sortedChapters.map((chapter) => {
          const isActiveChapter = chapter.id === selectedChapterId;
          const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);
          return (
            <div
              key={chapter.id}
              className={`outline-sidebar-chapter${isActiveChapter ? ' active-chapter' : ''}`}
            >
              <div className="outline-sidebar-chapter-title">{chapter.title}</div>
              <div className="outline-sidebar-scene-list">
                {sortedScenes.length === 0 ? (
                  <div className="outline-sidebar-no-scenes">No scenes</div>
                ) : (
                  sortedScenes.map((scene) => {
                    const isActive = scene.id === selectedSceneId;
                    return (
                      <div
                        key={scene.id}
                        ref={isActive ? activeSceneRef : null}
                        className={`outline-sidebar-scene${isActive ? ' active-scene' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => onSelectScene?.(scene, chapter)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); onSelectScene?.(scene, chapter); }
                        }}
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
  );
}

export default function RightSidebar({
  activeTab,
  onTabChange,
  selectedScene,
  selectedChapter,
  selectedStory,
  writingAssistantEnabled = true,
  archiveEnabled = true,
  scanIntervalSeconds = 30,
  waScanInterval,
  isPageFocused = true,
  onJumpToText,
  onInsertWikiLink,
  onWikiLinkSuggestionsChange,
  onSelectScene,
  gettingStartedProgress,
  onGettingStartedAction,
  onDismissGettingStarted,
  onToggleGsCollapsed,
  currentSceneContent,
  onDraftRestore,
}: Props) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
    let nextIdx = idx;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextIdx = (idx + 1) % SIDEBAR_TABS.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextIdx = (idx - 1 + SIDEBAR_TABS.length) % SIDEBAR_TABS.length;
    } else {
      return;
    }
    onTabChange(SIDEBAR_TABS[nextIdx].id);
    tabRefs.current[nextIdx]?.focus();
  }, [onTabChange]);

  return (
    <div className="right-sidebar">
      {isGettingStartedVisible(gettingStartedProgress) && gettingStartedProgress && onGettingStartedAction && onDismissGettingStarted && onToggleGsCollapsed && (
        <GettingStartedPanel
          progress={gettingStartedProgress}
          onAction={onGettingStartedAction}
          onDismiss={onDismissGettingStarted}
          onToggleCollapse={onToggleGsCollapsed}
        />
      )}
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar panels">
        {SIDEBAR_TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[i] = el; }}
            id={`rightsidebar-tab-${t.id}`}
            role="tab"
            aria-selected={activeTab === t.id}
            aria-controls="rightsidebar-tabpanel"
            tabIndex={activeTab === t.id ? 0 : -1}
            className={`sidebar-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => onTabChange(t.id)}
            onKeyDown={(e) => handleTabKeyDown(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id="rightsidebar-tabpanel"
        role="tabpanel"
        className="sidebar-content"
        aria-labelledby={`rightsidebar-tab-${activeTab}`}
      >
        {activeTab === 'notes' && <NotesPanel scene={selectedScene} />}
        {activeTab === 'properties' && (
          <>
            <PropertiesPanel scene={selectedScene} chapter={selectedChapter} story={selectedStory} />
            {selectedScene && currentSceneContent !== undefined && onDraftRestore && (
              <DraftHistoryPanel
                sceneId={selectedScene.id}
                currentContent={currentSceneContent}
                onRestore={onDraftRestore}
              />
            )}
          </>
        )}
        {activeTab === 'ai' && (
          <AiPanel
            scene={selectedScene}
            writingAssistantEnabled={writingAssistantEnabled}
            archiveEnabled={archiveEnabled}
            scanIntervalSeconds={scanIntervalSeconds}
            waScanInterval={waScanInterval}
            isPageFocused={isPageFocused}
            onJumpToText={onJumpToText}
            onInsertWikiLink={onInsertWikiLink}
            onWikiLinkSuggestionsChange={onWikiLinkSuggestionsChange}
          />
        )}
        {activeTab === 'outline' && (
          <OutlineSidebarPanel
            story={selectedStory}
            selectedChapterId={selectedChapter?.id ?? null}
            selectedSceneId={selectedScene?.id ?? null}
            onSelectScene={onSelectScene}
          />
        )}
      </div>
    </div>
  );
}
