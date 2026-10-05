/**
 * PLAN-058 Lane A — Writing Coach switch + teaching-mode name chrome (A-1, A-2).
 * Toggle wires agents.writingAssistant.enabled (WA26 / scan-now gate).
 * Teacher / Assistant labels are chrome only — no scan/chat behavior (OWNER ASK later).
 */
import { useState } from 'react';

interface WritingCoachSettingsSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

const TEACHING_MODE_LABELS = ['Teacher', 'Assistant'] as const;

export default function WritingCoachSettingsSection({
  settings,
  setSettings,
  setSavedOk,
}: WritingCoachSettingsSectionProps) {
  const coachOn = settings.agents.writingAssistant.enabled;
  // Chrome-only — not persisted; behavior ships in a later OWNER ASK.
  const [teachingModeChrome, setTeachingModeChrome] = useState<typeof TEACHING_MODE_LABELS[number]>('Teacher');

  const setCoachEnabled = (enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        writingAssistant: { ...prev.agents.writingAssistant, enabled },
      },
    }));
    setSavedOk(false);
  };

  return (
    <section
      className="settings-section wp-card"
      aria-labelledby="section-writing-coach"
      data-settings-cat="writingPartner"
      data-testid="writing-coach-settings"
    >
      <h3 className="settings-section-title" id="section-writing-coach">Writing Coach</h3>
      <p className="settings-hint">
        Inline craft teaching, scene scans, and the Coach page — separate from your writing partner chat.
      </p>

      <div className="wp-toggle-row wc-coach-master">
        <div className="wp-toggle-copy">
          <div className="wp-toggle-title">Writing Coach</div>
          <div className="settings-hint">Turn off to disable scans, suggestions, and Coach AI calls.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label="Enable Writing Coach"
            data-testid="writing-coach-enabled"
            checked={coachOn}
            onChange={(e) => setCoachEnabled(e.target.checked)}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>

      <div className="wc-teaching-modes" data-testid="writing-coach-teaching-modes">
        <span className="wp-label">Teaching modes</span>
        <div className="wp-chips" role="group" aria-label="Teaching modes">
          {TEACHING_MODE_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              className={`wp-chip${teachingModeChrome === label ? ' wp-chip--on' : ''}`}
              data-testid={`writing-coach-mode-${label.toLowerCase()}`}
              aria-pressed={teachingModeChrome === label}
              onClick={() => setTeachingModeChrome(label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
