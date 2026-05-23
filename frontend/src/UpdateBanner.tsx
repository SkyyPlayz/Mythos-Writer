import { useEffect, useState } from 'react';
import './UpdateBanner.css';

type UpdateState = 'checking' | 'available' | 'not-available' | 'downloading' | 'ready';

interface UpdateEvent {
  state: UpdateState;
  version?: string;
  releaseNotes?: string | null;
}

export default function UpdateBanner() {
  const [event, setEvent] = useState<UpdateEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    const unsub = (window as Window).api?.onUpdateStatus?.((data) => {
      setEvent(data);
      setDismissed(false);
      setShowNotes(false);
    });
    return () => unsub?.();
  }, []);

  if (!event || dismissed || event.state === 'not-available' || event.state === 'checking') return null;

  const { state, version, releaseNotes } = event;

  const handleInstallNow = () => {
    (window as Window).api?.installUpdate?.(true);
  };

  const handleInstallOnQuit = () => {
    setDismissed(true);
  };

  const versionLabel = version ? ` (v${version})` : '';

  const messages: Record<Exclude<UpdateState, 'not-available' | 'checking'>, string> = {
    available: `New version available${versionLabel} — downloading…`,
    downloading: `Downloading update${versionLabel}…`,
    ready: `Update ready${versionLabel} — will install on next quit.`,
  };

  return (
    <div className={`update-banner update-banner--${state}`} role="status" aria-live="polite">
      <div className="update-banner__main">
        <span className="update-banner__msg">{messages[state as keyof typeof messages]}</span>
        <div className="update-banner__actions">
          {releaseNotes && (
            <button
              className="update-banner__notes-toggle"
              onClick={() => setShowNotes((v) => !v)}
              aria-expanded={showNotes}
            >
              {showNotes ? 'Hide notes' : 'Release notes'}
            </button>
          )}
          {state === 'ready' && (
            <>
              <button className="update-banner__install" onClick={handleInstallNow}>
                Restart &amp; Install
              </button>
              <button className="update-banner__defer" onClick={handleInstallOnQuit}>
                Install on Quit
              </button>
            </>
          )}
          <button className="update-banner__close" onClick={() => setDismissed(true)} aria-label="Dismiss">✕</button>
        </div>
      </div>
      {showNotes && releaseNotes && (
        <div className="update-banner__notes">
          <pre className="update-banner__notes-body">{releaseNotes}</pre>
        </div>
      )}
    </div>
  );
}
