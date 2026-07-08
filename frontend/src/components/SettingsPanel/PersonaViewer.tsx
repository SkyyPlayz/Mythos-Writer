// PersonaViewer — per-agent identity file editor.
//
// MYT-816 shipped this read-only (view + reset). Beta 3 M22 makes it the
// prototype's "Identity & files" surface (HTML 1848–1868): every agent carries
// four editable identity files — agent.md / instructions.md / learning.md /
// soul.md — stored as persona-key overrides in the app dir and injected into
// that agent's system prompt. tools.md stays visible as a descriptive fifth
// file (never injected).

import { useState, useEffect, useCallback, useRef } from 'react';
import { IDENTITY_FILES, type NamedAgentId } from '../../agents/agentIdentity';

interface PersonaTab {
  key: string;
  fileName: string;
}

const PERSONA_TABS: PersonaTab[] = [
  ...IDENTITY_FILES.map((f) => ({ key: f.key, fileName: f.fileName })),
  { key: 'TOOLS', fileName: 'tools.md' },
];

interface PersonaFileState {
  content: string;
  isCustom: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY_FILE: PersonaFileState = { content: '', isCustom: false, loading: false, error: null };

function emptyFiles(): Record<string, PersonaFileState> {
  return Object.fromEntries(PERSONA_TABS.map((t) => [t.key, { ...EMPTY_FILE }]));
}

export default function PersonaViewer({ agentName }: { agentName: NamedAgentId }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(PERSONA_TABS[0].key);
  const tablistRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<Record<string, PersonaFileState>>(emptyFiles);
  // M22: draft holds unsaved edits for the active tab; null = no edit session.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const loadFile = useCallback(async (key: string) => {
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
    for (const tab of PERSONA_TABS) loadFile(tab.key);
  }, [open, loadFile]);

  // Switching tabs discards any unsaved draft (matches the prototype, where
  // opening another file chip replaces the open editor).
  const selectTab = useCallback((key: string) => {
    setActiveTab(key);
    setDraft(null);
    setSavedOk(false);
  }, []);

  const handleSave = async () => {
    if (draft === null) return;
    setBusy(true);
    setSavedOk(false);
    try {
      await window.api.agentPersonaWrite(agentName, activeTab, draft);
      setDraft(null);
      await loadFile(activeTab);
      setSavedOk(true);
    } catch (err) {
      setFiles((prev) => ({
        ...prev,
        [activeTab]: { ...prev[activeTab], error: (err as Error).message },
      }));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (key: string) => {
    setBusy(true);
    setSavedOk(false);
    try {
      await window.api.agentPersonaReset(agentName, key);
      setDraft(null);
      await loadFile(key);
    } finally {
      setBusy(false);
    }
  };

  const file = files[activeTab];
  const activeFileName = PERSONA_TABS.find((t) => t.key === activeTab)?.fileName ?? activeTab;

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const keys = PERSONA_TABS.map((t) => t.key);
    const idx = keys.indexOf(activeTab);
    const next = e.key === 'ArrowRight'
      ? keys[(idx + 1) % keys.length]
      : keys[(idx + keys.length - 1) % keys.length];
    selectTab(next);
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
        Identity &amp; files
      </button>
      {open && (
        <div className="settings-persona-panel">
          <p className="settings-help-text">
            These files shape the agent. agent.md, instructions.md, learning.md and
            soul.md are injected into every prompt; tools.md is descriptive only.
          </p>
          <div className="settings-persona-tabs" role="tablist" aria-label="Identity file tabs" ref={tablistRef} onKeyDown={handleTabKeyDown}>
            {PERSONA_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`persona-tab-${agentName}-${tab.key}`}
                data-tabkey={tab.key}
                aria-selected={activeTab === tab.key}
                aria-controls={panelId}
                tabIndex={activeTab === tab.key ? 0 : -1}
                className={`settings-persona-tab${activeTab === tab.key ? ' settings-persona-tab--active' : ''}`}
                onClick={() => selectTab(tab.key)}
              >
                {tab.fileName}
                {files[tab.key].isCustom && (
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
                      disabled={busy}
                      onClick={() => handleReset(activeTab)}
                    >
                      Reset to default
                    </button>
                  </div>
                )}
                <textarea
                  className="settings-persona-textarea"
                  value={draft ?? file.content}
                  onChange={(e) => { setDraft(e.target.value); setSavedOk(false); }}
                  aria-label={`${agentName} ${activeFileName} content`}
                  spellCheck={false}
                  data-testid={`persona-editor-${agentName}`}
                />
                <div className="settings-persona-actions">
                  <button
                    type="button"
                    className="settings-btn"
                    disabled={busy || draft === null || draft === file.content}
                    onClick={handleSave}
                    data-testid={`persona-save-${agentName}`}
                  >
                    Save file
                  </button>
                  {savedOk && <span className="settings-persona-custom-label" role="status">Saved ✓</span>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
