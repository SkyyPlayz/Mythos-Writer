import { useState, useEffect, useCallback } from 'react';
import { applyTheme } from './theme';
import { DEFAULTS } from './components/SettingsPanel/settingsPanelTypes';
import type { Story, Manifest } from './types';
import WritingAssistantPanel from './WritingAssistantPanel';
import ContinuityPanel from './ContinuityPanel';
import ScenePreviewPanel from './ScenePreviewPanel';
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import VaultBrowser from './components/VaultBrowser';
import SuggestionReview from './SuggestionReview';
import ProgressDashboard from './ProgressDashboard';
import VaultGraphView from './VaultGraphView';
import StoryTimeline from './StoryTimeline';
import './FloatingPanelApp.css';

// ── Constants ──────────────────────────────────────────────────────────────────

const PANEL_LABELS: Record<string, string> = {
  'writing-assistant': 'Writing Assistant',
  'archive-continuity': 'Continuity',
  'scene-preview': 'Scene Preview',
  stories: 'Story Navigator',
  entities: 'Entity Browser',
  vault: 'Vault Browser',
  'vault-graph': 'Graph',
  review: 'Suggestion Review',
  progress: 'Writing Goals',
  timeline: 'Timeline',
};

// ── Props ──────────────────────────────────────────────────────────────────────

