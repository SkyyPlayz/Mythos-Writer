import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Story, Scene, Chapter } from '../../types';
import type { ExportScope } from '../../ExportDialog';
import StoryContextMenu from './StoryContextMenu';
import { useVaultFiles } from './useVaultFiles';
import { useTreeState } from './useTreeState';
import {
  buildTree,
  flattenTree,
  isStoryInternalTreeItem,
  mapUuidNamesToTitles,
} from './treeUtils';
import type { FlatRow, VaultListItem } from './treeUtils';
import VirtualTree from './VirtualTree';
import ContextMenu from './ContextMenu';
import { validateRenameName } from './renameUtils';
import NoteTemplateDialog from '../NoteTemplateDialog';
import TagPane from '../TagPane';
import './VaultBrowser.css';

// ─── Filters ───
// SKY-9: the Notes Vault is now its own IPC root, so we no longer need to
// strip the Story Vault's `Manuscript/` prefix here. We still hide internal
// bookkeeping (manifest backups, versions/snapshots/git) so they don't show
// up in the tree.

const INTERNAL_PREFIXES = ['.versions', '.snapshots', '.git'];
const INTERNAL_FILES = new Set(['manifest.json', 'manifest.json.bak']);

function isNotesItem(item: { path: string; name: string; isDirectory: boolean }): boolean {
  if (item.name.startsWith('.')) return false;
  for (const prefix of INTERNAL_PREFIXES) {
    if (item.path === prefix || item.path.startsWith(prefix + '/')) return false;
  }
  // W0.1 (GAP #1): story-vault internals must never render in the Notes tree
  // — scene-UUID folders, manifest bookkeeping, and children of dot-dirs
  // (which buildTree would otherwise promote to root rows). The main process
  // filters these at the notesVault:list source; this is defense in depth.
  if (INTERNAL_FILES.has(item.path)) return false;
  if (isStoryInternalTreeItem(item)) return false;
  return true;
}

// ─── Inline scene rename input (Story Vault) ───

function SceneRenameInput({
  value,
  error,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  error: string | null;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const cancelledRef = useRef(false);
  return (
    <span className="vb-rename-wrap">
      <input
        className="vb-rename-input"
        autoFocus
        value={value}
        aria-label="Rename scene"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); cancelledRef.current = false; onCommit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; onCancel(); }
        }}
        onBlur={() => { if (!cancelledRef.current) onCommit(); }}
      />
      {error && <span className="vb-rename-error" role="alert">{error}</span>}
    </span>
  );
}

// ─── Story Vault (manifest-based) ───

interface CT{x:number;y:number;kind:'story'|'chapter'|'scene';storyId:string;chapterId?:string;sceneId?:string;}
interface StoryVaultProps {
  stories: Story[];
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onRenameScene: (sceneId: string, title: string) => Promise<void>;
  onExport?: (scope: ExportScope) => void;
}

