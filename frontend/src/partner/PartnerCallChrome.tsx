// Slice B — in-panel call chrome. The partner card *becomes* the call control
// (no second popup / no navigate-away). Spoken turns stay ordinary bubbles.

import { useCallback, useEffect, useState } from 'react';
import type { PartnerHandId } from '../agents/partnerIdentity';
import { partnerHandStatusLine } from '../agents/partnerIdentity';
import './PartnerCallChrome.css';

export interface PartnerCallState {
  onCall: boolean;
  muted: boolean;
  /** Where spoken turns go — mirrors settings agentTranscriptPlacement. */
  transcriptMode: 'stream' | 'panel';
  settingsOpen: boolean;
}

interface Props {
  partnerName: string;
  handBusy: PartnerHandId | null;
  call: PartnerCallState;
  onCallChange: (next: PartnerCallState) => void;
  onEndCall: () => void;
  /** Optional avatar glyph (emoji / letter). */
  avatar?: string;
}

export default function PartnerCallChrome({
  partnerName,
  handBusy,
  call,
  onCallChange,
  onEndCall,
  avatar = '✦',
}: Props) {
  const status = partnerHandStatusLine(handBusy, !!handBusy, call.onCall, call.muted);
  const [waveTick, setWaveTick] = useState(0);

  useEffect(() => {
    if (!call.onCall || call.muted) return;
    const id = window.setInterval(() => setWaveTick((t) => t + 1), 180);
    return () => window.clearInterval(id);
  }, [call.onCall, call.muted]);

  const startCall = useCallback(() => {
    onCallChange({ ...call, onCall: true, muted: false });
  }, [call, onCallChange]);

  const toggleMute = useCallback(() => {
    onCallChange({ ...call, muted: !call.muted });
  }, [call, onCallChange]);

  const toggleTranscript = useCallback(() => {
    onCallChange({
      ...call,
      transcriptMode: call.transcriptMode === 'stream' ? 'panel' : 'stream',
    });
  }, [call, onCallChange]);

  const toggleSettings = useCallback(() => {
    onCallChange({ ...call, settingsOpen: !call.settingsOpen });
  }, [call, onCallChange]);

  if (!call.onCall) {
    return (
      <section
        className="partner-card"
        data-testid="partner-card"
        aria-label={`${partnerName} partner card`}
      >
        <span className="partner-card__avatar" data-testid="partner-avatar" aria-hidden="true">{avatar}</span>
        <div className="partner-card__meta">
          <span className="partner-card__name">{partnerName}</span>
          <span className="partner-card__status" data-testid="partner-card-status">
            {status}
          </span>
        </div>
        <button
          type="button"
          className="partner-card__call-btn"
          data-testid="partner-start-call"
          aria-label="Start call"
          onClick={startCall}
        >
          <MicIcon />
        </button>
      </section>
    );
  }

  return (
    <section
      className={`partner-card partner-card--on-call${call.muted ? ' partner-card--muted' : ''}`}
      data-testid="partner-card"
      data-on-call="true"
      aria-label={`${partnerName} on a call`}
    >
      <span className="partner-card__avatar" data-testid="partner-avatar" aria-hidden="true">{avatar}</span>
      <div className="partner-card__meta">
        <span className="partner-card__name">{partnerName}</span>
        <span className="partner-card__status partner-card__status--call" data-testid="partner-card-status">
          {!call.muted && (
            <span className="partner-card__wave" aria-hidden="true" data-tick={waveTick}>
              <i /><i /><i /><i /><i />
            </span>
          )}
          {status}
        </span>
      </div>
      <div className="partner-card__call-actions">
        <button
          type="button"
          className={`partner-card__icon-btn${call.transcriptMode === 'panel' ? ' partner-card__icon-btn--active' : ''}`}
          data-testid="partner-call-transcript"
          aria-label={call.transcriptMode === 'panel' ? 'Transcript: separate panel' : 'Transcript: in chat'}
          aria-pressed={call.transcriptMode === 'panel'}
          onClick={toggleTranscript}
          title="Toggle live transcript placement"
        >
          Tx
        </button>
        <button
          type="button"
          className={`partner-card__icon-btn${call.muted ? ' partner-card__icon-btn--mute-on' : ''}`}
          data-testid="partner-call-mute"
          aria-label={call.muted ? 'Unmute' : 'Mute'}
          aria-pressed={call.muted}
          onClick={toggleMute}
        >
          {call.muted ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button
          type="button"
          className={`partner-card__icon-btn${call.settingsOpen ? ' partner-card__icon-btn--active' : ''}`}
          data-testid="partner-call-settings"
          aria-label="Call settings"
          aria-expanded={call.settingsOpen}
          onClick={toggleSettings}
        >
          ⚙
        </button>
        <button
          type="button"
          className="partner-card__end-btn"
          data-testid="partner-end-call"
          aria-label="End call"
          onClick={onEndCall}
        >
          End
        </button>
      </div>
      {call.settingsOpen && (
        <div className="partner-card__settings-pop" data-testid="partner-call-settings-pop" role="dialog" aria-label="Call voice settings">
          <label className="partner-card__settings-row">
            <span>Voice</span>
            <select defaultValue="default" aria-label="Voice">
              <option value="default">Default</option>
            </select>
          </label>
          <label className="partner-card__settings-row">
            <span>Speed</span>
            <select defaultValue="1" aria-label="Speed">
              <option value="0.8">0.8×</option>
              <option value="1">1×</option>
              <option value="1.2">1.2×</option>
            </select>
          </label>
          <label className="partner-card__settings-row">
            <span>Language</span>
            <select defaultValue="auto" aria-label="Language">
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
      )}
    </section>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