interface FloatingPanelAppProps {
  panelId: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function FloatingPanelApp({ panelId }: FloatingPanelAppProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [stories, setStories] = useState<Story[]>([]);
  // SKY-2966: track selected scene so the navigator highlights the active scene
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  // Load settings + apply theme on mount.
  useEffect(() => {
    window.api.settingsGet().then((s) => {
      setSettings(s);
      applyTheme(s.theme ?? 'dark');
    }).catch((err) => {
      console.error('[FloatingPanelApp] settings load failed, using defaults:', err);
      setSettings(DEFAULTS);
      applyTheme(DEFAULTS.theme ?? 'dark');
    });
  }, []);

  // Refresh the manifest from disk into local state.
  const refreshStories = useCallback(() => {
    (window.api.readManifest() as Promise<Manifest>).then((m) => {
      setStories(m?.stories ?? []);
    }).catch(() => {});
  }, []);

  // Load stories for panels that need them, and subscribe to manifest changes
  // pushed from the main window (SKY-2966).
  useEffect(() => {
    if (!['stories', 'vault', 'progress'].includes(panelId)) return;
    refreshStories();
    const unsub = window.api.onNavigatorManifestChanged?.(() => refreshStories());
    return () => unsub?.();
  }, [panelId, refreshStories]);

  // SKY-2966: Sync the selected scene indicator from the main window.
  useEffect(() => {
    if (panelId !== 'stories') return;
    const unsub = window.api.onNavigatorSceneSynced?.(({ sceneId }) => {
      setSelectedSceneId(sceneId);
    });
    return () => unsub?.();
  }, [panelId]);

  // Listen for pin-changed events from main process.
  useEffect(() => {
    const handler = (_: unknown, data: { panelId: string; alwaysOnTop: boolean }) => {
      if (data.panelId === panelId) setAlwaysOnTop(data.alwaysOnTop);
    };
    (window as unknown as { ipcRenderer?: { on: (ch: string, h: typeof handler) => void; removeListener: (ch: string, h: typeof handler) => void } }).ipcRenderer?.on('panel:float-pin-changed', handler);
    return () => {
      (window as unknown as { ipcRenderer?: { removeListener: (ch: string, h: typeof handler) => void } }).ipcRenderer?.removeListener('panel:float-pin-changed', handler);
    };
  }, [panelId]);

  // SKY-2966: Story navigator callbacks that communicate across windows.

  const handleNavSelectScene = useCallback((scene: { id: string }) => {
    setSelectedSceneId(scene.id);
    window.api.navigatorSelectScene?.(scene.id).catch(() => {});
  }, []);

  const handleNavCreateStory = useCallback(async () => {
    const title = window.prompt('Story title:');
    if (!title?.trim()) return;
    try {
      const m = await (window.api.readManifest() as Promise<Manifest>);
      const id = crypto.randomUUID();
      const nowStr = new Date().toISOString();
      const story: Story = {
        id, title: title.trim(), path: `stories/${id}`,
        chapters: [], createdAt: nowStr, updatedAt: nowStr,
      };
      const updated = { ...m, stories: [...(m?.stories ?? []), story] };
      await window.api.writeManifest(updated);
      setStories(updated.stories);
      window.api.navigatorReportManifest?.().catch(() => {});
    } catch (e) {
      console.error('Failed to create story:', e);
    }
  }, []);

  const handleNavCreateChapter = useCallback(async (storyId: string) => {
    const title = window.prompt('Chapter title:');
    if (!title?.trim()) return;
    try {
      const m = await (window.api.readManifest() as Promise<Manifest>);
      const storyData = m?.stories?.find((s) => s.id === storyId);
      if (!storyData) return;
      const id = crypto.randomUUID();
      const nowStr = new Date().toISOString();
      const chapter = {
        id, title: title.trim(),
        path: `stories/${storyId}/chapters/${id}`,
        order: storyData.chapters.length,
        scenes: [], createdAt: nowStr, updatedAt: nowStr,
      };
      const updatedStories = m.stories.map((s) =>
        s.id !== storyId ? s : { ...s, chapters: [...s.chapters, chapter] }
      );
      await window.api.writeManifest({ ...m, stories: updatedStories });
      setStories(updatedStories);
      window.api.navigatorReportManifest?.().catch(() => {});
    } catch (e) {
      console.error('Failed to create chapter:', e);
    }
  }, []);

  const handleNavCreateScene = useCallback(async (storyId: string, chapterId: string) => {
    const title = window.prompt('Scene title:');
    if (!title?.trim()) return;
    try {
      const m = await (window.api.readManifest() as Promise<Manifest>);
      const storyData = m?.stories?.find((s) => s.id === storyId);
      const chapterData = storyData?.chapters.find((c) => c.id === chapterId);
      if (!chapterData) return;
      const id = crypto.randomUUID();
      const nowStr = new Date().toISOString();
      const scene = {
        id, title: title.trim(),
        path: `stories/${storyId}/chapters/${chapterId}/scenes/${id}.md`,
        order: chapterData.scenes.length,
        chapterId, storyId,
        blocks: [] as never[],
        draftState: 'in-progress' as const,
        createdAt: nowStr, updatedAt: nowStr,
      };
      // Write the scene file first; only record the manifest entry after the
      // file exists on disk. Reversed order can leave an orphaned manifest entry
      // if the file write fails or is interrupted (GH #731).
      await window.api.writeVault?.(
        scene.path,
        `---\nid: ${id}\ntitle: "${title.trim().replace(/"/g, '\\"')}"\ndraftState: in-progress\nupdatedAt: ${nowStr}\n---\n\n`,
      );
      const updatedStories = m.stories.map((s) =>
        s.id !== storyId ? s : {
          ...s,
          chapters: s.chapters.map((ch) =>
            ch.id !== chapterId ? ch : { ...ch, scenes: [...ch.scenes, scene] }
          ),
        }
      );
      await window.api.writeManifest({ ...m, stories: updatedStories });
      setStories(updatedStories);
      window.api.navigatorReportManifest?.().catch(() => {});
    } catch (e) {
      console.error('Failed to create scene:', e);
    }
  }, []);

  const handleNavReorderScenes = useCallback(async (storyId: string, chapterId: string, orderedIds: string[]) => {
    try {
      const m = await (window.api.readManifest() as Promise<Manifest>);
      const updatedStories = m.stories.map((s) =>
        s.id !== storyId ? s : {
          ...s,
          chapters: s.chapters.map((ch) => {
            if (ch.id !== chapterId) return ch;
            const sceneMap = new Map(ch.scenes.map((sc) => [sc.id, sc]));
            return {
              ...ch,
              scenes: orderedIds.map((id, idx) => ({ ...(sceneMap.get(id) ?? ch.scenes[idx]), order: idx })),
            };
          }),
        }
      );
      await window.api.writeManifest({ ...m, stories: updatedStories });
      setStories(updatedStories);
      window.api.navigatorReportManifest?.().catch(() => {});
    } catch (e) {
      console.error('Failed to reorder scenes:', e);
    }
  }, []);

  const handleDockBack = useCallback(() => {
    window.api.panelFloatDockBack?.(panelId).catch(() => {});
  }, [panelId]);

  const handleTogglePin = useCallback(() => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    window.api.panelFloatSetPin?.(panelId, next).catch(() => {});
  }, [panelId, alwaysOnTop]);

  const handleClose = useCallback(() => {
    window.api.panelFloatDockBack?.(panelId).catch(() => {});
  }, [panelId]);

