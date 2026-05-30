import { useState, useEffect, useRef, useCallback } from 'react';
import SceneHistory from './SceneHistory';
import { countWords, readingTimeMinutes } from './wordStats';
import { useSaveStatus } from './hooks/useSaveStatus';
import type { SaveStatus } from './hooks/useSaveStatus';
import './SceneEditor.css';

interface Props {
  sceneId: string;
  scenePath: string;
  initialContent?: string;
}

const SNAPSHOT_DEBOUNCE_MS = 500;
const STATS_DEBOUNCE_MS = 300;

function initialWordStats(text: string) {
  const words = countWords(text);
  return words > 0 ? { words, mins: readingTimeMinutes(words) } : null;
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') {
    return <span className="scene-autosave scene-autosave--saving">Saving…</span>;
  }
  if (status === 'unsaved') {
    return <span className="scene-autosave scene-autosave--unsaved">• Unsaved changes</span>;
  }
  return <span className="scene-autosave scene-autosave--saved">✓ Saved</span>;
}

export default function SceneEditor({ sceneId, scenePath, initialContent = '' }: Props) {
  const [content, setContent] = useState(initialContent);
  const [showHistory, setShowHistory] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [wordStats, setWordStats] = useState<{ words: number; mins: number } | null>(
    () => initialWordStats(initialContent)
  );
  // Snapshot name dialog state (SKY-157)
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');

  const { saveStatus, markDirty, markSaving, markSaved, markError } = useSaveStatus();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<string>(initialContent);
  // Always reflects the latest content so the beforeunload closure stays current.
  const contentRef = useRef<string>(initialContent);
  contentRef.current = content;

  const takeSnapshot = useCallback(
    async (text: string, label?: string) => {
      if (!label && text === lastSnapshotRef.current) return;
      markSaving();
      try {
        await window.api.snapshotSave(sceneId, text, ...(label ? [label] : []));
        lastSnapshotRef.current = text;
        markSaved();
      } catch {
        markError();
      }
    },
    [sceneId, markSaving, markSaved, markError]
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    markDirty();

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => takeSnapshot(val), SNAPSHOT_DEBOUNCE_MS);

    if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
    statsDebounceRef.current = setTimeout(() => {
      const words = countWords(val);
      setWordStats(words > 0 ? { words, mins: readingTimeMinutes(words) } : null);
    }, STATS_DEBOUNCE_MS);
  };

  // Flush pending snapshot synchronously when the window is about to close.
  useEffect(() => {
    const flush = () => {
      if (contentRef.current !== lastSnapshotRef.current) {
        window.api.snapshotSaveSync(sceneId, contentRef.current);
        lastSnapshotRef.current = contentRef.current;
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [sceneId]);

  // Flush snapshot on unmount (in-app navigation); clear pending debounces.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
      if (contentRef.current !== lastSnapshotRef.current) {
        window.api.snapshotSave(sceneId, contentRef.current).catch(() => {});
      }
    };
  }, [sceneId]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const dismissMenu = () => setContextMenu(null);

  const handleRestore = (restoredContent: string) => {
    setContent(restoredContent);
    lastSnapshotRef.current = restoredContent;
    setShowHistory(false);
  };

  const openNameDialog = () => {
    const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    setSnapshotName(`Snapshot — ${today}`);
    dismissMenu();
    setShowNameDialog(true);
  };

  const confirmNamedSnapshot = async () => {
    setShowNameDialog(false);
    const label = snapshotName.trim() || undefined;
    await takeSnapshot(content, label);
  };

  return (
    <div className="scene-editor-wrap" onClick={dismissMenu}>
      {contextMenu && (
        <div
          className="scene-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              dismissMenu();
              setShowHistory(true);
            }}
          >
            History
          </button>
          <button onClick={openNameDialog}>
            Save Snapshot…
          </button>
        </div>
      )}

      {showNameDialog && (
        <div className="scene-snapshot-dialog-overlay" onClick={() => setShowNameDialog(false)}>
          <div className="scene-snapshot-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="scene-snapshot-dialog-title">Save Snapshot</h3>
            <input
              className="scene-snapshot-dialog-input"
              type="text"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmNamedSnapshot();
                if (e.key === 'Escape') setShowNameDialog(false);
              }}
              autoFocus
              placeholder="Snapshot name…"
            />
            <div className="scene-snapshot-dialog-actions">
              <button className="btn-cancel" onClick={() => setShowNameDialog(false)}>Cancel</button>
              <button className="btn-save" onClick={confirmNamedSnapshot}>Save</button>
            </div>
          </div>
        </div>
      )}

      <div className="scene-editor-toolbar">
        <span className="scene-title">{scenePath}</span>
        <SaveStatusIndicator status={saveStatus} />
        {wordStats && (
          <span className="scene-wordcount">
            {wordStats.words} words · {wordStats.mins} min read
          </span>
        )}
        <button className="btn-history" onClick={() => setShowHistory(true)}>
          History
        </button>
      </div>

      <textarea
        className="scene-textarea"
        value={content}
        onChange={handleChange}
        onContextMenu={handleContextMenu}
        placeholder="Start writing your scene…"
        spellCheck
      />

      {showHistory && (
        <SceneHistory
          sceneId={sceneId}
          scenePath={scenePath}
          currentContent={content}
          onRestore={handleRestore}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
