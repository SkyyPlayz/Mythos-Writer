// Beta 3 "Liquid Neon" — showToast port (prototype 3311–3315, template
// 2857–2862): a bottom-center neon pill that fades up, holds, and fades out
// via the lnToast keyframes (liquidNeon.css).
import './liquidNeon.css';

let toastEl: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showLnToast(message: string): void {
  if (typeof document === 'undefined') return;
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
  }
  if (hideTimer) clearTimeout(hideTimer);

  const el = document.createElement('div');
  el.setAttribute('data-testid', 'ln-toast');
  el.setAttribute('role', 'status');
  el.style.cssText =
    'position:fixed;bottom:44px;left:50%;transform:translateX(-50%);padding:9px 16px;border-radius:11px;' +
    'background:rgba(10,13,24,.92);border:var(--bw,1px) solid var(--b1,rgba(0,240,255,.5));' +
    'box-shadow:0 0 24px -4px var(--g1,rgba(0,240,255,.4));color:#e8eefc;font-size:12px;' +
    'animation:lnToast 2.4s ease forwards;z-index:60;display:flex;align-items:center;gap:8px;pointer-events:none';
  const dot = document.createElement('span');
  dot.style.cssText =
    'width:7px;height:7px;border-radius:50%;background:var(--n1,#00f0ff);box-shadow:0 0 8px var(--g1,rgba(0,240,255,.4))';
  el.appendChild(dot);
  el.appendChild(document.createTextNode(message));
  document.body.appendChild(el);
  toastEl = el;

  hideTimer = setTimeout(() => {
    el.remove();
    if (toastEl === el) toastEl = null;
  }, 2500);
}
