// Beta 3 "Liquid Neon" M5 — in-app notification store backing the title-bar
// bell (prototype notifs 3104–3110 / notifRows 4455–4459). App systems push
// events here; NotificationCenter subscribes and deep-links on click.

export type NotificationKind = 'sync' | 'archive' | 'bs' | 'sugg' | 'crafter' | 'beta';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  /** Epoch ms when the event happened. */
  at: number;
  /** Deep-link — navigates to the event's source. */
  onOpen?: () => void;
}

type Listener = (items: AppNotification[]) => void;

const MAX_ITEMS = 20;
let items: AppNotification[] = [];
let seq = 0;
const listeners = new Set<Listener>();

export function pushNotification(n: Omit<AppNotification, 'id' | 'at'> & { at?: number }): AppNotification {
  const full: AppNotification = { id: `n${++seq}`, at: n.at ?? Date.now(), ...n };
  items = [full, ...items].slice(0, MAX_ITEMS);
  listeners.forEach((l) => l(items));
  return full;
}

export function listNotifications(): AppNotification[] {
  return items;
}

export function subscribeNotifications(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function clearNotifications(): void {
  items = [];
  listeners.forEach((l) => l(items));
}

/** "2m" style relative age (prototype shows compact ages). */
export function notificationAge(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
