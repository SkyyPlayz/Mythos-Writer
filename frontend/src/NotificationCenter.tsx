// Beta 3 "Liquid Neon" M5 — title-bar bell + notifications popover.
// Exact port of prototype 95–110 (template) and notifRows/notifMeta
// (4454–4459): kind-colored icon chips, title/detail/age rows, deep-link on
// click. Rows come from the app-wide notificationStore.
import { useEffect, useRef, useState } from 'react';
import {
  listNotifications,
  notificationAge,
  subscribeNotifications,
  type AppNotification,
  type NotificationKind,
} from './notificationStore';
import { hexA } from './theme/liquidNeonEngine';

/** notifMeta (prototype 4454): [color, icon path markup] per kind. Slot-tinted
 *  kinds resolve their live palette color via CSS vars at render time —
 *  the prototype used c1/c2/c3 directly, so we read the applied tokens. */
const NOTIF_META: Record<NotificationKind, [string, string]> = {
  archive: ['#ffd319', '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6z"></path><path d="M9 12l2.2 2.2L15.5 10"></path>'],
  sync: ['#4ade80', '<path d="M20 17H7a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.6 11a3 3 0 0 1 1.4 6z"></path>'],
  sugg: ['var(--n2)', '<path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"></path>'],
  bs: ['var(--n1)', '<circle cx="12" cy="10" r="5"></circle><path d="M10 17.5h4M10.5 20.5h3"></path>'],
  crafter: ['var(--n3)', '<path d="M5 21V8l3-3v16M9 21V5l3-2v18M12 21V3l4 3v15M19 21V9l-3-3"></path><path d="M3 21h18"></path>'],
};

/** Resolve a meta color that may be a CSS var reference to a concrete hex. */
function metaColor(c: string): string {
  if (!c.startsWith('var(')) return c;
  const name = c.slice(4, -1);
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '#00f0ff';
}

export interface NotificationCenterProps {
  /** Extra class for the trigger (title-bar icon slot). */
  className?: string;
}

export default function NotificationCenter({ className }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>(listNotifications());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeNotifications(setItems), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const hasUnread = items.length > 0;

  return (
    <div
      ref={rootRef}
      className={className}
      onClick={() => setOpen((o) => !o)}
      style={{ position: 'relative', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3bd', cursor: 'pointer' }}
      role="button"
      aria-label="Notifications"
      aria-expanded={open}
      data-testid="ln-bell"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 16.5v-6a6 6 0 0 1 12 0v6l1.6 2.5H4.4z" />
        <path d="M10 21.5a2.2 2.2 0 0 0 4 0" />
      </svg>
      {hasUnread && (
        <span style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: '50%', background: 'var(--n3,#ff4dff)', boxShadow: '0 0 6px var(--g3,rgba(255,77,255,.4))' }} data-testid="ln-bell-dot" />
      )}
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', right: 0, top: 36, width: 300, zIndex: 46, padding: 8, borderRadius: 14,
            background: 'rgba(15,19,33,.97)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
            border: 'var(--bw,1px) solid var(--b3,rgba(255,77,255,.5))',
            boxShadow: '0 14px 40px rgba(3,5,12,.6),0 0 22px -6px var(--g3,rgba(255,77,255,.4))',
            animation: 'lnFadeUp .16s ease', cursor: 'default', textAlign: 'left',
          }}
          data-testid="ln-bell-popover"
        >
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#7686a2', padding: '4px 10px 7px' }}>NOTIFICATIONS</div>
          {items.length === 0 && (
            <div style={{ padding: '10px 10px 12px', fontSize: 11.5, color: '#8e9db8' }}>All quiet — agent activity and sync events land here.</div>
          )}
          {items.map((n) => {
            const meta = NOTIF_META[n.kind];
            const col = metaColor(meta[0]);
            return (
              <div
                key={n.id}
                onClick={() => { setOpen(false); n.onOpen?.(); }}
                className="ln-notif-row"
                style={{ display: 'flex', gap: 9, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', alignItems: 'flex-start' }}
                data-testid={`ln-notif-${n.kind}`}
              >
                <span
                  style={{ width: 27, height: 27, borderRadius: 9, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: hexA(col, .1), border: `1px solid ${hexA(col, .4)}` }}
                  dangerouslySetInnerHTML={{ __html: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${meta[1]}</svg>` }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: '#e6ecf9', lineHeight: 1.35 }}>{n.title}</div>
                  <div style={{ fontSize: 10, color: '#8e9db8', marginTop: 2 }}>{n.detail}</div>
                </div>
                <span style={{ fontSize: 9.5, color: '#7686a2', flex: 'none' }}>{notificationAge(n.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
