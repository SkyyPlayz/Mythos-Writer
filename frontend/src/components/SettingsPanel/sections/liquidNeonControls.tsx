// Shared Liquid Neon settings building blocks (prototype mkToggle / mkSlider /
// segMk, 4180–4232). Extracted from LiquidNeonAppearanceSection in Beta 4 M28
// so the Editor page's manuscript cards (§13) can reuse the exact controls.
import type { CSSProperties, ReactNode } from 'react';

/** Keyboard activation for div/label elements standing in for a button (Enter/Space). */
export function onActivateKey(handler: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

/** mkToggle (prototype 4180) as a component. */
export function NeonToggle({ on, onClick, testId }: { on: boolean; onClick: () => void; testId?: string }) {
  const pillSt: CSSProperties = {
    width: 37, height: 21, borderRadius: 99, position: 'relative', cursor: 'pointer', flex: 'none',
    transition: 'all .2s ease',
    ...(on
      ? { background: 'var(--gs1,rgba(0,240,255,.12))', border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.5))', boxShadow: '0 0 10px -2px var(--g1,rgba(0,240,255,.4))' }
      : { background: 'rgba(255,255,255,.04)', border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.3))' }),
  };
  const knobSt: CSSProperties = {
    position: 'absolute', top: 2.5, left: 3, width: 13, height: 13, borderRadius: '50%',
    transition: 'all .2s ease', transform: `translateX(${on ? 16 : 0}px)`,
    ...(on
      ? { background: 'var(--n1,#00f0ff)', boxShadow: '0 0 8px var(--g1,rgba(0,240,255,.4))' }
      : { background: '#8e9db8' }),
  };
  return (
    <div
      onClick={onClick}
      style={pillSt}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onKeyDown={onActivateKey(onClick)}
      data-testid={testId}
    >
      <span style={knobSt} />
    </div>
  );
}

/** mkSlider (prototype 4202): neon-filled range track + live value label. */
export function NeonSlider({ label, value, min, max, unit, onChange, testId }: {
  label: string; value: number; min: number; max: number; unit: string;
  onChange: (v: number) => void; testId?: string;
}) {
  const pct = ((value - min) / (max - min) * 100).toFixed(1);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 11.5, color: '#aebad0' }}>{label}</span>
        <span style={{ fontSize: 11.5, color: 'var(--n1,#00f0ff)', fontWeight: 600 }}>{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value} data-testid={testId}
        aria-label={label}
        onChange={(e) => onChange(+e.target.value)} className="lnas-range"
        style={{ width: '100%', background: `linear-gradient(to right,var(--n1,#00f0ff) ${pct}%,rgba(255,255,255,.12) ${pct}%)` }}
      />
    </div>
  );
}

/** segMk (prototype 4231): the pill segment control. */
export function NeonSeg<K extends string>({ options, current, onPick, testIdPrefix }: {
  options: [K, string][]; current: K; onPick: (k: K) => void; testIdPrefix?: string;
}) {
  return (
    <div style={{ display: 'flex', padding: 3, borderRadius: 10, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', gap: 2, width: 'fit-content' }}>
      {options.map(([k, label]) => (
        <div
          key={k}
          onClick={() => onPick(k)}
          role="button"
          tabIndex={0}
          aria-pressed={current === k}
          onKeyDown={onActivateKey(() => onPick(k))}
          data-testid={testIdPrefix ? `${testIdPrefix}-${k}` : undefined}
          className={current === k ? undefined : 'lnas-seg-idle'}
          style={{
            padding: '4px 13px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap',
            ...(current === k
              ? { background: 'var(--gs1,rgba(0,240,255,.12))', color: 'var(--n1,#00f0ff)', border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.5))', fontWeight: 600, boxShadow: '0 0 10px -3px var(--g1,rgba(0,240,255,.4))' }
              : { color: '#94a3bd', border: '1px solid transparent' }),
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

export function NeonCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="lnas-card">
      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eef2fb' }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: '#8e9db8', margin: '2px 0 12px' }}>{sub}</div>}
      {children}
    </div>
  );
}

/** Header pill style (prototype 2241–2242). */
export const hdrBtnSt = (borderVar: string): CSSProperties => ({
  padding: '4px 11px', borderRadius: 8, border: `var(--bw,1px) solid var(${borderVar},rgba(0,240,255,.4))`,
  color: '#aebad0', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', flex: 'none',
});

export const SCROLL_WHEEL_GRADIENT = 'conic-gradient(#5a4014,#8a6a2c,#2b2213,#4a3a1a,#5a4014)';
