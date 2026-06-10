import { useState, useId } from 'react';
import './SyncConflictModal.css';

export interface ResolvedConflictInfo {
  conflictPath: string;
  originalPath: string;
  provider: 'dropbox' | 'icloud' | 'syncthing';
  keptPath: string;
  archivedPath: string;
  resolvedAt: string;
}

export interface LockfileConflictInfo {
  hostname: string;
  pid: number;
  timestamp: string;
}

export interface SyncConflictModalProps {
  resolved: ResolvedConflictInfo[];
  lockfileConflict: LockfileConflictInfo | null;
  /** Called when user clicks Continue. `suppress` is true when "don't show again" is checked. */
  onContinue: (suppress: boolean) => void;
}

const PROVIDER_LABEL: Record<ResolvedConflictInfo['provider'], string> = {
  dropbox: 'Dropbox',
  icloud: 'iCloud',
  syncthing: 'Syncthing',
};

export default function SyncConflictModal({
  resolved,
  lockfileConflict,
  onContinue,
}: SyncConflictModalProps) {
  const [suppress, setSuppress] = useState(false);
  const checkboxId = useId();

  const hasConcurrentSession = lockfileConflict !== null;
  const hasConflicts = resolved.length > 0;

  return (
    <div
      className="scm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Sync conflict detected"
    >
      <div className="scm-dialog">
        <header className="scm-header">
          <h2 className="scm-title">Sync Conflict Detected</h2>
        </header>

        <div className="scm-body">
          {hasConcurrentSession && (
            <div className="scm-section scm-concurrent" role="alert">
              <strong>Concurrent session warning</strong>
              <p>
                Another Mythos Writer session appears to have this vault open
                (host: <code>{lockfileConflict.hostname}</code>, PID:{' '}
                <code>{lockfileConflict.pid}</code>). Editing from two sessions
                simultaneously may cause data loss.
              </p>
            </div>
          )}

          {hasConflicts && (
            <div className="scm-section">
              <p className="scm-lead">
                {resolved.length} conflict{resolved.length !== 1 ? 's' : ''} were
                automatically resolved using the <em>last-modified wins</em>{' '}
                rule. Older versions were moved to{' '}
                <code>.mythos/.archive/</code>.
              </p>
              <ul className="scm-file-list" aria-label="Resolved conflicts">
                {resolved.map((r) => (
                  <li key={r.conflictPath} className="scm-file-item">
                    <span className="scm-provider-badge scm-provider-badge--{r.provider}">
                      {PROVIDER_LABEL[r.provider]}
                    </span>
                    <span className="scm-file-kept" title={`Kept: ${r.keptPath}`}>
                      {r.keptPath}
                    </span>
                    <span className="scm-file-archived" title={`Archived: ${r.archivedPath}`}>
                      → archived older copy
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="scm-footer">
          <label className="scm-suppress-label" htmlFor={checkboxId}>
            <input
              id={checkboxId}
              type="checkbox"
              checked={suppress}
              onChange={(e) => setSuppress(e.target.checked)}
            />
            Don&apos;t show this warning for this vault
          </label>
          <button
            className="scm-btn scm-btn--continue"
            onClick={() => onContinue(suppress)}
            autoFocus
          >
            Continue
          </button>
        </footer>
      </div>
    </div>
  );
}
