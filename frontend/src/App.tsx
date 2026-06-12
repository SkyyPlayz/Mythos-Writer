import { useState, useEffect } from 'react';
import DesktopShell from './DesktopShell';
import OnboardingWizard from './OnboardingWizard';
import VaultNotFoundScreen from './components/VaultNotFoundScreen';
import './App.css';

type AppView =
  | { kind: 'loading' }
  | { kind: 'wizard'; settings: AppSettings }
  | { kind: 'missing-vault'; settings: AppSettings; vaultPath?: string }
  | { kind: 'shell'; settings: AppSettings };

type VaultValidationResult = {
  valid?: boolean;
  exists?: boolean;
  writable?: boolean;
  error?: string;
};

function isVaultPathValid(result: VaultValidationResult): boolean {
  if (typeof result.valid === 'boolean') return result.valid;
  return Boolean(result.exists && result.writable && !result.error);
}

function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [view, setView] = useState<AppView>({ kind: 'loading' });
  const [wizardDismissed, setWizardDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadApp() {
      performance.mark('renderer:settings-ipc-start');
      const ipcT0 = performance.now();
      const nextSettings = await window.api.settingsGet();
      performance.mark('renderer:settings-ipc-end');
      console.log(`[perf] renderer:settingsGet IPC: ${(performance.now() - ipcT0).toFixed(0)} ms`);

      if (cancelled) return;
      setSettings(nextSettings);

      if (!nextSettings.onboardingComplete) {
        setView({ kind: 'wizard', settings: nextSettings });
        return;
      }

      try {
        const vaults = await window.api.vaultGetPaths();
        const result = await window.api.validatePath(vaults.storyVaultPath);
        if (!isVaultPathValid(result)) {
          setView({ kind: 'missing-vault', settings: nextSettings, vaultPath: vaults.storyVaultPath });
          return;
        }
      } catch {
        setView({ kind: 'missing-vault', settings: nextSettings });
        return;
      }

      setView({ kind: 'shell', settings: nextSettings });
    }

    void loadApp();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (view.kind !== 'loading') {
      performance.mark('renderer:interactive');
      console.log('[perf] renderer:interactive');
    }
  }, [view.kind]);

  if (view.kind === 'loading' || settings === null) {
    return <div className="root-layout" />;
  }

  if ((view.kind === 'wizard' || !settings.onboardingComplete) && !wizardDismissed) {
    return (
      <div className="root-layout">
        <OnboardingWizard
          initialSettings={settings}
          onComplete={(updated) => {
            setSettings(updated);
            setView({ kind: 'shell', settings: updated });
          }}
          onCancel={() => setWizardDismissed(true)}
        />
      </div>
    );
  }

  if (view.kind === 'missing-vault') {
    return (
      <div className="root-layout">
        <VaultNotFoundScreen
          vaultPath={view.vaultPath}
          onRerunWizard={() => {
            const wizardSettings = { ...view.settings, onboardingComplete: false };
            setSettings(wizardSettings);
            setWizardDismissed(false);
            setView({ kind: 'wizard', settings: wizardSettings });
          }}
          onOpenSettings={() => setView({ kind: 'shell', settings: view.settings })}
          onQuit={() => { void window.api.appQuit?.(); }}
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
