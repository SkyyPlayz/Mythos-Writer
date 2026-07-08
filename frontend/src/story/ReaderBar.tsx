// Beta 3 M13 — audiobook bar (prototype 641–658 Book-preview bar, controls
// shared with the gutter Reader dock 913–943: play/pause on the gradient
// disc, ∓10s = ±utterance, ±scene skips, position, speed 50–200%, voice
// picker, From cursor / From start, close).

import { useEffect, useMemo, useState } from 'react';
import { listReaderVoices, type ReaderTtsSettings } from './readerVoices';
import type { ManuscriptReader } from './useManuscriptReader';
import { showLnToast } from '../theme/lnToast';
import './ReaderBar.css';

export interface ReaderBarProps {
  reader: ManuscriptReader;
  ttsSettings?: ReaderTtsSettings;
}

const SCENE_PREV_ICON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />
  </svg>
);

const SCENE_NEXT_ICON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 6l6 6-6 6M13 6l6 6-6 6" />
  </svg>
);

const PLAY_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginLeft: 2 }}>
    <path d="M7 4.8v14.4L19.2 12z" />
  </svg>
);

const PAUSE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="7" y="5.5" width="3.4" height="13" rx="1" />
    <rect x="13.6" y="5.5" width="3.4" height="13" rx="1" />
  </svg>
);

const CLOSE_ICON = (
  <svg
    width="10"
    height="10"
    viewBox="0 0 12 12"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
  </svg>
);

export default function ReaderBar({ reader, ttsSettings }: ReaderBarProps) {
  // Chromium populates getVoices() asynchronously — refresh on voiceschanged.
  const [voicesVersion, setVoicesVersion] = useState(0);
  useEffect(() => {
    const synth = (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    if (!synth?.addEventListener) return;
    const bump = () => setVoicesVersion((v) => v + 1);
    synth.addEventListener('voiceschanged', bump);
    return () => synth.removeEventListener('voiceschanged', bump);
  }, []);

  const voiceOptions = useMemo(() => {
    void voicesVersion; // re-enumerate when the OS voice list loads
    return listReaderVoices(ttsSettings, reader.voiceId || undefined);
  }, [ttsSettings, reader.voiceId, voicesVersion]);

  const explainSilence = () => {
    showLnToast(
      reader.muted
        ? 'Voice is muted — unmute it to listen'
        : 'Voice unavailable — configure a TTS engine in Settings'
    );
  };

  const handleToggle = () => {
    if (!reader.toggle()) explainSilence();
  };

  const handlePlayFrom = (fromCursor: boolean) => {
    if (!reader.playFrom({ fromCursor })) explainSilence();
  };

  const maxIdx = Math.max(0, reader.flowLength - 1);

  return (
    <div
      className="msv-reader-bar"
      data-testid="msv-reader-bar"
      role="toolbar"
      aria-label="Audiobook reader"
    >
      <button
        type="button"
        className="msv-reader-nav"
        data-testid="msv-reader-prev-scene"
        title="Previous scene"
        onClick={() => reader.skipScene(-1)}
      >
        {SCENE_PREV_ICON}
      </button>
      <button
        type="button"
        className="msv-reader-nav msv-reader-nav--wide"
        data-testid="msv-reader-back"
        title="Back one passage (~10s)"
        onClick={() => reader.skip(-1)}
      >
        -10s
      </button>
      <button
        type="button"
        className="msv-reader-play"
        data-testid="msv-reader-play"
        aria-label={reader.playing ? 'Pause reading' : 'Play'}
        onClick={handleToggle}
      >
        {reader.playing ? PAUSE_ICON : PLAY_ICON}
      </button>
      <button
        type="button"
        className="msv-reader-nav msv-reader-nav--wide"
        data-testid="msv-reader-fwd"
        title="Forward one passage (~10s)"
        onClick={() => reader.skip(1)}
      >
        +10s
      </button>
      <button
        type="button"
        className="msv-reader-nav"
        data-testid="msv-reader-next-scene"
        title="Next scene"
        onClick={() => reader.skipScene(1)}
      >
        {SCENE_NEXT_ICON}
      </button>
      <span className="msv-reader-status" data-testid="msv-reader-status" aria-live="polite">
        {reader.status}
      </span>
      <input
        type="range"
        className="msv-reader-pos"
        data-testid="msv-reader-pos"
        aria-label="Reading position"
        min={0}
        max={maxIdx}
        value={Math.min(reader.idx, maxIdx)}
        disabled={reader.flowLength === 0}
        onChange={(e) => reader.seek(Number(e.target.value))}
      />
      <div className="msv-reader-spacer" />
      <span className="msv-reader-rate-readout" data-testid="msv-reader-rate-readout">
        {Math.round(reader.rate * 100)}%
      </span>
      <input
        type="range"
        className="msv-reader-rate"
        data-testid="msv-reader-rate"
        aria-label="Reading speed"
        min={50}
        max={200}
        value={Math.round(reader.rate * 100)}
        onChange={(e) => reader.setRate(Number(e.target.value) / 100)}
      />
      <select
        className="msv-reader-voice"
        data-testid="msv-reader-voice"
        aria-label="Reader voice"
        value={reader.voiceId}
        onChange={(e) => reader.setVoiceId(e.target.value)}
      >
        {voiceOptions.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="msv-reader-jump"
        data-testid="msv-reader-from-cursor"
        title="Read from the current scene"
        onClick={() => handlePlayFrom(true)}
      >
        From cursor
      </button>
      <button
        type="button"
        className="msv-reader-jump msv-reader-jump--dim"
        data-testid="msv-reader-from-start"
        title="Read from the start"
        onClick={() => handlePlayFrom(false)}
      >
        From start
      </button>
      <button
        type="button"
        className="msv-reader-close"
        data-testid="msv-reader-close"
        aria-label="Close reader"
        onClick={reader.close}
      >
        {CLOSE_ICON}
      </button>
    </div>
  );
}
