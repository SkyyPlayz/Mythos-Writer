import { useState, useRef } from 'react';
import type { EntityEntry } from './types';
import { useVaultStore } from './stores/vaultStore';
import { useUIStore } from './stores/uiStore';
import SearchBar from './SearchBar';
import ProjectSwitcher from './ProjectSwitcher';

export interface SearchResultItem {
  docId: string;
  vault: 'story' | 'notes';
  kind: string;
  title: string;
  snippet: string;
  rank: number;
}

interface Props {
  activeVaultRoot: string;
  onProjectSwitched: (vaultRoot: string) => void;
}

export default function AppMenuBar({ activeVaultRoot, onProjectSwitched }: Props) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);

  const view = useUIStore((s) => s.view);
  const writingMode = useUIStore((s) => s.writingMode);
  const setView = useUIStore((s) => s.setView);
  const setWritingMode = useUIStore((s) => s.setWritingMode);
  const openModal = useUIStore((s) => s.openModal);
  const activeStoryId = useVaultStore((s) => s.activeStoryId);

  const handleExportEpub = () => {
    if (!activeStoryId) {
      alert('Select a story first to export it as EPUB.');
      return;
    }
    (window as any).api?.exportEpub?.(activeStoryId)
      .then((res: { path: string | null; cancelled: boolean }) => {
        if (!res.cancelled && res.path) alert(`EPUB saved to:\n${res.path}`);
      })
      .catch((err: Error) => alert(`Export failed: ${err.message}`));
  };

  const handleExportDocx = () => {
    if (!activeStoryId) {
      alert('Select a story first to export it as DOCX.');
      return;
    }
    (window as any).api?.exportDocx?.(activeStoryId)
      .then((res: { path: string | null; cancelled: boolean }) => {
        if (!res.cancelled && res.path) alert(`DOCX saved to:\n${res.path}`);
      })
      .catch((err: Error) => alert(`Export failed: ${err.message}`));
  };

  const handleSearchNavigate = (result: SearchResultItem) => {
    const { stories, setActiveScene, setActiveEntity } = useVaultStore.getState();
    const uiSetView = useUIStore.getState().setView;
    if (result.vault === 'story') {
      for (const story of stories) {
        for (const chapter of story.chapters) {
          const scene = chapter.scenes.find((sc) => sc.id === result.docId);
          if (scene) {
            setActiveScene(story.id, chapter.id, scene.id);
            uiSetView('editor');
            return;
          }
        }
      }
    } else {
      window.api?.entityRead(result.docId)
        .then((entry: EntityEntry | null) => {
          if (entry) {
            setActiveEntity(entry);
            uiSetView('editor');
          }
        })
        .catch(() => {});
    }
  };

  return (
    <div className="app-menu-bar">
      <span className="app-menu-brand">Mythos</span>
      <ProjectSwitcher activeVaultRoot={activeVaultRoot} onSwitched={onProjectSwitched} />
      <div className="app-menu-items" ref={fileMenuRef}>
        <div className="app-menu-item">
          <button
            className="app-menu-item-trigger"
            aria-haspopup="menu"
            aria-controls="file-menu"
            aria-expanded={fileMenuOpen}
            onClick={() => setFileMenuOpen((o) => !o)}
            onBlur={(e) => {
              if (fileMenuRef.current && !fileMenuRef.current.contains(e.relatedTarget as Node)) {
                setFileMenuOpen(false);
              }
            }}
          >
            File
          </button>
          {fileMenuOpen && (
            <div id="file-menu" className="app-menu-dropdown" role="menu">
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); (window as any).api?.newStory?.(); }}>New Story</button>
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); (window as any).api?.openVault?.(); }}>Open Vault…</button>
              <div className="app-menu-separator" role="separator" />
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); handleExportEpub(); }}>Export EPUB…</button>
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); handleExportDocx(); }}>Export DOCX…</button>
              <div className="app-menu-separator" role="separator" />
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); openModal('history'); }}>Prompt History…</button>
              <div className="app-menu-separator" role="separator" />
              <button className="app-menu-dropdown-item" role="menuitem" onClick={() => { setFileMenuOpen(false); openModal('settings'); }}>Settings…</button>
            </div>
          )}
        </div>
      </div>
      <SearchBar onNavigate={handleSearchNavigate} />
      <div className="app-menu-view-toggle">
        <button className={`app-menu-view-btn${view === 'editor' ? ' active' : ''}`} onClick={() => setView('editor')} aria-pressed={view === 'editor'}>Editor</button>
        <button className={`app-menu-view-btn${view === 'brainstorm' ? ' active' : ''}`} onClick={() => setView('brainstorm')} aria-pressed={view === 'brainstorm'}>Brainstorm</button>
        <button className={`app-menu-view-btn${view === 'kanban' ? ' active' : ''}`} onClick={() => setView('kanban')} aria-pressed={view === 'kanban'}>Board</button>
        <button className={`app-menu-view-btn${view === 'graph' ? ' active' : ''}`} onClick={() => setView('graph')} aria-pressed={view === 'graph'}>Graph</button>
      </div>
      <div className="writing-mode-selector" aria-label="Writing mode">
        <button className={`writing-mode-btn${writingMode === 'normal' ? ' active' : ''}`} onClick={() => setWritingMode('normal')} aria-pressed={writingMode === 'normal'} title="Normal mode — full editor + sidebars (Ctrl+Shift+N)">N</button>
        <button className={`writing-mode-btn${writingMode === 'focus' ? ' active' : ''}`} onClick={() => setWritingMode('focus')} aria-pressed={writingMode === 'focus'} title="Focus mode — distraction-free (Ctrl+Shift+F)">F</button>
        {writingMode === 'focus' && (
          <button className="writing-mode-prefs-btn" onClick={() => openModal('focusModePrefs')} title="Configure Focus mode panels" aria-label="Focus mode preferences">⚙</button>
        )}
        <button className={`writing-mode-btn${writingMode === 'edit' ? ' active' : ''}`} onClick={() => setWritingMode('edit')} aria-pressed={writingMode === 'edit'} title="Edit mode — review with Writing Assistant + comments (Ctrl+Shift+E)">E</button>
      </div>
      <button className="app-menu-gear-btn" onClick={() => openModal('settings')} aria-label="Open settings" title="Settings">⚙</button>
    </div>
  );
}
