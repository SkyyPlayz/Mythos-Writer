import { TELEMETRY_DATA_LIST } from '../settingsPanelTypes';

interface TelemetrySectionProps {
  telemetryEnabled: boolean;
  setTelemetryEnabled: (v: boolean) => void;
  setSavedOk: (ok: boolean) => void;
}

export default function TelemetrySection({ telemetryEnabled, setTelemetryEnabled, setSavedOk }: TelemetrySectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-telemetry" data-settings-cat="appearance">
      <h3 className="settings-section-title" id="section-telemetry">Telemetry</h3>
      <div className="settings-field">
        <div className="settings-agent-header">
          <span className="settings-label">Send anonymous usage data</span>
          <label className="settings-toggle" htmlFor="telemetry-enabled">
            <input
              id="telemetry-enabled"
              type="checkbox"
              aria-label="Enable telemetry"
              checked={telemetryEnabled}
              onChange={(e) => { setTelemetryEnabled(e.target.checked); setSavedOk(false); }}
            />
            <span className="settings-toggle-track" />
          </label>
        </div>
        <p className="settings-hint">Off by default. When enabled, we collect only:</p>
        <ul className="settings-telemetry-list" aria-label="Telemetry data items">
          {TELEMETRY_DATA_LIST.map((item) => (
            <li key={item} className="settings-telemetry-item">{item}</li>
          ))}
        </ul>
        <p className="settings-hint">No text content, file names, or personal data is ever sent.</p>
      </div>
    </section>
  );
}
