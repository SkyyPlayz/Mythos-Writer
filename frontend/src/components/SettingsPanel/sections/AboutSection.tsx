// Beta 3 "Liquid Neon" M24 — Settings → About (prototype 2054–2067).
// Version + build info from the app itself, a real update check (MYT-337
// channel-aware IPC), and the same replay-onboarding action the title-bar
// project menu uses (M5).
import { useEffect, useState } from 'react';
import { M24Card } from './M24Controls';
import logoUrl from '../../../assets/logo.png';
import './M24Sections.css';

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string | null }
  | { kind: 'current' }
  | { kind: 'error'; message: string };

export default function AboutSection() {
  const [appInfo, setAppInfo] = useState<{ appVersion: string; electronVersion: string; platform: string } | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    window.api?.getAppInfo?.()
      .then((info) => { if (alive) setAppInfo(info); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const checkForUpdates = async () => {
    setUpdate({ kind: 'checking' });
    try {
      const res = await window.api.appCheckForUpdate();
      if (res.available) setUpdate({ kind: 'available', version: res.version });
      else setUpdate({ kind: 'current' });
    } catch (e) {
      setUpdate({ kind: 'error', message: e instanceof Error ? e.message : 'Update check failed.' });
    }
  };

  const replayTour = () => {
    window.api?.onboardingReplay?.()
      .then(() => window.location.reload())
      .catch(() => {});
  };

  return (
    <section className="settings-section m24-root" aria-labelledby="section-about" data-settings-cat="about">
      <h3 className="settings-section-title" id="section-about">About</h3>

      <M24Card>
        <div style={{ textAlign: 'center', padding: '5px 0' }}>
          <img
            src={logoUrl}
            alt="Mythos Writer"
            style={{
              width: 58, height: 58, borderRadius: 15, display: 'block', margin: '0 auto',
              boxShadow: '0 0 24px -4px var(--g2,rgba(155,95,255,.4))',
              border: 'var(--bw,1px) solid rgba(255,255,255,.2)',
            }}
          />
          <div style={{ fontFamily: "'Lora',Georgia,serif", fontSize: 19, fontWeight: 600, color: '#f0f3fc', marginTop: 12 }}>
            Mythos Writer
          </div>
          <div style={{ fontSize: 11, color: '#8e9db8', marginTop: 3 }} data-testid="about-version">
            {appInfo ? `v${appInfo.appVersion} · Electron ${appInfo.electronVersion} · ${appInfo.platform}` : '…'} · Liquid Neon
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="m24-btn m24-btn--primary"
              onClick={() => { void checkForUpdates(); }}
              disabled={update.kind === 'checking'}
              data-testid="about-check-updates"
            >
              {update.kind === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
            <button type="button" className="m24-btn" onClick={replayTour} data-testid="about-replay-tour">
              Replay welcome tour
            </button>
          </div>
          {update.kind === 'available' && (
            <p className="settings-saved-msg" role="status" aria-live="polite" data-testid="about-update-status">
              Update available{update.version ? `: v${update.version}` : ''} — it downloads in the background and installs on quit.
            </p>
          )}
          {update.kind === 'current' && (
            <p className="settings-saved-msg" role="status" aria-live="polite" data-testid="about-update-status">
              You&apos;re on the latest version.
            </p>
          )}
          {update.kind === 'error' && (
            <p className="settings-error-msg" role="alert" data-testid="about-update-status">{update.message}</p>
          )}
          <p className="settings-hint" style={{ marginTop: 14 }}>
            The update channel (stable / beta) lives under Appearance → Updates.
          </p>
          <div style={{ fontSize: 10, color: '#7686a2', marginTop: 8 }}>
            Write the world before you write the book.
          </div>
        </div>
      </M24Card>
    </section>
  );
}
