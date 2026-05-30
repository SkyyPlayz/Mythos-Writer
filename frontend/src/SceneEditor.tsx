import { useState, useEffect, useRef, useCallback } from 'react';
import SceneHistory from './SceneHistory';
import './SceneEditor.css';

interface Props {
  sceneId: string;
  scenePath: string;
  initialContent?: string;
}

const SNAPSHOT_DEBOUNCE_MS = 5000;

export default function SceneEditor({ sceneId, scenePath, initialContent = '' }: Props) {
  const [content, setContent] = useState(initialContent);
  const [showHistory, setShowHistory] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  // Snapshot name dialog state
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotRef = useRef<string>(initialContent);

  const takeSnapshot = useCallback(
    async (text: string, label?: string) => {
      if (!label && text === lastSnapshotRef.current) return;
      try {
        await window.api.snapshotSave(sceneId, text, label);
        lastSnapshotRef.current = text;
        setLastSavedAt(new Date().toLocaleTimeString());
      } catch {
        // non-fatal
      }
    },
    [sceneId]
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => takeSnapshot(val), SNAPSHOT_DEBOUNCE_MS);
  };

  // Flush snapshot on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (content !== lastSnapshotRef.current) {
        window.api.snapshotSave(sceneId, content).catch(() => {});
      }
    };
  }, [sceneId, content]);

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
        <span className="scene-autosave">
          {lastSavedAt ? `Snapshot saved ${lastSavedAt}` : 'No snapshot yet'}
        </span>
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
