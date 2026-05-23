import { useState, useEffect } from 'react';
import type { Story, Chapter, Scene, EntityEntry } from './types';
import StoryNavigator from './StoryNavigator';
import EntityBrowser from './EntityBrowser';
import SuggestionReview from './SuggestionReview';
import './LeftRail.css';

type Tab = 'stories' | 'vault' | 'entities' | 'review';

interface VaultEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: VaultEntry[];
}

function groupByCategory(entries: VaultEntry[]) {
  const categories: Record<string, VaultEntry[]> = {
    Stories: [],
    Characters: [],
    Locations: [],
    Items: [],
    Notes: [],
    Other: [],
  };
  for (const e of entries) {
    const lower = e.path.toLowerCase();
    if (lower.includes('stories/') || lower.includes('story')) categories['Stories'].push(e);
    else if (lower.includes('character')) categories['Characters'].push(e);
    else if (lower.includes('location') || lower.includes('place')) categories['Locations'].push(e);
    else if (lower.includes('item') || lower.includes('object')) categories['Items'].push(e);
    else if (lower.includes('note')) categories['Notes'].push(e);
    else categories['Other'].push(e);
  }
  return categories;
}

function VaultBrowser() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['Stories', 'Characters', 'Locations', 'Items', 'Notes']));

  useEffect(() => {
    (async () => {
      try {
        const result = await (window as any).api?.listVault?.();
        if (Array.isArray(result)) {
          const flat = result.map((p: string) => ({
            path: p,
            name: p.split('/').pop() ?? p,
            type: 'file' as const,
          }));
          setEntries(flat);
        }
      } catch {
        // vault not ready
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleCategory = (cat: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });

  if (loading) return <div className="vault-loading">Loading vault…</div>;

  const grouped = groupByCategory(entries);
  const hasAny = Object.values(grouped).some((g) => g.length > 0);

  if (!hasAny) {
    return (
      <div className="vault-empty">
        <div className="vault-empty-icon">🗄️</div>
        <p>Your vault is empty.</p>
        <p className="vault-empty-sub">Markdown files you create or import will appear here, organized by type.</p>
      </div>
    );
  }

  return (
    <div className="vault-browser">
      {Object.entries(grouped).map(([cat, items]) => {
        if (items.length === 0) return null;
        return (
          <div key={cat} className="vault-category">
            <div
              className="vault-category-header"
              onClick={() => toggleCategory(cat)}
            >
              <span className="vault-chevron">{expanded.has(cat) ? '▾' : '▸'}</span>
              <span className="vault-category-name">{cat}</span>
              <span className="vault-count">{items.length}</span>
            </div>
            {expanded.has(cat) && (
              <div className="vault-items">
                {items.map((item) => (
                  <div key={item.path} className="vault-item" title={item.path}>
                    <span className="vault-item-icon">◦</span>
                    <span className="vault-item-name">{item.name.replace(/\.md$/, '')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  stories: Story[];
  selectedSceneId: string | null;
  selectedEntityId: string | null;
  onSelectScene: (scene: Scene, chapter: Chapter, story: Story) => void;
  onSelectEntity: (entity: EntityEntry) => void;
  onCreateStory: () => void;
  onCreateChapter: (storyId: string) => void;
  onCreateScene: (storyId: string, chapterId: string) => void;
  onOpenVaultPath?: (path: string) => void;
}

export default function LeftRail({
  activeTab,
  onTabChange,
  stories,
  selectedSceneId,
  selectedEntityId,
  onSelectScene,
  onSelectEntity,
  onCreateStory,
  onCreateChapter,
  onCreateScene,
  onOpenVaultPath,
}: Props) {
  return (
    <div className="left-rail">
      <div className="rail-tabs">
        <button
          className={`rail-tab${activeTab === 'stories' ? ' active' : ''}`}
          onClick={() => onTabChange('stories')}
        >
          Stories
        </button>
        <button
          className={`rail-tab${activeTab === 'entities' ? ' active' : ''}`}
          onClick={() => onTabChange('entities')}
        >
          Entities
        </button>
        <button
          className={`rail-tab${activeTab === 'vault' ? ' active' : ''}`}
          onClick={() => onTabChange('vault')}
        >
          Vault
        </button>
        <button
          className={`rail-tab${activeTab === 'review' ? ' active' : ''}`}
          onClick={() => onTabChange('review')}
          aria-label="Suggestion Review inbox"
        >
          Review
        </button>
      </div>
      <div className="rail-content">
        {activeTab === 'stories' && (
          <StoryNavigator
            stories={stories}
            selectedSceneId={selectedSceneId}
            onSelectScene={onSelectScene}
            onCreateStory={onCreateStory}
            onCreateChapter={onCreateChapter}
            onCreateScene={onCreateScene}
          />
        )}
        {activeTab === 'entities' && (
          <EntityBrowser
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntityId}
          />
        )}
        {activeTab === 'vault' && <VaultBrowser />}
        {activeTab === 'review' && <SuggestionReview onOpenVaultPath={onOpenVaultPath} />}
      </div>
    </div>
  );
}
