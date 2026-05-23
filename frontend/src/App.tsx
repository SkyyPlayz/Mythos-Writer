import { useState, useEffect } from 'react';
import DesktopShell from './DesktopShell';
import OnboardingWizard from './OnboardingWizard';
import './App.css';

function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.settingsGet().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  if (loading || settings === null) {
    return <div className="root-layout" />;
  }

  if (!settings.onboardingComplete) {
    return (
      <div className="root-layout">
        <OnboardingWizard
          initialSettings={settings}
          onComplete={(updated) => setSettings(updated)}
        />
      </div>
    );
  }

  return (
    <div className="root-layout">
      <DesktopShell />
    </div>
  );
}

export default App;
