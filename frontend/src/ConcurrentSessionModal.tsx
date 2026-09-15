import { useId, useState } from 'react';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from './components/ui/Dialog';
import './ConcurrentSessionModal.css';

export interface LockfileConflictInfo {
  hostname: string;
  pid: number;
  timestamp: string;
}

export interface ConcurrentSessionModalProps {
  lockfileConflict: LockfileConflictInfo;
  /** Called when user clicks Continue. `suppress` is true when "don't show again" is checked. */
  onContinue: (suppress: boolean) => void;
}

/**
 * Warns that a second Mythos session already holds this vault's lockfile.
 *
 * SKY-11804: this used to double as the branded cloud conflicted-copy report.
 * That half is gone with the rest of the cloud surface — the vault lockfile is
 * a local concern (a second app instance on this machine, or the same vault
 * reached over a network share), so the warning is now only about that.
 */
export default function ConcurrentSessionModal({
  lockfileConflict,
  onContinue,
}: ConcurrentSessionModalProps) {
  const [suppress, setSuppress] = useState(false);
  const checkboxId = useId();
  const titleId = useId();
  const bodyId = useId();

  return (
    <Dialog
      open
      onClose={() => onContinue(false)}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <DialogHeader>
        <h2 id={titleId}>Another Session Is Open</h2>
      </DialogHeader>

      <DialogBody id={bodyId} className="scm-body">
        <div className="scm-section scm-concurrent" role="alert">
          <strong>This vault is already open elsewhere</strong>
          <p>
            Mythos Writer is also running on <code>{lockfileConflict.hostname}</code> with
            this vault open. Writing from two apps at the same time can mix up your
            work — close the other session before continuing.
          </p>
        </div>
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
