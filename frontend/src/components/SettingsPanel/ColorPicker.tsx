import { useState, useEffect } from 'react';
import { contrastRatio, enforceContrastFloor } from '../../theme';

export function ContrastBadge({ ratio }: { ratio: number }) {
  const pass = ratio >= 4.5;
  const warn = ratio >= 3 && ratio < 4.5;
  const cls = pass ? 'tcs-badge tcs-badge-pass' : warn ? 'tcs-badge tcs-badge-warn' : 'tcs-badge tcs-badge-fail';
  return <span className={cls} aria-live="polite">{ratio.toFixed(1)}:1</span>;
}

export function ColorPicker({
  id,
  label,
  value,
  bgForContrast,
  onChange,
  minRatio = 0,
}: {
  id: string;
  label: string;
  value: string;
  bgForContrast?: string;
  onChange: (hex: string) => void;
  minRatio?: number;
}) {
  const [hexInput, setHexInput] = useState(value);
  const [clamped, setClamped] = useState(false);

  useEffect(() => { setHexInput(value); }, [value]);

  const handleColorChange = (raw: string) => {
    setHexInput(raw);
    let final = raw;
    if (minRatio > 0 && bgForContrast) {
      const safe = enforceContrastFloor(raw, bgForContrast, minRatio);
      if (safe !== raw) { setClamped(true); final = safe; }
      else { setClamped(false); }
    }
    onChange(final);
  };

  const handleHexBlur = () => {
    const trimmed = hexInput.startsWith('#') ? hexInput : `#${hexInput}`;
    if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(trimmed)) {
      handleColorChange(trimmed);
    } else {
      setHexInput(value);
    }
  };

  const ratio = bgForContrast ? contrastRatio(value, bgForContrast) : null;

  return (
    <div className="lg-color-picker-row">
      <label className="settings-label lg-adv-label" htmlFor={id}>{label}</label>
      <div className="lg-color-picker-controls">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => handleColorChange(e.target.value)}
          className="lg-color-input"
          aria-label={`${label} colour`}
        />
        <input
          type="text"
          className="lg-hex-input settings-input"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={handleHexBlur}
          maxLength={7}
          aria-label={`${label} hex value`}
          spellCheck={false}
        />
        {ratio !== null && <ContrastBadge ratio={ratio} />}
        {clamped && <span className="lg-clamp-notice">Adjusted to stay readable</span>}
      </div>
    </div>
  );
}
