import { useEffect, useState } from 'react';
import './UpdateBanner.css';

type UpdateState = 'checking' | 'available' | 'not-available' | 'downloading' | 'ready';

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unsub = (window as any).api?.onUpdateStatus?.((s: UpdateState) => {
      setState(s);
      setDismissed(false);
    });
    return () => unsub?.();
  }, []);

  if (!state || dismissed || state === 'not-available' || state === 'checking') return null;

  const messages: Record<Exclude<UpdateState, 'not-available' | 'checking'>, string> = {
    available: 'A new version is available — downloading…',
    downloading: 'Downloading update…',
    ready: 'Update ready.',
  };

  const handleInstall = () => {
    (window as any).api?.installUpdate?.();
  };

  return (
    <div className={`update-banner update-banner--${state}`} role="status">
      <span className="update-banner__msg">{messages[state as keyof typeof messages]}</span>
      {state === 'ready' && (
        <button className="update-banner__install" onClick={handleInstall}>
          Restart &amp; Install
        </button>
      )}
      <button className="update-banner__close" onClick={() => setDismissed(true)} aria-label="Dismiss">✕</button>
    </div>
  );
}