  const label = PANEL_LABELS[panelId] ?? panelId;

  const renderContent = () => {
    switch (panelId) {
      case 'writing-assistant':
        return (
          <WritingAssistantPanel
            scene={null}
            enabled={settings?.agents?.writingAssistant?.enabled ?? true}
            scanIntervalSeconds={settings?.agents?.writingAssistant?.scanIntervalSeconds ?? 30}
            waScanInterval={settings?.waScanInterval}
            cadenceTrigger={settings?.agents?.writingAssistant?.cadenceTrigger}
            idleHeartbeatConstantInterval={settings?.agents?.writingAssistant?.idleHeartbeatConstantInterval}
            idleDebounceSeconds={settings?.agents?.writingAssistant?.idleDebounceSeconds}
            isActive={true}
            isPageFocused={true}
            onJumpToText={() => {}}
            ttsSettings={settings?.tts}
          />
        );
      case 'archive-continuity':
        return (
          <ContinuityPanel
            scene={null}
            enabled={(settings?.agents?.archive?.enabled ?? true) && (settings?.archiveContinuityEnabled ?? true)}
            archiveScanScope={settings?.archiveScanScope ?? 'active_scene'}
            archiveStoryEditConsentGiven={settings?.archiveStoryEditConsentGiven ?? false}
            onCountChange={() => {}}
            onOpenSettings={() => {}}
          />
        );
      case 'scene-preview':
        return <ScenePreviewPanel scene={null} chapter={null} story={null} />;
      case 'stories':
        return (
          <StoryNavigator
            stories={stories}
            selectedSceneId={selectedSceneId}
            onSelectScene={handleNavSelectScene}
            onCreateStory={handleNavCreateStory}
            onCreateChapter={handleNavCreateChapter}
            onCreateScene={handleNavCreateScene}
            onReorderScenes={handleNavReorderScenes}
            showTemplateCta={false}
            onTemplateCtaClick={() => {}}
          />
        );
      case 'entities':
        return (
          <EntityBrowser
            onSelectEntity={() => {}}
            selectedEntityId={null}
            onEntityCreated={() => {}}
          />
        );
      case 'vault':
        return (
          <VaultBrowser
            stories={stories}
            selectedSceneId={null}
            onSelectScene={() => {}}
            onCreateStory={() => {}}
            onCreateChapter={() => {}}
            onCreateScene={() => {}}
            onOpenFile={() => {}}
            onContextChange={() => {}}
            onExport={() => {}}
            journalModeEnabled={settings?.journalMode?.enabled ?? false}
          />
        );
      case 'vault-graph':
        return <VaultGraphView onOpenNote={() => {}} />;
      case 'review':
        return <SuggestionReview onOpenVaultPath={() => {}} />;
      case 'progress':
        return <ProgressDashboard stories={stories} />;
      case 'timeline':
        return <StoryTimeline story={null} />;
      default:
        return <div className="fpa-unknown-panel">Unknown panel: {panelId}</div>;
    }
  };

  return (
    <div className="fpa-root">
      {/* Custom title bar — draggable except on control buttons */}
      <div className="fpa-titlebar" aria-label={`${label} panel controls`}>
        <span className="fpa-titlebar-grip" title="Drag to move window" aria-hidden="true">⠿</span>
        <span className="fpa-titlebar-label">{label}</span>
        <div className="fpa-titlebar-controls">
          <button
            className={`fpa-ctrl-btn${alwaysOnTop ? ' fpa-ctrl-btn--active' : ''}`}
            title={alwaysOnTop ? 'Unpin (always on top)' : 'Pin on top'}
            aria-label={alwaysOnTop ? 'Unpin — disable always on top' : 'Pin on top'}
            aria-pressed={alwaysOnTop}
            onClick={handleTogglePin}
          >
            📌
          </button>
          <button
            className="fpa-ctrl-btn"
            title="Dock back to sidebar"
            aria-label="Dock back to sidebar"
            onClick={handleDockBack}
          >
            ↩
          </button>
          <button
            className="fpa-ctrl-btn fpa-ctrl-btn--close"
            title="Close panel"
            aria-label="Close panel"
            onClick={handleClose}
          >
            ×
          </button>
        </div>
      </div>

      {/* Panel content */}
      <div className="fpa-body">
        {settings !== null ? renderContent() : null}
      </div>
    </div>
  );
}
