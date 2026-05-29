import { useState, useCallback, useEffect } from 'react';
import type { Story, Scene, Chapter } from '../../types';
import { useVaultFiles } from './useVaultFiles';
import { useTreeState } from './useTreeState';
import { buildTree, flattenTree } from './treeUtils';
import type { FlatRow } from './treeUtils';
import VirtualTree from './VirtualTree';
import ContextMenu from './ContextMenu';
import './VaultBrowser.css';

// ─── Filters ───
// SKY-9: the Notes Vault is now its own IPC root, so we no longer need to
// strip the Story Vault's `Manuscript/` prefix here. We still hide internal
// bookkeeping (manifest backups, versions/snapshots/git) so they don't show
// up in the tree.

const INTERNAL_FILES = new Set(['manifest.json', 'manifest.json.bak']);
const INTERNAL_PREFIXES = ['.versions', '.snapshots', '.git'];

function isNotesItem(item: { path: string; name: string }): boolean {
  if (item.name.startsWith('.')) return false;
  if (INTERNAL_FILES.has(item.path)) return false;
  for (const prefix of INTERNAL_PREFIXES) {
    if (item.path === prefix || item.path.startsWith(prefix + '/')) return false;
  }
  return true;
}

// ─── Story Vault (manifest-based) ───

interface StoryVaultProps {
  stories: Story[];
  selectedSceneId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
}

function StoryVault({
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
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
      <div className="vb-story-content">
        {stories.length === 0 ? (
          <div className="vb-empty">No stories yet. Click + to create one.</div>
        ) : (
          stories.map((story) => {
            const storyExp = expandedStories.has(story.id);
            return (
              <div key={story.id}>
                <div className="vb-item-row">
                  <button
                    className="vb-tree-toggle"
                    onClick={() => toggleStory(story.id)}
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
                {storyExp &&
                  [...story.chapters]
                    .sort((a, b) => a.order - b.order)
                    .map((chapter) => {
                      const chapterExp = expandedChapters.has(chapter.id);
                      return (
                        <div key={chapter.id}>
                          <div className="vb-item-row">
                            <button
                              className="vb-tree-toggle"
                              style={{ paddingLeft: 20 }}
                              onClick={() => toggleChapter(chapter.id)}
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
                          {chapterExp &&
                            [...chapter.scenes]
                              .sort((a, b) => a.order - b.order)
                              .map((scene) => (
                                <div
                                  key={scene.id}
                                  className={`vb-row vb-scene-row${selectedSceneId === scene.id ? ' vb-selected' : ''}`}
                                  style={{ paddingLeft: 36 }}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => onSelectScene(scene, chapter, story)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      onSelectScene(scene, chapter, story);
                                    }
                                  }}
                                  title={scene.title}
                                >
                                  <span className="vb-chevron" aria-hidden="true" />
                                  <span className="vb-icon" aria-hidden="true">📄</span>
                                  <span className="vb-name">{scene.title}</span>
                                </div>
                              ))}
                        </div>
                      );
                    })}
              </div>
            );
          })
        )}
      </div>
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
      className="vb-notes-empty"
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
        Capture your first idea
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

// ─── Notes Vault (file-based, virtualized) ───

interface NotesVaultProps {
  items: ReturnType<typeof useVaultFiles>['items'];
  onOpenFile?: (path: string) => void;
  onReload: () => void;
}

function NotesVault({ items, onOpenFile, onReload }: NotesVaultProps) {
  const notesItems = items.filter(isNotesItem);
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

  const handleContextMenu = useCallback((e: React.MouseEvent, row: FlatRow) => {
    e.preventDefault();
    setCtxRow(row);
    setCtxPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleOpen = useCallback(
    (path: string) => {
      select(path);
      onOpenFile?.(path);
    },
    [select, onOpenFile],
  );

  const handleNewNote = useCallback(
    async (dirPath: string) => {
      const name = prompt('Note name (without .md):');
      if (!name?.trim()) return;
      const slug = name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
      const rel = dirPath ? `${dirPath}/${slug || 'note'}.md` : `${slug || 'note'}.md`;
      try {
        await window.api.writeVault(
          rel,
          `---\ntitle: "${name.trim()}"\ncreatedAt: ${new Date().toISOString()}\n---\n\n`,
        );
        await onReload();
        select(rel);
        onOpenFile?.(rel);
      } catch (e) {
        console.error('Failed to create note:', e);
      }
    },
    [onReload, select, onOpenFile],
  );

  const handleNewFolder = useCallback(
    async (dirPath: string) => {
      const name = prompt('Folder name:');
      if (!name?.trim()) return;
      const slug = name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
      const rel = dirPath ? `${dirPath}/${slug || 'folder'}/.gitkeep` : `${slug || 'folder'}/.gitkeep`;
      try {
        await window.api.writeVault(rel, '');
        await onReload();
      } catch (e) {
        console.error('Failed to create folder:', e);
      }
    },
    [onReload],
  );

  const rows = flattenTree(tree, expanded, selected);

  return (
    <div className="vb-notes-vault" data-testid="vb-notes-vault">
      <div className="vb-section-header">
        <span className="vb-section-label">Notes Vault</span>
        <button
          className="vb-section-add"
          onClick={() => handleNewNote('')}
          title="New Note"
          aria-label="New Note"
        >
          +
        </button>
      </div>
      {notesItems.length === 0 ? (
        <NotesVaultEmptyState onCreate={() => handleNewNote('')} />
      ) : (
        <VirtualTree
          data-testid="vb-notes-tree"
          rows={rows}
          onToggle={toggle}
          onOpen={handleOpen}
          onContextMenu={handleContextMenu}
        />
      )}
      <ContextMenu
        row={ctxRow}
        x={ctxPos.x}
        y={ctxPos.y}
        onClose={() => setCtxRow(null)}
        onNewNote={handleNewNote}
        onNewFolder={handleNewFolder}
      />
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
}

export default function VaultBrowser({
  stories,
  selectedSceneId,
  onSelectScene,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onOpenFile,
}: VaultBrowserProps) {
  const [scope, setScope] = useState<VaultScope>('both');
  const { items, loading, reload } = useVaultFiles();

  const showStory = scope === 'story' || scope === 'both';
  const showNotes = scope === 'notes' || scope === 'both';

  return (
    <div className="vault-browser" data-testid="vault-browser">
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
            />
          </div>
        )}

        {scope === 'both' && <div className="vb-divider" aria-hidden="true" />}

        {showNotes && (
          <div className={`vb-section${scope === 'both' ? ' vb-section-notes-split' : ' vb-section-full'}`}>
            {loading ? (
              <div className="vb-loading">Loading…</div>
            ) : (
              <NotesVault
                items={items}
                onOpenFile={onOpenFile}
                onReload={reload}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
