import { useState, useEffect } from 'react';
import './WindowChrome.css';

type Platform = string | null;

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" rx="1" />
    </svg>
  );
}

interface WindowControlsProps {
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  isMac: boolean;
}

function WindowControls({ onClose, onMinimize, onMaximize, isMac }: WindowControlsProps) {
  if (isMac) {
    return (
      <div className="wc-controls wc-controls-left" data-testid="wc-controls">
        <button className="wc-btn wc-btn-close" onClick={onClose} aria-label="Close window" title="Close">
          <CloseIcon />
        </button>
        <button className="wc-btn wc-btn-minimize" onClick={onMinimize} aria-label="Minimize window" title="Minimize">
          <MinimizeIcon />
        </button>
        <button className="wc-btn wc-btn-maximize" onClick={onMaximize} aria-label="Maximize window" title="Maximize">
          <MaximizeIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="wc-controls wc-controls-right" data-testid="wc-controls">
      <button className="wc-btn wc-btn-minimize" onClick={onMinimize} aria-label="Minimize window" title="Minimize">
        <MinimizeIcon />
      </button>
      <button className="wc-btn wc-btn-maximize" onClick={onMaximize} aria-label="Maximize window" title="Maximize">
        <MaximizeIcon />
      </button>
      <button className="wc-btn wc-btn-close" onClick={onClose} aria-label="Close window" title="Close">
        <CloseIcon />
      </button>
    </div>
  );
}

export default function WindowChrome() {
  const [platform, setPlatform] = useState<Platform>(null);

  useEffect(() => {
    window.api?.getAppInfo?.()
      .then((info) => { setPlatform(info.platform); })
      .catch(() => {});
  }, []);

  const isMac = platform === 'darwin';

  const handleClose = () => { void window.api?.windowClose?.(); };
  const handleMinimize = () => { void window.api?.windowMinimize?.(); };
  const handleMaximize = () => { void window.api?.windowMaximize?.(); };

  return (
    <div className="wc-bar" role="banner" aria-label="Window chrome">
      <div className="wc-drag-region">
        {isMac && (
          <WindowControls
            onClose={handleClose}
            onMinimize={handleMinimize}
            onMaximize={handleMaximize}
            isMac={isMac}
          />
        )}
        <span className="wc-title" aria-hidden="true">Mythos Writer</span>
        {!isMac && (
          <WindowControls
            onClose={handleClose}
            onMinimize={handleMinimize}
            onMaximize={handleMaximize}
            isMac={isMac}
          />
        )}
      </div>
    </div>
  );
}
