import { useState, useCallback, useRef } from 'react';
import type { Scene, Story, Chapter } from './types';
import './RightSidebar.css';

type Tab = 'notes' | 'properties' | 'ai';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  selectedScene: Scene | null;
  selectedChapter: Chapter | null;
  selectedStory: Story | null;
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

function AiChatPanel({ scene }: { scene: Scene | null }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    try {
      const sceneContext = scene
        ? `Scene: "${scene.title}"\n\n${scene.blocks.map((b) => b.content).join('\n\n')}`
        : '';
      const payload = { prompt: text, context: sceneContext };
      const result = await (window as any).api?.brainstorm?.(payload);
      const reply =
        typeof result === 'string'
          ? result
          : result?.text ?? result?.content ?? 'No response from AI.';
      setMessages((m) => [...m, { role: 'ai', text: reply }]);
    } catch {
      setMessages((m) => [...m, { role: 'ai', text: '(AI unavailable — check your API key in Settings)' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, scene]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!scene && messages.length === 0) {
    return (
      <div className="sidebar-empty">
        <div className="sidebar-empty-icon">🤖</div>
        <p>Ask the Brainstormer anything.</p>
        <p className="sidebar-empty-sub">Select a scene to give it context, or just start a free-form conversation about your story.</p>
        <div className="ai-input-area">
          <textarea
            ref={inputRef}
            className="ai-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="What should happen next? What motivates this character?"
            rows={3}
          />
          <button className="ai-send-btn" onClick={send} disabled={!input.trim() || loading}>
            {loading ? '…' : 'Ask'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-chat-panel">
      <div className="ai-messages">
        {messages.length === 0 && (
          <div className="ai-welcome">
            <p>Brainstormer is ready.</p>
            {scene && <p className="ai-welcome-sub">Context: <em>{scene.title}</em></p>}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-message ai-message-${msg.role}`}>
            <div className="ai-message-bubble">{msg.text}</div>
          </div>
        ))}
        {loading && (
          <div className="ai-message ai-message-ai">
            <div className="ai-message-bubble ai-thinking">Thinking…</div>
          </div>
        )}
      </div>
      <div className="ai-input-area">
        <textarea
          ref={inputRef}
          className="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask anything about your story…"
          rows={3}
        />
        <button className="ai-send-btn" onClick={send} disabled={!input.trim() || loading}>
          {loading ? '…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}

export default function RightSidebar({ activeTab, onTabChange, selectedScene, selectedChapter, selectedStory }: Props) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'notes', label: 'Notes' },
    { id: 'properties', label: 'Properties' },
    { id: 'ai', label: 'AI' },
  ];

  return (
    <div className="right-sidebar">
      <div className="sidebar-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`sidebar-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {activeTab === 'notes' && <NotesPanel scene={selectedScene} />}
        {activeTab === 'properties' && (
          <PropertiesPanel scene={selectedScene} chapter={selectedChapter} story={selectedStory} />
        )}
        {activeTab === 'ai' && <AiChatPanel scene={selectedScene} />}
      </div>
    </div>
  );
}
