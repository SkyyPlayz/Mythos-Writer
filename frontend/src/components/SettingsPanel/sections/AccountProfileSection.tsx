// Beta 3 "Liquid Neon" M24 — Settings → Account & profile (prototype 2019–2052).
// Local-first: the pen name binds to settings.authorName (persisted via the
// panel's normal Save flow); plan/devices reflect this machine — there is no
// sign-in in the beta, so no fake "Sign out" affordances are rendered.
import { useEffect, useState } from 'react';
import { M24Card } from './M24Controls';
import './M24Sections.css';

interface Props {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setSavedOk: (ok: boolean) => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

export default function AccountProfileSection({ settings, setSettings, setSavedOk }: Props) {
  const [appInfo, setAppInfo] = useState<{ platform: string; appVersion: string } | null>(null);

  useEffect(() => {
    let alive = true;
    window.api?.getAppInfo?.()
      .then((info) => { if (alive) setAppInfo({ platform: info.platform, appVersion: info.appVersion }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const penName = settings.authorName ?? '';
  const initial = (penName.trim()[0] ?? 'M').toUpperCase();
  const memberSince = settings.firstLaunchAt
    ? new Date(settings.firstLaunchAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : '—';

  const rows: [string, string][] = [
    ['Plan', 'Beta — local-first, all agents included'],
    ['Member since', memberSince],
    ['App version', appInfo ? `v${appInfo.appVersion}` : '—'],
  ];

  return (
    <section className="settings-section m24-root" aria-labelledby="section-account-profile" data-settings-cat="account">
      <h3 className="settings-section-title" id="section-account-profile">Account &amp; profile</h3>

      <div className="m24-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 13 }}>
          <div
            aria-hidden="true"
            style={{
              width: 52, height: 52, borderRadius: '50%', flex: 'none',
              background: 'var(--grad,linear-gradient(120deg,#00f0ff,#9b5fff,#ff4dff))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 19, fontWeight: 800, color: '#0b0d17',
              boxShadow: '0 0 var(--gr,26px) -6px var(--g2,rgba(155,95,255,.4))',
            }}
          >
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              type="text"
              value={penName}
              placeholder="Pen name"
              aria-label="Pen name"
              data-testid="account-pen-name"
              onChange={(e) => {
                const next = e.target.value;
                setSettings((p) => ({ ...p, authorName: next }));
                setSavedOk(false);
              }}
              style={{
                height: 28, background: 'rgba(255,255,255,.05)',
                border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.4))', borderRadius: 9,
                color: '#eef2fb', fontSize: 13, fontWeight: 600, padding: '0 10px', width: 200, maxWidth: '100%',
              }}
            />
            <div style={{ fontSize: 10.5, color: 'var(--n2,#9b5fff)', marginTop: 4 }}>
              Beta plan · local-first · all agents included
            </div>
          </div>
        </div>
        {rows.map(([k, v]) => (
          <div
            key={k}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6.5px 0', borderBottom: '1px solid rgba(255,255,255,.045)', fontSize: 11.5 }}
          >
            <span style={{ color: '#8e9db8' }}>{k}</span>
            <span style={{ color: '#dbe4f5' }}>{v}</span>
          </div>
        ))}
        <p className="settings-hint" style={{ marginTop: 10 }}>
          Your pen name is used on exports and by the agents when they address you. It saves with the
          Save button below.
        </p>
      </div>

      <M24Card title="Devices">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8e9db8" strokeWidth="1.7" aria-hidden="true">
            <rect x="3" y="5" width="18" height="12" rx="2" />
            <path d="M8 20h8" />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, color: '#dbe4f5' }} data-testid="account-this-device">
              This PC{appInfo ? ` — ${PLATFORM_LABELS[appInfo.platform] ?? appInfo.platform}` : ''}
            </div>
            <div style={{ fontSize: 10, color: '#7686a2' }}>Active now</div>
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#4ade80' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px rgba(74,222,128,.6)' }} aria-hidden="true" />
            This device
          </span>
        </div>
        <p className="settings-hint" style={{ marginTop: 8 }}>
          Everything lives on this PC. Linked devices arrive with cloud sync — see Sync &amp; Backup.
        </p>
      </M24Card>
    </section>
  );
}
