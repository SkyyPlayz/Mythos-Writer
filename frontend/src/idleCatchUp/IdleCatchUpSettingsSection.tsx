/**
 * PLAN-IDLE-CATCH-UP — Settings → Editor → Idle catch-up.
 *
 * Purpose: owns Settings card UI; never touches the job queue.
 *
 * Edits write `settings.idleCatchUp` (saved by the panel like every other
 * Editor card) and are applied live to the running gate via
 * `idleCatchUpGate.configure`, so no restart is needed. Typing stops FURTHER
 * background submissions only; the copy says plainly that a scan that already
 * started may finish.
 */
import { useState } from 'react';
import { M24Card } from '../components/SettingsPanel/sections/M24Controls';
import '../components/SettingsPanel/sections/M24Sections.css';
import { idleCatchUpGate } from './idleCatchUpGate';
import {
  IDLE_CATCH_UP_MAX_MINUTES,
  IDLE_CATCH_UP_MIN_MINUTES,
  clampIdleCatchUpMinutes,
  normalizeIdleCatchUp,
  type IdleCatchUpSettings,
} from './settings.aug';

interface Props {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

export const IDLE_CATCH_UP_HINT =
  'Background manuscript scans you start wait until you haven’t typed for this long, then run. If a background scan already started, it may finish after you start typing again.';
export const IDLE_CATCH_UP_OFF_HINT = 'Off: background scans start right away.';

const ENABLED_ID = 'idle-catch-up-enabled';
const MINUTES_ID = 'idle-catch-up-minutes';
const HINT_ID = 'idle-catch-up-hint';

/** A whole number already inside [min, max] — safe to apply while still typing. */
function inRangeInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= IDLE_CATCH_UP_MIN_MINUTES && n <= IDLE_CATCH_UP_MAX_MINUTES ? n : null;
}

export default function IdleCatchUpSettingsSection({ settings, setSettings, setSavedOk }: Props) {
  const current = normalizeIdleCatchUp(settings.idleCatchUp);
  // Raw text while the minutes field is being edited; null = show the saved
  // value. Out-of-range text waits for blur / Enter, then clamps.
  const [minutesDraft, setMinutesDraft] = useState<string | null>(null);

  function apply(next: IdleCatchUpSettings) {
    setSettings((prev) => ({ ...prev, idleCatchUp: next }));
    setSavedOk(false);
    idleCatchUpGate.configure(next);
  }

  function commitMinutes() {
    if (minutesDraft === null) return;
    setMinutesDraft(null);
    // Empty field → keep the last committed value; otherwise clamp to 1..30.
    const minutes = minutesDraft.trim() === '' ? current.minutes : clampIdleCatchUpMinutes(minutesDraft);
    if (minutes !== current.minutes) apply({ ...current, minutes });
  }

  return (
    <section className="settings-section m24-root" aria-labelledby="section-idle-catch-up" data-settings-cat="editor">
      <h3 className="settings-section-title" id="section-idle-catch-up">Idle catch-up</h3>

      <M24Card>
        <div className="settings-field settings-field-inline">
          <input
            id={ENABLED_ID}
            type="checkbox"
            checked={current.enabled}
            aria-describedby={HINT_ID}
            data-testid="idle-catch-up-enabled"
            onChange={(e) => apply({ ...current, enabled: e.target.checked })}
          />
          <label htmlFor={ENABLED_ID}>Wait for a typing pause before background scans</label>
        </div>

        <div
          className={`settings-field settings-field-inline${current.enabled ? '' : ' settings-field--disabled'}`}
          style={{ marginTop: 10 }}
        >
          <label className="settings-label" htmlFor={MINUTES_ID}>
            Minutes without typing
          </label>
          <input
            id={MINUTES_ID}
            type="number"
            className="settings-input settings-input-number"
            min={IDLE_CATCH_UP_MIN_MINUTES}
            max={IDLE_CATCH_UP_MAX_MINUTES}
            step={1}
            inputMode="numeric"
            disabled={!current.enabled}
            aria-describedby={HINT_ID}
            data-testid="idle-catch-up-minutes"
            value={minutesDraft ?? String(current.minutes)}
            onChange={(e) => {
              const raw = e.target.value;
              setMinutesDraft(raw);
              const n = inRangeInteger(raw);
              if (n !== null && n !== current.minutes) apply({ ...current, minutes: n });
            }}
            onBlur={commitMinutes}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitMinutes();
            }}
          />
        </div>

        <p className="settings-hint" id={HINT_ID} style={{ marginTop: 10 }}>
          {IDLE_CATCH_UP_HINT}
          {current.enabled ? null : ` ${IDLE_CATCH_UP_OFF_HINT}`}
        </p>
      </M24Card>
    </section>
  );
}
