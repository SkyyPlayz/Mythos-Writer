// Beta 3 "Liquid Neon" M24 — Settings → Shortcuts (prototype 2004–2017).
// Renders the app's real shortcut registry (frontend/src/shortcuts.ts, the
// same source the ? help modal uses) in the prototype's kbd-chip rows.
// Rebinding ships later — no dead "Customize…" button until it does.
import { buildShortcutGroups, MOD } from '../../../shortcuts';
import { M24Card } from './M24Controls';
import './M24Sections.css';

export default function ShortcutsSection() {
  const groups = buildShortcutGroups(MOD);

  return (
    <section className="settings-section m24-root" aria-labelledby="section-shortcuts" data-settings-cat="shortcuts">
      <h3 className="settings-section-title" id="section-shortcuts">Shortcuts</h3>

      {groups.map((group) => (
        <M24Card key={group.label} title={group.label}>
          {group.entries.map((entry) => (
            <div
              key={entry.action}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderBottom: '1px solid rgba(255,255,255,.045)' }}
            >
              <span style={{ flex: 1, fontSize: 11.5, color: '#c3cee2' }}>{entry.action}</span>
              {entry.keys.map((key, i) => (
                <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span style={{ fontSize: 10, color: '#7686a2' }}>or</span>}
                  <kbd className="m24-kbd">{key}</kbd>
                </span>
              ))}
            </div>
          ))}
        </M24Card>
      ))}

      <p className="settings-hint">
        Press <kbd className="m24-kbd">?</kbd> anywhere for this list in a popover. Custom rebinding is on
        the roadmap.
      </p>
    </section>
  );
}
