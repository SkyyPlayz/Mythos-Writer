import { useState, useEffect, useCallback, useRef } from 'react';

type PersonaKey = 'AGENTS' | 'HEARTBEAT' | 'SOUL' | 'TOOLS';
const PERSONA_KEYS: PersonaKey[] = ['AGENTS', 'HEARTBEAT', 'SOUL', 'TOOLS'];

interface PersonaFileState {
  content: string;
  isCustom: boolean;
  loading: boolean;
  error: string | null;
}

export default function PersonaViewer({ agentName }: { agentName: 'writingAssistant' | 'brainstorm' }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PersonaKey>('AGENTS');
  const tablistRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<Record<PersonaKey, PersonaFileState>>({
    AGENTS:    { content: '', isCustom: false, loading: false, error: null },
    HEARTBEAT: { content: '', isCustom: false, loading: false, error: null },
    SOUL:      { content: '', isCustom: false, loading: false, error: null },
    TOOLS:     { content: '', isCustom: false, loading: false, error: null },
  });
  const [resetBusy, setResetBusy] = useState(false);

  const loadFile = useCallback(async (key: PersonaKey) => {
    setFiles((prev) => ({ ...prev, [key]: { ...prev[key], loading: true, error: null } }));
    try {
      const res = await window.api.agentPersonaRead(agentName, key) as { content: string; isCustom: boolean };
      setFiles((prev) => ({ ...prev, [key]: { content: res.content, isCustom: res.isCustom, loading: false, error: null } }));
    } catch (err) {
      setFiles((prev) => ({ ...prev, [key]: { ...prev[key], loading: false, error: (err as Error).message } }));
    }
  }, [agentName]);

  useEffect(() => {
    if (!open) return;
    for (const key of PERSONA_KEYS) loadFile(key);
  }, [open, loadFile]);

  const handleReset = async (key: PersonaKey) => {
    setResetBusy(true);
    try {
      await window.api.agentPersonaReset(agentName, key);
      await loadFile(key);
    } finally {
      setResetBusy(false);
    }
  };

  const file = files[activeTab];

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const idx = PERSONA_KEYS.indexOf(activeTab);
    const next = e.key === 'ArrowRight'
      ? PERSONA_KEYS[(idx + 1) % PERSONA_KEYS.length]
      : PERSONA_KEYS[(idx + PERSONA_KEYS.length - 1) % PERSONA_KEYS.length];
    setActiveTab(next);
    e.preventDefault();
    const btn = tablistRef.current?.querySelector<HTMLElement>(`[data-tabkey="${next}"]`);
    btn?.focus();
  };

  const panelId = `persona-panel-${agentName}`;

  return (
    <div className="settings-persona-viewer">
      <button
        type="button"
        className="settings-persona-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="settings-persona-chevron">{open ? '▾' : '▸'}</span>
        Persona files
      </button>
      {open && (
        <div className="settings-persona-panel">
          <div className="settings-persona-tabs" role="tablist" aria-label="Persona file tabs" ref={tablistRef} onKeyDown={handleTabKeyDown}>
            {PERSONA_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`persona-tab-${agentName}-${key}`}
                data-tabkey={key}
                aria-selected={activeTab === key}
                aria-controls={panelId}
                tabIndex={activeTab === key ? 0 : -1}
                className={`settings-persona-tab${activeTab === key ? ' settings-persona-tab--active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {key}.md
                {files[key].isCustom && (
                  <span className="settings-persona-custom-badge" title="Custom override">●</span>
                )}
              </button>
            ))}
          </div>
          <div id={panelId} className="settings-persona-content" role="tabpanel" aria-labelledby={`persona-tab-${agentName}-${activeTab}`}>
            {file.loading && <p className="settings-persona-loading">Loading…</p>}
            {file.error && <p className="settings-persona-error">{file.error}</p>}
            {!file.loading && !file.error && (
              <>
                {file.isCustom && (
                  <div className="settings-persona-actions">
                    <span className="settings-persona-custom-label">Custom</span>
                    <button
                      type="button"
                      className="settings-persona-reset-btn"
                      disabled={resetBusy}
                      onClick={() => handleReset(activeTab)}
                    >
                      Reset to default
                    </button>
                  </div>
                )}
                <textarea
                  className="settings-persona-textarea"
                  readOnly
                  value={file.content}
                  aria-label={`${agentName} ${activeTab}.md content`}
                  spellCheck={false}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
