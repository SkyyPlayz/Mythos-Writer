import { useState, useCallback, useRef, useEffect } from 'react';
import type { Scene } from './types';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import './VaultAgentPanel.css';

interface Props {
  scene: Scene | null;
  enabled?: boolean;
}

export default function VaultAgentPanel({ scene, enabled = true }: Props) {
  const [checking, setChecking] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [inconsistencies, setInconsistencies] = useState<VaultCheckInconsistency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const { announce, liveText } = useLiveAnnounce();

  useEffect(() => {
    return () => { unsubRef.current?.(); };
  }, []);

  const runCheck = useCallback(async () => {
    if (!scene || checking) return;

    const sceneContent = scene.blocks.map((b) => b.content).join('\n\n').trim();
    if (!sceneContent) {
      setError('Scene has no content to check.');
      return;
    }

    setChecking(true);
    setError(null);
    setStreamText('');
    setInconsistencies([]);
    announce('Checking continuity…');

    unsubRef.current?.();
    unsubRef.current = window.api.onVaultCheckChunk((chunk) => {
      setStreamText((prev) => prev + chunk);
    });

    try {
      const result = await window.api.agentVaultCheck(sceneContent);
      setStreamText(result.text);
      setInconsistencies(result.inconsistencies);
      setLastChecked(new Date());
      const issueCount = result.inconsistencies.filter((i: VaultCheckInconsistency) => i.status === 'proposed').length;
      announce(issueCount === 0 ? 'Check complete. No inconsistencies found.' : `Check complete. ${issueCount} issue${issueCount !== 1 ? 's' : ''} found.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorMsg = msg || 'Vault Agent unavailable — check your API key in settings.';
      setError(errorMsg);
      announce(`Error: ${errorMsg}`);
    } finally {
      unsubRef.current?.();
      unsubRef.current = null;
      setChecking(false);
    }
  }, [scene, checking, announce]);

  const dismiss = (id: string) => {
    setInconsistencies((prev) =>
      prev.map((item) => item.id === id ? { ...item, status: 'dismissed' } : item)
    );
  };

  const activeIssues = inconsistencies.filter((i) => i.status === 'proposed');
  const dismissedCount = inconsistencies.filter((i) => i.status === 'dismissed').length;

  if (!enabled) {
    return (
      <div className="vault-agent-panel vault-agent-disabled">
        <p className="vault-agent-disabled-msg">Archive Agent is disabled. Enable it in Settings.</p>
      </div>
    );
  }

  return (
    <div className="vault-agent-panel">
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveText}
      </span>

      <div className="va-header">
        <div className="va-title">Vault Agent</div>
        <p className="va-subtitle">Check the current scene for continuity errors against vault facts.</p>
      </div>

      <button
        className="va-check-btn"
        onClick={runCheck}
        disabled={!scene || checking}
        aria-label="Check continuity"
      >
        {checking ? 'Checking…' : 'Check Continuity'}
      </button>

      {!scene && (
        <div className="va-empty">Select a scene to run a continuity check.</div>
      )}

      {checking && streamText && (
        <div className="va-stream" aria-hidden="true">
          <div className="va-stream-text">{streamText}<span className="va-cursor" aria-hidden="true">▍</span></div>
        </div>
      )}

      {error && (
        <div className="va-error" role="alert">{error}</div>
      )}

      {!checking && inconsistencies.length > 0 && (
        <div className="va-results">
          {activeIssues.length === 0 ? (
            <div className="va-clean">
              No inconsistencies found.
              {dismissedCount > 0 && <span className="va-dismissed-count"> ({dismissedCount} dismissed)</span>}
            </div>
          ) : (
            <div className="va-issues">
              <div className="va-issues-header">{activeIssues.length} issue{activeIssues.length !== 1 ? 's' : ''} found</div>
              {activeIssues.map((issue) => (
                <div key={issue.id} className="va-issue-card">
                  <div className="va-issue-entity">{issue.entityName}</div>
                  <div className="va-issue-text">{issue.text}</div>
                  <div className="va-issue-meta">
                    <span className="va-badge">vault-agent</span>
                    <span className="va-timestamp">{new Date(issue.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <button
                    className="va-dismiss-btn"
                    onClick={() => dismiss(issue.id)}
                    aria-label={`Dismiss issue for ${issue.entityName}`}
                  >
                    Dismiss
                  </button>
                </div>
              ))}
              {dismissedCount > 0 && (
                <div className="va-dismissed-count">{dismissedCount} dismissed</div>
              )}
            </div>
          )}
        </div>
      )}

      {!checking && inconsistencies.length === 0 && lastChecked && !error && (
        <div className="va-clean">No inconsistencies found.</div>
      )}

      {lastChecked && !checking && (
        <div className="va-last-checked">
          Last checked: {lastChecked.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
