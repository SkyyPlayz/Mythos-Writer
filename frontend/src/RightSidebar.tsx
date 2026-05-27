import { useState } from 'react';
import type { Scene, Story, Chapter } from './types';
import WritingAssistantPanel from './WritingAssistantPanel';
import VaultAgentPanel from './VaultAgentPanel';
import ArchivePanel from './ArchivePanel';
import './RightSidebar.css';

type Tab = 'notes' | 'properties' | 'ai';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  selectedScene: Scene | null;
  selectedChapter: Chapter | null;
  selectedStory: Story | null;
  writingAssistantEnabled?: boolean;
  archiveEnabled?: boolean;
  micDeviceId?: string;
  onJumpToText?: (text: string) => void;
  onInsertWikiLink?: (link: string, anchorText: string) => void;
}

function NotesPanel({ scene }: { scene: Scene | null }) {
  const [note, setNote] = useState('');

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
        onChange={(e) => setNote(e.target.value)}
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

function AiPanel({
  scene,
  writingAssistantEnabled = true,
  archiveEnabled = true,
  micDeviceId,
  onJumpToText = () => {},
  onInsertWikiLink = () => {},
}: {
  scene: Scene | null;
  writingAssistantEnabled?: boolean;
  archiveEnabled?: boolean;
  micDeviceId?: string;
  onJumpToText?: (text: string) => void;
  onInsertWikiLink?: (link: string, anchorText: string) => void;
}) {
  const [subTab, setSubTab] = useState<AiSubTab>('writing');

  return (
    <div className="ai-panel">
      <div className="ai-subtabs" role="tablist" aria-label="AI assistant sections">
        <button
          role="tab"
          id="ai-subtab-writing"
          aria-selected={subTab === 'writing'}
          aria-controls="ai-panel-writing"
          className={`ai-subtab${subTab === 'writing' ? ' active' : ''}`}
          onClick={() => setSubTab('writing')}
        >
          Writing
        </button>
        <button
          role="tab"
          id="ai-subtab-vault"
          aria-selected={subTab === 'vault'}
          aria-controls="ai-panel-vault"
          className={`ai-subtab${subTab === 'vault' ? ' active' : ''}`}
          onClick={() => setSubTab('vault')}
        >
          Vault
        </button>
        <button
          role="tab"
          id="ai-subtab-archive"
          aria-selected={subTab === 'archive'}
          aria-controls="ai-panel-archive"
          className={`ai-subtab${subTab === 'archive' ? ' active' : ''}`}
          onClick={() => setSubTab('archive')}
        >
          Archive
        </button>
      </div>
      <div
        id={`ai-panel-${subTab}`}
        role="tabpanel"
        aria-labelledby={`ai-subtab-${subTab}`}
      >
        {subTab === 'writing' && <WritingAssistantPanel scene={scene} enabled={writingAssistantEnabled} micDeviceId={micDeviceId} />}
        {subTab === 'vault' && <VaultAgentPanel scene={scene} enabled={archiveEnabled} />}
        {subTab === 'archive' && (
          <ArchivePanel
            scene={scene}
            onJumpToText={onJumpToText}
            onInsertWikiLink={onInsertWikiLink}
          />
        )}
      </div>
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
  micDeviceId,
  onJumpToText,
  onInsertWikiLink,
}: Props) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'notes', label: 'Notes' },
    { id: 'properties', label: 'Properties' },
    { id: 'ai', label: 'Assistant' },
  ];

  return (
    <div className="right-sidebar">
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`sidebar-tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`sidebar-panel-${t.id}`}
            className={`sidebar-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={`sidebar-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`sidebar-tab-${activeTab}`}
        className="sidebar-content"
      >
        {activeTab === 'notes' && <NotesPanel scene={selectedScene} />}
        {activeTab === 'properties' && (
          <PropertiesPanel scene={selectedScene} chapter={selectedChapter} story={selectedStory} />
        )}
        {activeTab === 'ai' && (
          <AiPanel
            scene={selectedScene}
            writingAssistantEnabled={writingAssistantEnabled}
            archiveEnabled={archiveEnabled}
            micDeviceId={micDeviceId}
            onJumpToText={onJumpToText}
            onInsertWikiLink={onInsertWikiLink}
          />
        )}
      </div>
    </div>
  );
}
