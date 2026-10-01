import type { ReactNode } from 'react';
import logoUrl from './assets/logo.png';
import './WelcomeOverlay.css';

export type WelcomePathId = 'template' | 'blank' | 'import' | 'restore' | 'openin';

export interface WelcomePathCard {
  id: WelcomePathId;
  title: string;
  description: string;
  action: string;
  chip?: string;
  icon: ReactNode;
}

const PATH_CARDS: WelcomePathCard[] = [
  {
    id: 'template',
    title: 'Start from a template',
    description:
      'A ready structure — empty folders for Characters, Locations, Stories, Plot, Worldbuilding and Research. No notes, just the shape.',
    action: 'Use template →',
    chip: 'RECOMMENDED',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--n1,#00f0ff)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
      </svg>
    ),
  },
  {
    id: 'blank',
    title: 'Start blank',
    description: 'One empty vault. You build the structure yourself as you go.',
    action: 'Choose path →',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--n1,#00f0ff)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 3.5h7l4 4v13H7z" />
        <path d="M14 3.5v4h4" />
        <path d="M10.5 13.5h5M13 11v5" />
      </svg>
    ),
  },
  {
    id: 'import',
    title: 'Import vault',
    description: 'Point at an existing vault. A dry-run report shows every change before anything is written.',
    action: 'Pick folder →',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--n1,#00f0ff)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
        <path d="M12 11v5M9.8 13.2L12 11l2.2 2.2" />
      </svg>
    ),
  },
  {
    id: 'restore',
    title: 'Restore from backup',
    description: 'Bring back a synced vault from Mythos Cloud or a local snapshot.',
    action: 'Browse backups →',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--n1,#00f0ff)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 17H7a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.6 11a3 3 0 0 1 1.4 6z" />
      </svg>
    ),
  },
  {
    id: 'openin',
    title: 'Open Obsidian vault in Mythos',
    description:
      'Keep your Obsidian vault where it is. It becomes the Notes Vault; Mythos adds a Story Vault and its own files beside it.',
    action: 'Pick vault →',
    chip: 'IN PLACE',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--n1,#00f0ff)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
        <path d="M12 11v6M9 14h6" />
      </svg>
    ),
  },
];

/** Set by App on first-run (wizard complete/cancel); consumed once by DesktopShell. */
export const WELCOME_OVERLAY_OPEN_ONCE_KEY = 'mythos.openWelcomeOverlayOnce';

export const WELCOME_OVERLAY_DISMISSED_KEY = 'mythos.welcomeOverlayDismissed';

export function markWelcomeOverlayDismissed(): void {
  try {
    localStorage.setItem(WELCOME_OVERLAY_DISMISSED_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

/** First-run: App sets a one-shot session flag; title-bar opens via setState. */
export function shouldAutoOpenWelcomeOverlay(): boolean {
  try {
    if (sessionStorage.getItem(WELCOME_OVERLAY_OPEN_ONCE_KEY) === '1') {
      sessionStorage.removeItem(WELCOME_OVERLAY_OPEN_ONCE_KEY);
      return true;
    }
  } catch {
    /* non-fatal */
  }
  return false;
}

export function requestWelcomeOverlayOnNextShell(): void {
  try {
    sessionStorage.setItem(WELCOME_OVERLAY_OPEN_ONCE_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

interface WelcomeOverlayProps {
  onSkip: () => void;
  onPickPath: (id: WelcomePathId) => void;
  /**
   * First-run marker (`data-require-vault`). Probe #33 — Skip stays visible;
   * this flag no longer gates the Skip button.
   */
  requireVaultSetup?: boolean;
}

/** 09 §7 Welcome overlay — z70 path picker (Template · Blank · Import · Restore · Open Obsidian). */
export default function WelcomeOverlay({ onSkip, onPickPath, requireVaultSetup = false }: WelcomeOverlayProps) {
  // Probe #33 — Skip always visible (main parity). requireVaultSetup only
  // marks data-require-vault for first-run detection; it never hides Skip.
  return (
    <div
      className="welcome-overlay"
      data-testid="welcome-overlay"
      data-screen-label="Welcome"
      data-require-vault={requireVaultSetup ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Mythos Writer"
    >
      <div className="welcome-overlay__inner">
        <img src={logoUrl} alt="Mythos Writer" className="welcome-overlay__logo" />
        <div className="welcome-overlay__title">Mythos Writer</div>
        <div className="welcome-overlay__tagline">Write the world before you write the book.</div>

        <div className="welcome-overlay__grid" role="group" aria-label="Choose how to get started">
          {PATH_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              className="welcome-overlay__card"
              data-testid={`welcome-path-${card.id}`}
              onClick={() => onPickPath(card.id)}
            >
              {card.chip ? <span className="welcome-overlay__chip">{card.chip}</span> : null}
              <span className="welcome-overlay__card-icon">{card.icon}</span>
              <div className="welcome-overlay__card-title">{card.title}</div>
              <div className="welcome-overlay__card-desc">{card.description}</div>
              <div className="welcome-overlay__card-act">{card.action}</div>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="welcome-overlay__skip"
          data-testid="welcome-skip"
          onClick={onSkip}
        >
          Skip — continue to the app →
        </button>
      </div>
    </div>
  );
}
