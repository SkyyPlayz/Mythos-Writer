// Beta 3 "Liquid Neon" M24 — shared building blocks for the settings
// remainder pages. Same verbatim prototype recipes as M4's
// LiquidNeonAppearanceSection (mkToggle 4180 / mkSlider 4202 / segMk 4231 /
// settings card), re-exported here so the new sections don't reach into M4's
// component internals.
import type { CSSProperties, ReactNode } from 'react';
import './M24Sections.css';

/** mkToggle (prototype 4180) as a component. */
export function M24Toggle({ on, onClick, label, testId }: {
  on: boolean; onClick: () => void; label: string; testId?: string;
}) {
  const pillSt: CSSProperties = {
    width: 37, height: 21, borderRadius: 99, position: 'relative', cursor: 'pointer', flex: 'none',
    transition: 'all .2s ease', padding: 0,
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
    <button type="button" onClick={onClick} style={pillSt} role="switch" aria-checked={on} aria-label={label} data-testid={testId}>
      <span style={knobSt} />
    </button>
  );
}

/** mkSlider (prototype 4202): neon-filled range track + live value label. */
export function M24Slider({ label, value, min, max, unit, onChange, testId }: {
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
        onChange={(e) => onChange(+e.target.value)} className="m24-range"
        style={{ background: `linear-gradient(to right,var(--n1,#00f0ff) ${pct}%,rgba(255,255,255,.12) ${pct}%)` }}
      />
    </div>
  );
}

/** segMk (prototype 4231): the pill segment control. */
export function M24Seg<K extends string>({ options, current, onPick, ariaLabel, testIdPrefix }: {
  options: [K, string][]; current: K; onPick: (k: K) => void; ariaLabel: string; testIdPrefix?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ display: 'flex', padding: 3, borderRadius: 10, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', gap: 2, width: 'fit-content', flexWrap: 'wrap' }}
    >
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={current === k}
          onClick={() => onPick(k)}
          data-testid={testIdPrefix ? `${testIdPrefix}-${k}` : undefined}
          className={current === k ? undefined : 'm24-seg-idle'}
          style={{
            padding: '4px 13px', borderRadius: 8, fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap',
            ...(current === k
              ? { background: 'var(--gs1,rgba(0,240,255,.12))', color: 'var(--n1,#00f0ff)', border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.5))', fontWeight: 600, boxShadow: '0 0 10px -3px var(--g1,rgba(0,240,255,.4))' }
              : { background: 'none', color: '#94a3bd', border: '1px solid transparent' }),
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Prototype settings card (rounded 15px glass panel). */
export function M24Card({ title, sub, danger, children }: {
  title?: string; sub?: string; danger?: boolean; children?: ReactNode;
}) {
  return (
    <div className={`m24-card${danger ? ' m24-card--danger' : ''}`}>
      {title && <div style={{ fontSize: 12.5, fontWeight: 600, color: danger ? '#ff9db4' : '#eef2fb' }}>{title}</div>}
      {sub && <div style={{ fontSize: 11, color: '#8e9db8', margin: '2px 0 12px' }}>{sub}</div>}
      {children}
    </div>
  );
}