function StoryVault({
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onRenameScene,
  onExport,
}: StoryVaultProps) {
  const [expandedStories, setExpandedStories] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('vb-expanded:story-stories');
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /**/ }
    return new Set();
  });
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('vb-expanded:story-chapters');
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /**/ }
    return new Set();
  });

  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [ct, setCt] = useState<CT | null>(null);
  const selectClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSceneSelect = useCallback(() => {
    if (selectClickTimerRef.current) {
      clearTimeout(selectClickTimerRef.current);
      selectClickTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (stories.length === 1 && expandedStories.size === 0) {
      setExpandedStories(new Set([stories[0].id]));
    }
  }, [stories.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStory = (id: string) => {
    setExpandedStories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem('vb-expanded:story-stories', JSON.stringify([...next])); } catch { /**/ }
      return next;
    });
  };

  const toggleChapter = (id: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem('vb-expanded:story-chapters', JSON.stringify([...next])); } catch { /**/ }
      return next;
    });
  };

  const startRenameScene = useCallback((scene: Scene) => {
    cancelPendingSceneSelect();
    setEditingSceneId(scene.id);
    setEditValue(scene.title);
    setEditError(null);
  }, [cancelPendingSceneSelect]);

  const selectSceneFromClick = useCallback((scene: Scene, chapter: Chapter, story: Story) => {
    cancelPendingSceneSelect();
    selectClickTimerRef.current = setTimeout(() => {
      selectClickTimerRef.current = null;
      onSelectScene(scene, chapter, story);
    }, 350);
  }, [cancelPendingSceneSelect, onSelectScene]);

  useEffect(() => cancelPendingSceneSelect, [cancelPendingSceneSelect]);

  const commitRenameScene = useCallback(async () => {
    if (!editingSceneId) return;
    const err = validateRenameName(editValue);
    if (err) { setEditError(err); return; }
    try {
      await onRenameScene(editingSceneId, editValue.trim());
      setEditingSceneId(null);
      setEditError(null);
    } catch (e) {
      setEditError((e as Error).message || 'Rename failed');
    }
  }, [editingSceneId, editValue, onRenameScene]);

  const cancelRenameScene = useCallback(() => {
    setEditingSceneId(null);
    setEditError(null);
  }, []);

  return (
    <div className="vb-story-vault" data-testid="vb-story-vault">
      <div className="vb-section-header">
        <span className="vb-section-label">Story Vault</span>
        <button
          className="vb-section-add"
          onClick={onCreateStory}
          title="New Story"
          aria-label="New Story"
        >
          +
        </button>
      </div>
      <div className="vb-story-content" role="tree" aria-label="Story Vault">
        {stories.length === 0 ? (
          <div className="vb-story-empty" data-testid="vb-story-empty">
            <div className="vb-story-empty-icon" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <p className="vb-story-empty-heading">Create your first story</p>
            <p className="vb-story-empty-sub">Create a story, add chapters and scenes, and start writing.</p>
            <button
              className="vb-story-empty-cta"
              data-testid="vb-story-empty-cta"
              onClick={onCreateStory}
            >
              New Story
            </button>
            <p className="vb-story-empty-footer">Or use the + button above</p>
          </div>
        ) : (
          stories.map((story) => {
            const storyExp = expandedStories.has(story.id);
            return (
              <div key={story.id} role="none">
                <div className="vb-item-row" onContextMenu={(e)=>{e.preventDefault();setCt({x:e.clientX,y:e.clientY,kind:'story',storyId:story.id});}}>
                  <button
                    className="vb-tree-toggle"
                    onClick={() => toggleStory(story.id)}
                    role="treeitem"
                    aria-level={1}
                    aria-expanded={storyExp}
                  >
                    <span className="vb-chevron" aria-hidden="true">{storyExp ? '▾' : '▸'}</span>
                    <span className="vb-icon" aria-hidden="true">📖</span>
                    <span className="vb-name">{story.title}</span>
                  </button>
                  <button
                    className="vb-inline-add"
                    onClick={() => onCreateChapter(story.id)}
                    title="New Chapter"
                    aria-label={`New chapter in ${story.title}`}
                  >
                    +
                  </button>
                </div>
                {storyExp && (
                  <div role="group">
                    {[...story.chapters]
                      .sort((a, b) => a.order - b.order)
                      .map((chapter) => {
                        const chapterExp = expandedChapters.has(chapter.id);
                        return (
                          <div key={chapter.id} role="none">
                            <div className="vb-item-row" onContextMenu={(e)=>{e.preventDefault();setCt({x:e.clientX,y:e.clientY,kind:'chapter',storyId:story.id,chapterId:chapter.id});}}>
                              <button
                                className="vb-tree-toggle"
                                style={{ paddingLeft: 20 }}
                                onClick={() => toggleChapter(chapter.id)}
                                role="treeitem"
                                aria-level={2}
                                aria-expanded={chapterExp}
                              >
                                <span className="vb-chevron" aria-hidden="true">{chapterExp ? '▾' : '▸'}</span>
                                <span className="vb-icon" aria-hidden="true">📑</span>
                                <span className="vb-name">{chapter.title}</span>
                              </button>
                              <button
                                className="vb-inline-add"
                                onClick={() => onCreateScene(story.id, chapter.id)}
                                title="New Scene"
                                aria-label={`New scene in ${chapter.title}`}
                              >
                                +
                              </button>
                            </div>
                            {chapterExp && chapter.scenes.length === 0 && (
                              <div
                                className="vb-scenes-empty"
                                style={{ paddingLeft: 36 }}
                                data-testid="vb-scenes-empty"
                              >
                                No scenes yet. Create one to start writing.
                              </div>
                            )}
                            {chapterExp && chapter.scenes.length > 0 && (
                              <div role="group">
                                {[...chapter.scenes]
                                  .sort((a, b) => a.order - b.order)
                                  .map((scene) => {
                                    const isEditing = editingSceneId === scene.id;
                                    return (
                                      <div
                                        key={scene.id}
                                        className={`vb-row vb-scene-row${selectedSceneId === scene.id ? ' vb-selected' : ''}`}
                                        style={{ paddingLeft: 36 }}
                                        role="treeitem"
                                        aria-level={3}
                                        aria-selected={selectedSceneId === scene.id}
                                        tabIndex={0}
                                        data-testid={`vb-scene-${scene.id}`}
                                        onContextMenu={(e)=>{e.preventDefault();setCt({x:e.clientX,y:e.clientY,kind:'scene',storyId:story.id,chapterId:chapter.id,sceneId:scene.id});}}
                                        onMouseDown={(e) => {
                                          if (!isEditing && e.detail >= 2) {
                                            e.preventDefault();
                                            cancelPendingSceneSelect();
                                            startRenameScene(scene);
                                          }
                                        }}
                                        onClick={(e) => {
                                          if (!isEditing && e.detail < 2) selectSceneFromClick(scene, chapter, story);
                                        }}
                                        onDoubleClick={(e) => { e.preventDefault(); startRenameScene(scene); }}
                                        onKeyDown={(e) => {
                                          if (isEditing) return;
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            onSelectScene(scene, chapter, story);
                                          }
                                        }}
                                        title={isEditing ? undefined : scene.title}
                                      >
                                        <span className="vb-chevron" aria-hidden="true" />
                                        <span className="vb-icon" aria-hidden="true">📄</span>
                                        {isEditing ? (
                                          <SceneRenameInput
                                            value={editValue}
                                            error={editError}
                                            onChange={setEditValue}
                                            onCommit={commitRenameScene}
                                            onCancel={cancelRenameScene}
                                          />
                                        ) : (
                                          <span className="vb-name">{scene.title}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {ct && <StoryContextMenu x={ct.x} y={ct.y} kind={ct.kind} storyId={ct.storyId} chapterId={ct.chapterId} sceneId={ct.sceneId} onClose={()=>setCt(null)} onExport={(scope:ExportScope)=>{onExport?.(scope);}} />}
    </div>
  );
}

// ─── Notes Vault Empty State ───

interface NotesVaultEmptyStateProps {
  onCreate: () => void;
}

function NotesVaultEmptyState({ onCreate }: NotesVaultEmptyStateProps) {
  return (
    <section
      className="vb-notes-empty vb-empty"
      role="region"
      aria-labelledby="vb-notes-empty-heading"
      data-testid="vb-notes-empty"
    >
      <span className="vb-notes-empty-icon" aria-hidden="true">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="4" y="3" width="14" height="18" rx="2" />
          <line x1="7" y1="8" x2="14" y2="8" />
          <line x1="7" y1="12" x2="14" y2="12" />
          <line x1="7" y1="16" x2="11" y2="16" />
          <path d="M16.5 14.5 L20 18 L18 20 L14.5 16.5 Z" />
        </svg>
      </span>
      <h2 id="vb-notes-empty-heading" className="vb-notes-empty-heading">
        No notes yet
      </h2>
      <p className="vb-notes-empty-sub">
        Notes are for ideas, characters, places, and lore — anything that supports your scenes but isn&apos;t part of them.
      </p>
      <button
        className="vb-notes-empty-cta"
        type="button"
        onClick={onCreate}
        data-testid="vb-notes-empty-cta"
      >
        + New note
      </button>
      <p className="vb-notes-empty-footer">
        Or chat with Brainstorm — it&apos;ll file notes for you.
      </p>
    </section>
  );
}

// ─── Backlinks Pane (SKY-203) ───

const BACKLINKS_OPEN_KEY = 'vb-backlinks-open';

function readBacklinksOpen(): boolean {
  try { return localStorage.getItem(BACKLINKS_OPEN_KEY) !== 'false'; } catch { return true; }
}
function saveBacklinksOpen(v: boolean) {
  try { localStorage.setItem(BACKLINKS_OPEN_KEY, v ? 'true' : 'false'); } catch { /* */ }
}

interface BacklinkEntry { path: string; name: string; snippet: string; }

interface BacklinksPaneProps {
  notePath: string;
  onOpen: (path: string) => void;
}

function BacklinksPane({ notePath, onOpen }: BacklinksPaneProps) {
  const [open, setOpen] = useState(readBacklinksOpen);
  const [loading, setLoading] = useState(false);
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
  const prevPath = useRef<string>('');

  useEffect(() => {
    if (!open) return;
    if (prevPath.current === notePath) return;
    prevPath.current = notePath;
    setLoading(true);
    window.api.noteBacklinks(notePath)
      .then((res) => { setBacklinks(res.backlinks ?? []); })
      .catch(() => { setBacklinks([]); })
      .finally(() => { setLoading(false); });
  }, [notePath, open]);

  const handleToggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      saveBacklinksOpen(next);
      return next;
    });
  }, []);

  return (
    <div className="vb-backlinks" data-testid="vb-backlinks">
      <button
        className="vb-backlinks-toggle"
        onClick={handleToggle}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} backlinks`}
      >
        <span className="vb-backlinks-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="vb-backlinks-label">Backlinks</span>
      </button>
      {open && (
        <div className="vb-backlinks-body">
          {loading ? (
            <div className="vb-backlinks-status" aria-live="polite">Scanning…</div>
          ) : backlinks.length === 0 ? (
            <div className="vb-backlinks-empty" data-testid="vb-backlinks-empty">
              No notes link to this note.
            </div>
          ) : (
            <ul className="vb-backlinks-list" role="list" aria-label="Notes linking to this note">
              {backlinks.map((bl) => (
                <li key={bl.path} className="vb-backlinks-item">
                  <button
                    className="vb-backlinks-btn"
                    onClick={() => onOpen(bl.path)}
                    title={bl.path}
                  >
                    <span className="vb-backlinks-name">{bl.name}</span>
                    {bl.snippet && (
                      <span className="vb-backlinks-snippet">{bl.snippet}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Notes Vault (file-based, virtualized) ───

interface NotesVaultProps {
  items: ReturnType<typeof useVaultFiles>['items'];
  onOpenFile?: (path: string) => void;
  onReload: () => void;
  onContextChange?: (context: 'file' | 'folder' | null) => void;
  activeTag: string | null;
  onTagFilter: (tag: string | null) => void;
  iconMap?: Record<string, string>;
  onMove?: (fromPath: string, targetRow: FlatRow) => void;
  /** M15: dedicated open-in-new-tab handler; falls back to onOpenFile. */
  onOpenInNewTab?: (path: string) => void;
  /** M15: queue the Beta Reader agent on a note (context menu). */
  onBetaRead?: (path: string) => void;
  /** M15: run an Archive continuity check on a note (context menu). */
  onContinuityCheck?: (path: string) => void;
  /** W0.1: manifest id → title map for display-mapping UUID-named entries. */
  uuidTitleMap?: ReadonlyMap<string, string>;
}

const EMPTY_TITLE_MAP: ReadonlyMap<string, string> = new Map();

function NotesVault({ items, onOpenFile, onReload, onContextChange, activeTag, onTagFilter, iconMap, onMove, onOpenInNewTab, onBetaRead, onContinuityCheck, uuidTitleMap }: NotesVaultProps) {
  const allNotesItems = mapUuidNamesToTitles(
    (items as VaultListItem[]).filter(isNotesItem),
    uuidTitleMap ?? EMPTY_TITLE_MAP,
  );
  const [tagPaths, setTagPaths] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!activeTag) { setTagPaths(null); return; }
    window.api.notesTagList().then((result) => {
      if (!result || 'error' in result) return;
      const { tags } = result as { tags: NotesTagEntry[] };
      const paths = new Set<string>();
      function gather(entries: NotesTagEntry[]) {
        for (const e of entries) {
          if (e.fullName === activeTag) e.paths.forEach((p) => paths.add(p));
          gather(e.children);
        }
      }
      gather(tags);
      setTagPaths(paths);
    }).catch(() => setTagPaths(null));
  }, [activeTag]);

  const notesItems = tagPaths
    ? allNotesItems.filter((item) => !item.isDirectory && tagPaths.has(item.path))
    : allNotesItems;
  const tree = buildTree(notesItems);

  const { expanded, selected, toggle, initExpand, select } = useTreeState('notes');

  const treeLen = tree.length;
  useEffect(() => {
    initExpand(
      tree
        .filter((n) => n.isDirectory)
        .map((n) => n.path),
    );
  }, [treeLen]); // eslint-disable-line react-hooks/exhaustive-deps

  const [ctxRow, setCtxRow] = useState<FlatRow | null>(null);
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });

  // ─── Template dialog state ───
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDirPath, setDialogDirPath] = useState('');

  // ─── Rename state ───
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // ─── Explorer toolbar state (§6) ───
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'manual' | 'a-z' | 'z-a'>('manual');
  const [autoReveal, setAutoReveal] = useState(true);
  const [recentNotes, setRecentNotes] = useState<string[]>(() => {
    try { const r = localStorage.getItem('vb-recent-notes'); return r ? JSON.parse(r) : []; } catch { return []; }
  });

  const handleContextMenu = useCallback((e: React.MouseEvent, row: FlatRow) => {
    e.preventDefault();
    setCtxRow(row);
    setCtxPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleOpen = useCallback(
    (path: string) => {
      select(path);
      onOpenFile?.(path);
      onContextChange?.('file');
      // Track recent notes (max 10, no duplicates)
      setRecentNotes((prev) => {
        const next = [path, ...prev.filter((p) => p !== path)].slice(0, 10);
        try { localStorage.setItem('vb-recent-notes', JSON.stringify(next)); } catch { /**/ }
        return next;
      });
    },
    [select, onOpenFile, onContextChange],
  );

  // Auto-reveal: expand tree parents when selected note changes (§6)
  useEffect(() => {
    if (!autoReveal || !selected) return;
    const parts = selected.split('/');
    for (let i = 1; i < parts.length - 1; i++) {
      const parentPath = parts.slice(0, i + 1).join('/');
      if (!expanded.has(parentPath)) toggle(parentPath);
    }
  }, [selected, autoReveal, expanded, toggle]);

  const handleToggleFolder = useCallback(
    (path: string) => {
      toggle(path);
      onContextChange?.('folder');
    },
    [toggle, onContextChange],
  );

  // M15: "Open in new tab" — prefer the dedicated handler, otherwise reuse the
  // regular open flow (which already opens the note in the workspace tab).
  const handleOpenInNewTab = useCallback(
    (row: FlatRow) => {
      const path = row.node.path;
      select(path);
      (onOpenInNewTab ?? onOpenFile)?.(path);
      onContextChange?.('file');
    },
    [select, onOpenInNewTab, onOpenFile, onContextChange],
  );

  // M15: context-menu Delete — confirm, then remove via the notes-vault IPC.
  const handleDelete = useCallback(
    async (row: FlatRow) => {
      const path = row.node.path;
      const name = row.node.name.endsWith('.md') ? row.node.name.slice(0, -3) : row.node.name;
      if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
      try {
        const res = await window.api.deleteNotesVault(path);
        if (res && 'error' in res) throw new Error(res.error);
        onReload();
      } catch (e) {
        console.error('Delete failed:', e);
      }
    },
    [onReload],
  );

  const handleBetaRead = useCallback(
    (row: FlatRow) => onBetaRead?.(row.node.path),
    [onBetaRead],
  );

  const handleContinuityCheck = useCallback(
    (row: FlatRow) => onContinuityCheck?.(row.node.path),
    [onContinuityCheck],
  );

  const handleStartRename = useCallback((row: FlatRow) => {
    if (row.node.isDirectory) return;
    setEditingPath(row.node.path);
    const name = row.node.name;
    const lastDot = name.lastIndexOf('.');
    setEditValue(lastDot > 0 ? name.slice(0, lastDot) : name);
    setEditError(null);
  }, []);

  const handleRenameCommit = useCallback(async () => {
    if (!editingPath) return;
    const err = validateRenameName(editValue);
    if (err) { setEditError(err); return; }
    const trimmed = editValue.trim();
    const slash = editingPath.lastIndexOf('/');
    const dir = slash > 0 ? editingPath.slice(0, slash + 1) : '';
    const origName = editingPath.split('/').pop()!;
    const lastDot = origName.lastIndexOf('.');
    const ext = lastDot > 0 ? origName.slice(lastDot) : '';
    const newPath = dir + trimmed + ext;
    if (newPath === editingPath) { setEditingPath(null); return; }
    const pathExists = notesItems.some((item) => item.path === newPath);
    if (pathExists) { setEditError('A file with that name already exists'); return; }
    try {
      await window.api.moveNotesVault(editingPath, newPath);
      setEditingPath(null);
      setEditError(null);
      onReload();
      select(newPath);
    } catch (e) {
      setEditError((e as Error).message || 'Rename failed');
    }
  }, [editingPath, editValue, notesItems, onReload, select]);

  const handleRenameCancel = useCallback(() => {
    setEditingPath(null);
    setEditError(null);
  }, []);

  const handleNewNote = useCallback(
    (dirPath: string) => {
      setDialogDirPath(dirPath);
      setDialogOpen(true);
    },
    [],
  );

  const handleNoteCreated = useCallback(
    async (path: string) => {
      await onReload();
      select(path);
      onOpenFile?.(path);
    },
    [onReload, select, onOpenFile],
  );

  const handleNewFolder = useCallback(
    async (dirPath: string) => {
      const name = prompt('Folder name:');
      if (!name?.trim()) return;
      const slug = name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
      const rel = dirPath ? `${dirPath}/${slug || 'folder'}` : `${slug || 'folder'}`;
      try {
        await window.api.mkdirNotesVault(rel);
        await onReload();
      } catch (e) {
        console.error('Failed to create folder:', e);
      }
    },
    [onReload],
  );

  // Apply search filter and sort (§6)
  const processedTree = useMemo(() => {
    let result = tree;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((n) => n.name.toLowerCase().includes(q) || n.isDirectory);
    }
    if (sortMode !== 'manual') {
      result = [...result].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return sortMode === 'a-z' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      });
    }
    return result;
  }, [tree, searchQuery, sortMode]);

  const rows = flattenTree(processedTree, expanded, selected);

  return (
    <div className="vb-notes-vault" data-testid="vb-notes-vault">
      {/* §6: vault switcher + search field */}
      <div className="vb-notes-header">
        <select className="vb-vault-switcher" aria-label="Notes vault">
          <option value="main">Main Vault</option>
          <option value="imports">Imports</option>
        </select>
        <input
          className="vb-search-field"
          type="text"
          placeholder="Search notes…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search notes"
        />
      </div>
      {/* §6: 5-button explorer toolbar */}
      <div className="vb-explorer-toolbar" role="toolbar" aria-label="Notes explorer toolbar">
        <button className="vb-toolbar-btn" onClick={() => handleNewNote('')} title="New note" aria-label="New note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button className="vb-toolbar-btn" onClick={() => handleNewFolder('')} title="New folder" aria-label="New folder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button
          className={`vb-toolbar-btn${sortMode !== 'manual' ? ' vb-toolbar-active' : ''}`}
          onClick={() => setSortMode((m) => m === 'manual' ? 'a-z' : m === 'a-z' ? 'z-a' : 'manual')}
          title={`Sort: ${sortMode === 'manual' ? 'Manual' : sortMode === 'a-z' ? 'A–Z' : 'Z–A'} (click to cycle)`}
          aria-label={`Sort ${sortMode}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 6h18M3 12h12M3 18h6"/></svg>
        </button>
        <button
          className={`vb-toolbar-btn${autoReveal ? ' vb-toolbar-active' : ''}`}
          onClick={() => setAutoReveal((r) => !r)}
          title="Auto-reveal current note"
          aria-label="Auto-reveal current note"
          aria-pressed={autoReveal}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button
          className="vb-toolbar-btn"
          onClick={() => {
            const dirs = processedTree.filter((n) => n.isDirectory);
            const allOpen = dirs.length > 0 && dirs.every((n) => expanded.has(n.path));
            if (allOpen) {
              dirs.forEach((n) => { if (expanded.has(n.path)) toggle(n.path); });
            } else {
              dirs.forEach((n) => { if (!expanded.has(n.path)) toggle(n.path); });
            }
          }}
          title="Collapse / expand all"
          aria-label="Collapse or expand all folders"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
      <TagPane activeTag={activeTag} onTagFilter={onTagFilter} />
      {allNotesItems.length === 0 ? (
        <NotesVaultEmptyState onCreate={() => handleNewNote('')} />
      ) : notesItems.length === 0 && activeTag ? (
        <div className="vb-notes-no-match" data-testid="vb-notes-no-match">
          No notes with tag <strong>{activeTag}</strong>
        </div>
      ) : (
        <VirtualTree
          data-testid="vb-notes-tree"
          label="Notes Vault"
          rows={rows}
          onToggle={handleToggleFolder}
          onOpen={handleOpen}
          onContextMenu={handleContextMenu}
          editingPath={editingPath}
          editingValue={editValue}
          editError={editError}
          onStartRename={handleStartRename}
          onRenameChange={setEditValue}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={handleRenameCancel}
          iconMap={iconMap}
          onMove={onMove}
        />
      )}
      <ContextMenu
        row={ctxRow}
        x={ctxPos.x}
        y={ctxPos.y}
        onClose={() => setCtxRow(null)}
        onNewNote={handleNewNote}
        onNewFolder={handleNewFolder}
        onRename={handleStartRename}
        onOpenInNewTab={handleOpenInNewTab}
        onDelete={handleDelete}
        onBetaRead={onBetaRead ? handleBetaRead : undefined}
        onContinuityCheck={onContinuityCheck ? handleContinuityCheck : undefined}
      />
      <NoteTemplateDialog
        open={dialogOpen}
        dirPath={dialogDirPath}
        onClose={() => setDialogOpen(false)}
        onCreated={handleNoteCreated}
      />
      {selected && !selected.endsWith('/') && selected.endsWith('.md') && (
        <BacklinksPane notePath={selected} onOpen={handleOpen} />
      )}
      {/* §6: RECENT list */}
      {recentNotes.length > 0 && (
        <div className="vb-recent-list">
          <div className="vb-recent-label">RECENT</div>
          <ul className="vb-recent-items" role="list">
            {recentNotes.map((path) => {
              const item = allNotesItems.find((i) => i.path === path && !i.isDirectory);
              if (!item) return null;
              return (
                <li key={path}>
                  <button className="vb-recent-btn" onClick={() => handleOpen(path)} title={item.name}>
                    <span className="vb-recent-name">{item.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Main VaultBrowser ───

type VaultScope = 'story' | 'notes' | 'both';

export interface VaultBrowserProps {
  stories: Story[];
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onOpenFile?: (path: string) => void;
  onContextChange?: (context: 'file' | 'folder' | null) => void;
  onExport?: (scope: ExportScope) => void;
  /** SKY-204: whether journal mode is enabled (shows Daily Notes widget). */
  journalModeEnabled?: boolean;
  /** SKY-2096: initial vault scope selection. Defaults to 'both'. */
  initialScope?: 'story' | 'notes' | 'both';
  /** SKY-2976: when true, hides the scope selector and locks to initialScope. */
  lockScope?: boolean;
  /** M15: notes-tree context menu "Open in new tab"; falls back to onOpenFile. */
  onOpenInNewTab?: (path: string) => void;
  /** M15: notes-tree context menu "Beta read" (disabled until wired). */
  onBetaRead?: (path: string) => void;
  /** M15: notes-tree context menu "Continuity check" (disabled until wired). */
  onContinuityCheck?: (path: string) => void;
}

// SKY-204: Daily Notes widget shown at the top of the vault browser when journal mode is on.
function DailyNotesBanner({ onOpenFile }: { onOpenFile?: (path: string) => void }) {
  const [streak, setStreak] = useState(0);
  const [todayExists, setTodayExists] = useState(false);
  const [opening, setOpening] = useState(false);

  const loadStreak = useCallback(async () => {
    try {
      const r = await window.api.dailyNoteGetStreak();
      setStreak(r.streakDays);
      setTodayExists(r.todayExists);
    } catch {
      // vault not ready yet
    }
  }, []);

  useEffect(() => {
    loadStreak();
    const unsub = window.api.onVaultFileChanged?.(() => loadStreak());
    return () => unsub?.();
  }, [loadStreak]);

  const handleOpen = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const r = await window.api.dailyNoteOpenToday();
      await loadStreak();
      onOpenFile?.(r.path);
    } catch {
      // non-fatal
    } finally {
      setOpening(false);
    }
  }, [opening, loadStreak, onOpenFile]);

  return (
    <div className="vb-daily-banner">
      <div className="vb-daily-streak">
        {streak > 0 && (
          <span title={`Journal streak: ${streak} consecutive day${streak === 1 ? '' : 's'}`}>
            🔥 {streak} day{streak === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <button
        className={`vb-daily-today-btn${todayExists ? ' vb-daily-today-btn--exists' : ''}`}
        onClick={handleOpen}
        disabled={opening}
        aria-label="Open or create today's daily note"
      >
        {opening ? '…' : todayExists ? "Open Today's Note" : "Create Today's Note"}
      </button>
    </div>
  );
}

export default function VaultBrowser({
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onOpenFile,
  onContextChange,
  onExport,
  journalModeEnabled,
  initialScope = 'both',
  lockScope = false,
  onOpenInNewTab,
  onBetaRead,
  onContinuityCheck,
}: VaultBrowserProps) {
  const [scope, setScope] = useState<VaultScope>(initialScope);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const { items: notesItems, loading: notesLoading, reload: notesReload } = useVaultFiles('notes');
  const [notesIconMap, setNotesIconMap] = useState<Record<string, string>>({});

  // W0.1 (GAP #1): manifest id → title map so any UUID-named entry that
  // legitimately reaches a tree renders its story/chapter/scene title.
  const uuidTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const story of stories) {
      map.set(story.id.toLowerCase(), story.title);
      for (const chapter of story.chapters) {
        map.set(chapter.id.toLowerCase(), chapter.title);
        for (const scene of chapter.scenes) {
          map.set(scene.id.toLowerCase(), scene.title);
        }
      }
    }
    return map;
  }, [stories]);

  useEffect(() => {
    window.api.notesVaultReadIcons().then((m) => {
      if (m && typeof m === 'object') setNotesIconMap(m as Record<string, string>);
    }).catch(() => {});
  }, [notesItems.length]);

  const showStory = scope === 'story' || scope === 'both';
  const showNotes = scope === 'notes' || scope === 'both';

  const handleRenameScene = useCallback(async (sceneId: string, title: string): Promise<void> => {
    const result = await window.api.sceneRename({ sceneId, title });
    if (result && 'error' in result) throw new Error((result as { error: string }).error);
  }, []);

  const handleMove = useCallback(async (fromPath: string, targetRow: FlatRow) => {
    const targetDir = targetRow.node.isDirectory
      ? targetRow.node.path
      : (() => {
          const slash = targetRow.node.path.lastIndexOf('/');
          return slash > 0 ? targetRow.node.path.slice(0, slash) : '';
        })();
    const fileName = fromPath.split('/').pop()!;
    const toPath = targetDir ? `${targetDir}/${fileName}` : fileName;
    if (toPath === fromPath) return;
    try {
      await window.api.moveNotesVault(fromPath, toPath);
      notesReload();
    } catch (e) {
      console.error('Move failed:', e);
    }
  }, [notesReload]);

  return (
    <div className="vault-browser" data-testid="vault-browser">
      {journalModeEnabled && (
        <DailyNotesBanner onOpenFile={onOpenFile} />
      )}
      {!lockScope && (
        <div className="vb-scope-bar" role="group" aria-label="Vault scope">
          <button
            className={`vb-scope-btn${scope === 'story' ? ' vb-scope-active' : ''}`}
            onClick={() => setScope('story')}
            aria-pressed={scope === 'story'}
            data-testid="vb-scope-story"
          >
            Story
          </button>
          <button
            className={`vb-scope-btn${scope === 'notes' ? ' vb-scope-active' : ''}`}
            onClick={() => setScope('notes')}
            aria-pressed={scope === 'notes'}
            data-testid="vb-scope-notes"
          >
            Notes
          </button>
          <button
            className={`vb-scope-btn${scope === 'both' ? ' vb-scope-active' : ''}`}
            onClick={() => setScope('both')}
            aria-pressed={scope === 'both'}
            data-testid="vb-scope-both"
          >
            Both
          </button>
        </div>
      )}

      <div className="vb-content">
        {showStory && (
          <div className={`vb-section${scope === 'both' ? ' vb-section-story-split' : ' vb-section-full'}`}>
            <StoryVault
              stories={stories}
              selectedSceneId={selectedSceneId}
              onSelectScene={onSelectScene}
              onCreateStory={onCreateStory}
              onCreateChapter={onCreateChapter}
              onCreateScene={onCreateScene}
              onRenameScene={handleRenameScene}
              onExport={onExport}
            />
          </div>
        )}

        {scope === 'both' && <div className="vb-divider" aria-hidden="true" />}

        {showNotes && (
          <div className={`vb-section${scope === 'both' ? ' vb-section-notes-split' : ' vb-section-full'}`}>
            {notesLoading ? (
              <div className="vb-loading">Loading…</div>
            ) : (
              <NotesVault
                items={notesItems}
                onOpenFile={onOpenFile}
                onReload={notesReload}
                onContextChange={onContextChange}
                activeTag={activeTag}
                onTagFilter={setActiveTag}
                iconMap={notesIconMap}
                onMove={handleMove}
                onOpenInNewTab={onOpenInNewTab}
                onBetaRead={onBetaRead}
                onContinuityCheck={onContinuityCheck}
                uuidTitleMap={uuidTitleMap}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
