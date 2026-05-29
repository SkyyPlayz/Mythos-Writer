import { useState, useEffect } from 'react';
import DesktopShell from './DesktopShell';
import OnboardingWizard from './OnboardingWizard';
import './App.css';

function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    performance.mark('renderer:settings-ipc-start');
    const ipcT0 = performance.now();
    window.api.settingsGet().then((s) => {
      performance.mark('renderer:settings-ipc-end');
      console.log(`[perf] renderer:settingsGet IPC: ${(performance.now() - ipcT0).toFixed(0)} ms`);
      setSettings(s);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading && settings !== null) {
      performance.mark('renderer:interactive');
      console.log('[perf] renderer:interactive');
    }
  }, [loading, settings]);

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
