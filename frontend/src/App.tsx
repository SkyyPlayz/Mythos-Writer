import { useState, useEffect } from 'react';
import DesktopShell from './DesktopShell';
import OnboardingWizard from './OnboardingWizard';
import VaultNotFoundScreen from './components/VaultNotFoundScreen';
import FloatingPanelApp from './FloatingPanelApp';
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
        const [storyResult, notesResult] = await Promise.all([
          window.api.validatePath(vaults.storyVaultPath).catch(() => ({ valid: false })),
          window.api.validatePath(vaults.notesVaultPath).catch(() => ({ valid: false })),
        ]);
        const storyValid = isVaultPathValid(storyResult);
        const notesValid = isVaultPathValid(notesResult);

        if (!storyValid && !notesValid) {
          setView({ kind: 'wizard', settings: { ...nextSettings, onboardingComplete: false } });
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

// SKY-1697: Top-level router — runs once at module load time before any React rendering.
// The hash is set by main.ts when creating a floating panel BrowserWindow and never changes
// while the window is alive, so it's safe to read once here.
const _floatingHash = window.location.hash;
const _floatingPanelId = _floatingHash.startsWith('#/floating-panel/')
  ? decodeURIComponent(_floatingHash.replace('#/floating-panel/', '').split('?')[0])
  : null;

function AppRoot() {
  if (_floatingPanelId) {
    return (
      <div className="root-layout">
        <FloatingPanelApp panelId={_floatingPanelId} />
      </div>
    );
  }
  return <App />;
}

export default AppRoot;
