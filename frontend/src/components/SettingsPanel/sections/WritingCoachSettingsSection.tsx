/**
 * PLAN-058 Lane A — Writing Coach switch (A-1) + PLAN-COACHING-OPT-IN.
 *
 * Owns: the Writing Coach master switch (agents.writingAssistant.enabled +
 * waEnabled, Shield R-D / DesktopShell) and the Coaching opt-in with its
 * Teacher / Assistant mode pick (`settings.coaching`). Coaching is off by
 * default — the coach answers as a quiet assistant — and the mode only
 * applies while Coaching is on. The mode stays stored while off.
 * Never touches: IPC, provider settings or prompt text. Coach surfaces read
 * the pick through partner/partnerPersonality `effectiveCoachingMode`.
 */
import {
  resolveCoachingSettings,
  type CoachingMode,
  type CoachingSettings,
} from '../../../partner/partnerPersonality';

interface WritingCoachSettingsSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

const COACHING_MODE_OPTIONS: ReadonlyArray<{ id: CoachingMode; label: string; copy: string }> = [
  {
    id: 'teacher',
    label: 'Teacher',
    copy: 'Names the craft, explains the why, and offers short drills from your own pages.',
  },
  {
    id: 'assistant',
    label: 'Assistant',
    copy: 'Plain answers and notes in a peer’s voice — no lessons unless you ask.',
  },
];

const COACHING_OFF_HINT =
  'Coaching is off — the coach answers as a calm assistant. Turn on Coaching to choose a mode.';

export default function WritingCoachSettingsSection({
  settings,
  setSettings,
  setSavedOk,
}: WritingCoachSettingsSectionProps) {
  const coachOn = settings.agents.writingAssistant.enabled;
  const coaching = resolveCoachingSettings(settings);
  const selectedMode = COACHING_MODE_OPTIONS.find((o) => o.id === coaching.mode) ?? COACHING_MODE_OPTIONS[0];

  const setCoachEnabled = (enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      waEnabled: enabled,
      agents: {
        ...prev.agents,
        writingAssistant: { ...prev.agents.writingAssistant, enabled },
      },
    }));
    setSavedOk(false);
  };

  // Coaching writes only `settings.coaching` — never waEnabled or the agent pair.
  const patchCoaching = (patch: Partial<CoachingSettings>) => {
    setSettings((prev) => ({
      ...prev,
      coaching: { ...resolveCoachingSettings(prev), ...patch },
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
        Inline craft notes, scene scans, and the Coach page — separate from your writing partner chat.
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

      <div className="wp-toggle-row wc-coaching-optin">
        <div className="wp-toggle-copy">
          <div className="wp-toggle-title">Coaching</div>
          <div className="settings-hint" id="wc-coaching-hint">
            Off by default. Turn on to have the coach teach as it helps — lessons and drills in the mode you pick.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label="Enable coaching"
            aria-describedby="wc-coaching-hint"
            data-testid="writing-coach-coaching-optin"
            checked={coaching.optIn}
            onChange={(e) => patchCoaching({ optIn: e.target.checked })}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>

      <fieldset
        className={`wc-teaching-modes${coaching.optIn ? '' : ' wc-teaching-modes--off'}`}
        data-testid="writing-coach-teaching-modes"
        disabled={!coaching.optIn}
        aria-describedby="wc-mode-hint"
      >
        <legend className="wp-label">Coaching mode</legend>
        <div className="wc-teaching-mode-names">
          {COACHING_MODE_OPTIONS.map((option) => {
            const checked = coaching.mode === option.id;
            return (
              <label
                key={option.id}
                className={`wp-chip wc-mode-chip${checked ? ' wp-chip--on' : ''}`}
                data-testid={`writing-coach-mode-${option.id}`}
              >
                <input
                  type="radio"
                  className="wc-mode-radio"
                  name="writing-coach-mode"
                  value={option.id}
                  checked={checked}
                  data-testid={`writing-coach-mode-${option.id}-radio`}
                  onChange={() => patchCoaching({ mode: option.id })}
                />
                {option.label}
              </label>
            );
          })}
        </div>
        <p className="settings-hint" id="wc-mode-hint" data-testid="writing-coach-mode-hint">
          {coaching.optIn ? selectedMode.copy : COACHING_OFF_HINT}
        </p>
      </fieldset>
    </section>
  );
}
