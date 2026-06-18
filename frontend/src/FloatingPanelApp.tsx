import { useState, useEffect, useCallback } from 'react';
import { applyTheme } from './theme';
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

  // Load settings + apply theme on mount.
  useEffect(() => {
    window.api.settingsGet().then((s) => {
      setSettings(s);
      applyTheme(s.theme ?? 'dark');
    }).catch(() => {});
  }, []);

  // Load stories for panels that need them.
  useEffect(() => {
    if (!['stories', 'vault', 'progress'].includes(panelId)) return;
    (window.api.readManifest() as Promise<Manifest>).then((m) => {
      setStories(m?.stories ?? []);
    }).catch(() => {});
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
          />
        );
      case 'archive-continuity':
        return (
          <ContinuityPanel
            scene={null}
            enabled={settings?.agents?.archive?.enabled ?? true}
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
            selectedSceneId={null}
            onSelectScene={() => {}}
            onCreateStory={() => {}}
            onCreateChapter={() => {}}
            onCreateScene={() => {}}
            onReorderScenes={() => {}}
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
