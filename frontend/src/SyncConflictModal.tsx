import { useId, useState } from 'react';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from './components/ui/Dialog';
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
  const titleId = useId();
  const bodyId = useId();

  const hasConcurrentSession = lockfileConflict !== null;
  const hasConflicts = resolved.length > 0;

  return (
    <Dialog
      open
      onClose={() => onContinue(false)}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <DialogHeader>
        <h2 id={titleId}>Sync Conflict Detected</h2>
      </DialogHeader>

      <DialogBody id={bodyId} className="scm-body">
        {hasConcurrentSession && (
          <div className="scm-section scm-concurrent" role="alert">
            <strong>Another session is open</strong>
            <p>
              Mythos is also open on another device ({lockfileConflict.hostname}).
              Writing from two apps at the same time can mix up your work \u2014 close
              the other session before continuing.
            </p>
          </div>
        )}

        {hasConflicts && (
          <div className="scm-section">
            <p className="scm-lead">
              {resolved.length} file{resolved.length === 1 ? '' : 's'} had
              changes coming in from two places at the same time. Mythos kept
              the most recently edited version of each one. The older version
              {resolved.length === 1 ? ' is' : 's are'} saved in your vault
              archive (<code>.mythos/.archive/</code>) in case you need to
              recover them.
            </p>
            <ul className="scm-file-list" aria-label="Resolved conflicts">
              {resolved.map((r) => (
                <li key={r.conflictPath} className="scm-file-item">
                  <span className={`scm-provider-badge scm-provider-badge--${r.provider}`}>
                    {PROVIDER_LABEL[r.provider]}
                  </span>
                  <span className="scm-file-kept" title={r.keptPath}>
                    {r.keptPath.split('/').pop()}
                  </span>
                  <span
                    className="scm-file-archived"
                    title={`Older version saved to: ${r.archivedPath}`}
                  >
                    \u00b7 older version archived
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogBody>

      <DialogFooter className="scm-footer">
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
      </DialogFooter>
    </Dialog>
  );
}
