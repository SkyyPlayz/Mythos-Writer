interface NavConfigSectionProps {
  navConfig: NavRailConfig;
  setNavConfig: React.Dispatch<React.SetStateAction<NavRailConfig>>;
  setSavedOk: (ok: boolean) => void;
}

export default function NavConfigSection({ navConfig, setNavConfig, setSavedOk }: NavConfigSectionProps) {
  return (
    <section className="settings-section" aria-labelledby="section-nav-config" data-settings-cat="appearance">
      <h3 className="settings-section-title" id="section-nav-config">Nav-bar</h3>
      <p className="settings-hint">Choose which sections appear in the nav rail and their order.</p>

      <div className="settings-field">
        <span className="settings-label">Sections</span>
        <ul className="nav-config-item-list" aria-label="Nav-bar sections">
          {navConfig.items.map((item, index) => (
            <li key={item.id} className="nav-config-item">
              <label className="settings-toggle nav-config-item-toggle" aria-label={`Enable ${item.label}`}>
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) => {
                    setNavConfig((prev) => ({
                      ...prev,
                      items: prev.items.map((it) =>
                        it.id === item.id ? { ...it, enabled: e.target.checked } : it,
                      ),
                    }));
                    setSavedOk(false);
                  }}
                />
                <span className="settings-toggle-track" />
              </label>
              <span className="nav-config-item-icon" aria-hidden="true">{item.icon}</span>
              <span className="nav-config-item-label">{item.label}</span>
              <div className="nav-config-item-reorder">
                <button
                  type="button"
                  className="nav-config-reorder-btn"
                  aria-label={`Move ${item.label} up`}
                  disabled={index === 0}
                  onClick={() => {
                    setNavConfig((prev) => {
                      const next = [...prev.items];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      return { ...prev, items: next.map((it, i) => ({ ...it, order: i })) };
                    });
                    setSavedOk(false);
                  }}
                >▲</button>
                <button
                  type="button"
                  className="nav-config-reorder-btn"
                  aria-label={`Move ${item.label} down`}
                  disabled={index === navConfig.items.length - 1}
                  onClick={() => {
                    setNavConfig((prev) => {
                      const next = [...prev.items];
                      [next[index], next[index + 1]] = [next[index + 1], next[index]];
                      return { ...prev, items: next.map((it, i) => ({ ...it, order: i })) };
                    });
                    setSavedOk(false);
                  }}
                >▼</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="settings-field settings-field-inline">
        <span className="settings-label">Start collapsed</span>
        <label className="settings-toggle" htmlFor="nav-collapsed-default">
          <input
            id="nav-collapsed-default"
            type="checkbox"
            aria-label="Start collapsed"
            checked={navConfig.collapsedDefault}
            onChange={(e) => { setNavConfig((p) => ({ ...p, collapsedDefault: e.target.checked })); setSavedOk(false); }}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>

      <div className="settings-field settings-field-inline">
        <span className="settings-label">Show labels</span>
        <label className="settings-toggle" htmlFor="nav-show-labels">
          <input
            id="nav-show-labels"
            type="checkbox"
            aria-label="Show labels"
            checked={navConfig.showLabels}
            onChange={(e) => { setNavConfig((p) => ({ ...p, showLabels: e.target.checked })); setSavedOk(false); }}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>

      <div className="settings-field settings-field-inline">
        <span className="settings-label">Show icons</span>
        <label className="settings-toggle" htmlFor="nav-show-icons">
          <input
            id="nav-show-icons"
            type="checkbox"
            aria-label="Show icons"
            checked={navConfig.showIcons}
            onChange={(e) => { setNavConfig((p) => ({ ...p, showIcons: e.target.checked })); setSavedOk(false); }}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>
    </section>
  );
}
