// SKY-10391 (SKY-10388 addendum, SKY-10370 reuse note): the shared
// destination-picker row — one "where does the new vault go" path + Browse…
// pair, extracted from ImportVaultSection.tsx so the Obsidian-import flow in
// OnboardingWizard.tsx reuses the same row instead of hand-rolling its own.
// Two variants because the consumers live in different design systems, and
// the onboarding row must stay an editable input (SKY-10388 ruling R3: the
// prefilled default location is a suggestion the writer can retype, not a
// browse-only value).

interface VaultDestinationPickerProps {
  path: string;
  placeholder: string;
  onBrowse: () => void | Promise<void>;
  /** Onboarding variant only — the path input is editable via this callback. */
  onChange?: (path: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** data-testids render as `${testIdPrefix}-path` and `${testIdPrefix}-browse`. */
  testIdPrefix: string;
  /** 'm24': Settings read-only path display · 'onboarding': editable input. */
  variant: 'm24' | 'onboarding';
}

export default function VaultDestinationPicker({
  path,
  placeholder,
  onBrowse,
  onChange,
  disabled,
  ariaLabel,
  testIdPrefix,
  variant,
}: VaultDestinationPickerProps) {
  if (variant === 'm24') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="m24-path" data-testid={`${testIdPrefix}-path`} title={path || undefined}>
          {path || placeholder}
        </span>
        <button
          type="button"
          className="m24-btn"
          onClick={() => { void onBrowse(); }}
          disabled={disabled}
          data-testid={`${testIdPrefix}-browse`}
        >
          Browse&hellip;
        </button>
      </div>
    );
  }
  return (
    <div className="import-field-row">
      <input
        type="text"
        className="import-field-row__input"
        placeholder={placeholder}
        value={path}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel}
        disabled={disabled}
        data-testid={`${testIdPrefix}-path`}
      />
      <button
        type="button"
        className="btn-secondary import-field-row__browse"
        onClick={() => { void onBrowse(); }}
        disabled={disabled}
        data-testid={`${testIdPrefix}-browse`}
      >
        Browse&hellip;
      </button>
    </div>
  );
}
