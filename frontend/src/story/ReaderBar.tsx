// Beta 4 M11 — the two Reader surfaces, refined to the v2 prototype:
//
//   · ReaderCard — the right-gutter Reader dock (prototype 1155–1183):
//     header + close, transport (prev scene · -10s · play disc · +10s ·
//     next scene), From cursor / From start, speed 50–200%, voice select,
//     status line "… · highlight follows". Docks above the comment cards
//     when they're visible; the gutter centers it when they're hidden.
//
//   · ReaderBar (default) — the Book-preview audiobook bar (prototype
//     849–867): the same transport plus status, speed slider, voice select
//     and From start in one horizontal glass bar.
//
// Both drive the same useManuscriptReader instance; voice picks that name an
// engine that isn't set up toast their setupHint and keep playing with the
// default voice (§1.2 "nothing is dead").

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  listReaderVoices,
  readerVoiceSetupHint,
  type ReaderTtsSettings,
} from './readerVoices';
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

const SPEAKER_ICON = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 10v4h4l5 4V6l-5 4z" />
    <path d="M16.5 9a4 4 0 0 1 0 6" />
  </svg>
);

/** Shared reader plumbing: async voice enumeration + guarded actions. */
function useReaderControls(reader: ManuscriptReader, ttsSettings?: ReaderTtsSettings) {
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
      !reader.hasContent()
        ? 'Nothing to read yet — this book has no scenes with prose'
        : reader.muted
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

  // §1.2 "nothing is dead": voices whose engine isn't set up explain
  // themselves on pick (prototype voiceChange toast) and playback falls
  // back to the default voice via resolveReaderVoiceId.
  const handleVoiceChange = (value: string) => {
    reader.setVoiceId(value);
    const hint = readerVoiceSetupHint(value);
    if (hint) showLnToast(hint);
  };

  return { voiceOptions, handleToggle, handlePlayFrom, handleVoiceChange };
}

/** The prev-scene · -10s · play · +10s · next-scene cluster (shared). */
function TransportControls({ reader, onToggle }: { reader: ManuscriptReader; onToggle: () => void }) {
  return (
    <>
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
        title="Back ~10s"
        onClick={() => reader.skipTime(-1)}
      >
        -10s
      </button>
      <button
        type="button"
        className="msv-reader-play"
        data-testid="msv-reader-play"
        aria-label={reader.playing ? 'Pause reading' : 'Play'}
        onClick={onToggle}
      >
        {reader.playing ? PAUSE_ICON : PLAY_ICON}
      </button>
      <button
        type="button"
        className="msv-reader-nav msv-reader-nav--wide"
        data-testid="msv-reader-fwd"
        title="Forward ~10s"
        onClick={() => reader.skipTime(1)}
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
    </>
  );
}

function VoiceSelect({
  reader,
  options,
  onChange,
}: {
  reader: ManuscriptReader;
  options: ReturnType<typeof listReaderVoices>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="msv-reader-voice"
      data-testid="msv-reader-voice"
      aria-label="Reader voice"
      value={reader.voiceId}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((v) => (
        <option key={v.value} value={v.value} title={v.setupHint}>
          {v.label}
        </option>
      ))}
    </select>
  );
}

function RateSlider({ reader }: { reader: ManuscriptReader }) {
  return (
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
  );
}

function RateReadout({ reader }: { reader: ManuscriptReader }) {
  return (
    <span className="msv-reader-rate-readout" data-testid="msv-reader-rate-readout">
      {Math.round(reader.rate * 100)}%
    </span>
  );
}

/**
 * The right-gutter Reader card (prototype 1155–1183). ManuscriptView slots it
 * into the comments gutter: docked above the comment cards when they're
 * visible, centered by the gutter when they're hidden.
 */
export function ReaderCard({ reader, ttsSettings }: ReaderBarProps): ReactNode {
  const { voiceOptions, handleToggle, handlePlayFrom, handleVoiceChange } = useReaderControls(
    reader,
    ttsSettings
  );

  return (
    <section className="msv-reader-card" data-testid="msv-reader-card" aria-label="Reader">
      <div className="msv-reader-card-head">
        <span className="msv-reader-card-icon">{SPEAKER_ICON}</span>
        <span className="msv-reader-card-title">Reader</span>
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
      <div className="msv-reader-card-transport">
        <TransportControls reader={reader} onToggle={handleToggle} />
      </div>
      <div className="msv-reader-card-jumps">
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
      </div>
      <RateSlider reader={reader} />
      <div className="msv-reader-card-voicerow">
        <VoiceSelect reader={reader} options={voiceOptions} onChange={handleVoiceChange} />
        <RateReadout reader={reader} />
      </div>
      <div className="msv-reader-card-status" data-testid="msv-reader-status" aria-live="polite">
        {reader.status} · highlight follows
      </div>
    </section>
  );
}

/**
 * The Book-preview audiobook bar (prototype 849–867): persistent under the
 * compiled pages — transport, status, speed, voice, From start.
 */
export default function ReaderBar({ reader, ttsSettings }: ReaderBarProps) {
  const { voiceOptions, handleToggle, handlePlayFrom, handleVoiceChange } = useReaderControls(
    reader,
    ttsSettings
  );

  return (
    <div
      className="msv-reader-bar"
      data-testid="msv-reader-bar"
      role="toolbar"
      aria-label="Audiobook reader"
    >
      <TransportControls reader={reader} onToggle={handleToggle} />
      <span className="msv-reader-status" data-testid="msv-reader-status" aria-live="polite">
        {reader.status}
      </span>
      <div className="msv-reader-spacer" />
      <RateReadout reader={reader} />
      <RateSlider reader={reader} />
      <VoiceSelect reader={reader} options={voiceOptions} onChange={handleVoiceChange} />
      <button
        type="button"
        className="msv-reader-jump"
        data-testid="msv-reader-from-start"
        title="Read from the start"
        onClick={() => handlePlayFrom(false)}
      >
        From start
      </button>
    </div>
  );
}
