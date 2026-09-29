/**
 * Slice D — Settings › Agents Vault card (Reveal / Clear agent memory / Move…).
 * Partner identity files live under Agent Vault/; Clear never deletes partner.md / hands.
 */
import { useCallback, useEffect, useState } from 'react';
import { M24Card } from './M24Controls';
import './M24Sections.css';

interface AgentsStats {
  path: string;
  name: string;
  files: number;
  chips: string[];
  scope: string;
}

export default function AgentsVaultSection() {
  const [stats, setStats] = useState<AgentsStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(() => {
    window.api?.agentsVaultEnsure?.().catch(() => { /* non-fatal */ });
    window.api?.agentsVaultStats?.()
      .then((res) => {
        if (res && res.ok && res.path) {
          setStats({
            path: res.path,
            name: res.name ?? 'Agent Vault',
            files: res.files ?? 0,
            chips: res.chips ?? [],
            scope: res.scope ?? 'This vault',
          });
        }
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onReveal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.api?.agentsVaultReveal?.();
      if (res && !res.opened) setError(res.error || 'Could not reveal folder');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reveal failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const onClear = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await window.api?.agentsVaultClearMemory?.();
      if (!res?.ok) {
        setError(res?.error || 'Clear failed');
      } else {
        setStatus(`Cleared agent memory (${res.removed?.length ?? 0} items). Partner files kept.`);
        setConfirmClear(false);
        refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clear failed');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onMove = useCallback(() => {
    setStatus('Move… uses Vaults folder Move for the whole Mythos vault — Agents Vault travels with it.');
  }, []);

  return (
    <section
      className="settings-section m24-root"
      aria-labelledby="section-agents-vault"
      data-settings-cat="vaults"
      data-testid="agents-vault-section"
      data-screen-label="Agents Vault"
    >
      <M24Card title="Agent Vault">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px 8px', flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#eef2fb', flex: '1 1 110px', minWidth: 0 }}>
            Agent Vault
          </span>
          <span
            style={{
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.09em', flex: '0 1 auto',
              borderRadius: 5, padding: '2px 7px', color: 'var(--n2,#9b5fff)',
              border: 'var(--bw,1px) solid var(--b2,rgba(155,95,255,.45))',
            }}
            data-testid="agents-vault-scope"
          >
            {stats?.scope ?? 'This vault'}
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#8e9db8', margin: '2px 0 8px', lineHeight: 1.55 }}>
          Everything the agents write lives here instead of your Notes Vault — chat history, the continuity
          index, embeddings and pending suggestions. One per Mythos vault, so nothing leaks between worlds.
          Identity files: partner.md · writer.md · analyst.md · archivist.md.
        </div>
        <div
          style={{
            padding: '11px 12px', borderRadius: 12, background: 'rgba(255,255,255,.03)',
            border: 'var(--bw,1px) solid var(--b2,rgba(155,95,255,.35))',
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#e6ecf9' }}>{stats?.name ?? 'Agent Vault'}</div>
          <div style={{ fontSize: 9.5, color: '#7f8ea8', marginTop: 2 }} data-testid="agents-vault-stats">
            {stats ? `${stats.files} files` : '…'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
            <span
              className="m24-path"
              title={stats?.path}
              data-testid="agents-vault-path"
              style={{ flex: 1, minWidth: 0 }}
            >
              {stats?.path ?? '—'}
            </span>
            <button
              type="button"
              className="m24-btn"
              data-testid="agents-vault-reveal"
              onClick={() => { void onReveal(); }}
              disabled={busy || !stats}
              title="Open this folder in Explorer"
            >
              Reveal
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
            {(stats?.chips ?? ['partner.md', 'Writer', 'Analyst', 'Archivist']).map((c) => (
              <span
                key={c}
                style={{
                  fontSize: 9, fontWeight: 600, color: '#aebad0',
                  border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, padding: '2px 6px',
                }}
              >
                {c}
              </span>
            ))}
          </div>
          <div
            style={{
              display: 'flex', gap: 6, marginTop: 9, paddingTop: 9,
              borderTop: '1px solid rgba(255,255,255,.07)', flexWrap: 'wrap',
            }}
          >
            {!confirmClear ? (
              <button
                type="button"
                data-testid="agents-vault-clear"
                onClick={() => setConfirmClear(true)}
                disabled={busy}
                style={{
                  padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(255,107,138,.4)',
                  color: '#ff6b8a', fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'transparent',
                }}
              >
                Clear agent memory
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="agents-vault-clear-confirm"
                  onClick={() => { void onClear(); }}
                  disabled={busy}
                  style={{
                    padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(255,107,138,.5)',
                    color: '#ff9db4', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    background: 'rgba(255,107,138,.1)',
                  }}
                >
                  Confirm clear
                </button>
                <button
                  type="button"
                  className="m24-btn"
                  onClick={() => setConfirmClear(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </>
            )}
            <button
              type="button"
              data-testid="agents-vault-move"
              onClick={onMove}
              disabled={busy}
              style={{
                padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,.13)',
                color: '#8e9db8', fontSize: 10, cursor: 'pointer', background: 'transparent',
              }}
            >
              Move…
            </button>
          </div>
        </div>
        {status && <p className="settings-hint" data-testid="agents-vault-status" style={{ marginTop: 8 }}>{status}</p>}
        {error && <p className="settings-error-msg" role="alert" style={{ marginTop: 8 }}>{error}</p>}
      </M24Card>
    </section>
  );
}
