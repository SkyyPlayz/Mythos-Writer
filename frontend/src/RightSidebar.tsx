import { useState } from 'react';
import { useVaultStore, selectActiveScene, selectActiveChapter, selectActiveStory } from './stores/vaultStore';
import { useUIStore } from './stores/uiStore';
import WritingAssistantPanel from './WritingAssistantPanel';
import VaultAgentPanel from './VaultAgentPanel';
import ArchivePanel from './ArchivePanel';
import './RightSidebar.css';

interface Props {
  writingAssistantEnabled?: boolean;
  archiveEnabled?: boolean;
  scanIntervalSeconds?: number;
  onJumpToText?: (text: string) => void;
  onInsertWikiLink?: (link: string, anchorText: string) => void;
  onWikiLinkSuggestionsChange?: (suggestions: Array<{ id: string; anchorText: string; wikiLink: string }>) => void;
}

function NotesPanel() {
  const selectedScene = useVaultStore(selectActiveScene);
  const [note, setNote] = useState('');

  if (!selectedScene) {
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
      />
    </div>
  );
}

function PropertiesPanel() {
  const selectedScene = useVaultStore(selectActiveScene);
  const selectedChapter = useVaultStore(selectActiveChapter);
  const selectedStory = useVaultStore(selectActiveStory);

  if (!selectedScene || !selectedChapter || !selectedStory) {
    return (
      <div className="sidebar-empty">
        <div className="sidebar-empty-icon">🏷️</div>
        <p>Select a scene to see its properties.</p>
        <p className="sidebar-empty-sub">Word count, draft state, creation date, and more.</p>
      </div>
    );
  }

  const wordCount = selectedScene.blocks
    .map((b) => b.content.trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);

  const blocksByType = selectedScene.blocks.reduce<Record<string, number>>((acc, b) => {
    acc[b.type] = (acc[b.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="sidebar-properties">
      <div className="prop-group">
        <div className="prop-label">Scene</div>
        <div className="prop-value prop-title">{selectedScene.title}</div>
      </div>
      <div className="prop-row">
        <div className="prop-group">
          <div className="prop-label">Story</div>
          <div className="prop-value">{selectedStory.title}</div>
        </div>
        <div className="prop-group">
          <div className="prop-label">Chapter</div>
          <div className="prop-value">{selectedChapter.title}</div>
        </div>
      </div>
      <div className="prop-row">
        <div className="prop-group">
          <div className="prop-label">Words</div>
          <div className="prop-value prop-stat">{wordCount.toLocaleString()}</div>
        </div>
        <div className="prop-group">
          <div className="prop-label">Blocks</div>
          <div className="prop-value prop-stat">{selectedScene.blocks.length}</div>
        </div>
      </div>
      <div className="prop-group">
        <div className="prop-label">Draft state</div>
        <div className={`prop-value prop-draft draft-${selectedScene.draftState ?? 'in-progress'}`}>
          {selectedScene.draftState ?? 'in-progress'}
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
        <div className="prop-value prop-date">{new Date(selectedScene.updatedAt).toLocaleString()}</div>
      </div>
      <div className="prop-group">
        <div className="prop-label">Created</div>
        <div className="prop-value prop-date">{new Date(selectedScene.createdAt).toLocaleString()}</div>
      </div>
    </div>
  );
}

type AiSubTab = 'writing' | 'vault' | 'archive';

function AiPanel({
  writingAssistantEnabled = true,
  archiveEnabled = true,
  scanIntervalSeconds = 30,
  onJumpToText = () => {},
  onInsertWikiLink = () => {},
  onWikiLinkSuggestionsChange,
}: {
  writingAssistantEnabled?: boolean;
  archiveEnabled?: boolean;
  scanIntervalSeconds?: number;
  onJumpToText?: (text: string) => void;
  onInsertWikiLink?: (link: string, anchorText: string) => void;
  onWikiLinkSuggestionsChange?: (suggestions: Array<{ id: string; anchorText: string; wikiLink: string }>) => void;
}) {
  const [subTab, setSubTab] = useState<AiSubTab>('writing');
  const selectedScene = useVaultStore(selectActiveScene);
  const view = useUIStore((s) => s.view);
  const isPageFocused = view === 'editor';

  return (
    <div className="ai-panel">
      <div className="ai-subtabs">
        <button className={`ai-subtab${subTab === 'writing' ? ' active' : ''}`} onClick={() => setSubTab('writing')}>Writing</button>
        <button className={`ai-subtab${subTab === 'vault' ? ' active' : ''}`} onClick={() => setSubTab('vault')}>Vault</button>
        <button className={`ai-subtab${subTab === 'archive' ? ' active' : ''}`} onClick={() => setSubTab('archive')}>Archive</button>
      </div>
      {subTab === 'writing' && (
        <WritingAssistantPanel
          scene={selectedScene}
          enabled={writingAssistantEnabled}
          scanIntervalSeconds={scanIntervalSeconds}
          isActive={isPageFocused}
        />
      )}
      {subTab === 'vault' && <VaultAgentPanel scene={selectedScene} enabled={archiveEnabled} />}
      {subTab === 'archive' && (
        <ArchivePanel
          scene={selectedScene}
          enabled={archiveEnabled}
          onJumpToText={onJumpToText}
          onInsertWikiLink={onInsertWikiLink}
          onWikiLinkSuggestionsChange={onWikiLinkSuggestionsChange}
        />
      )}
    </div>
  );
}

type Tab = 'notes' | 'properties' | 'ai';

export default function RightSidebar({
  writingAssistantEnabled = true,
  archiveEnabled = true,
  scanIntervalSeconds = 30,
  onJumpToText,
  onInsertWikiLink,
  onWikiLinkSuggestionsChange,
}: Props) {
  const layout = useUIStore((s) => s.layout);
  const setLayout = useUIStore((s) => s.setLayout);
  const activeTab = layout.rightTab;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'notes', label: 'Notes' },
    { id: 'properties', label: 'Properties' },
    { id: 'ai', label: 'Assistant' },
  ];

  return (
    <div className="right-sidebar">
      <div className="sidebar-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`sidebar-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setLayout({ ...layout, rightTab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {activeTab === 'notes' && <NotesPanel />}
        {activeTab === 'properties' && <PropertiesPanel />}
        {activeTab === 'ai' && (
          <AiPanel
            writingAssistantEnabled={writingAssistantEnabled}
            archiveEnabled={archiveEnabled}
            scanIntervalSeconds={scanIntervalSeconds}
            onJumpToText={onJumpToText}
            onInsertWikiLink={onInsertWikiLink}
            onWikiLinkSuggestionsChange={onWikiLinkSuggestionsChange}
          />
        )}
      </div>
    </div>
  );
}
