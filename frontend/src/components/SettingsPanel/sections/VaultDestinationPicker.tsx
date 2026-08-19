// SKY-10385: shared "pick a folder for a new vault" row — a path pill +
// Browse… button. Extracted out of ImportVaultSection's "Its own new vault"
// destination row (M24 §Import) so the Settings "New vault" flow (SKY-10385)
// and any future "make me a new vault at a location I choose" flow (see
// SKY-10370) render and behave identically instead of growing separate
// copies (per Ivy's note on SKY-10385).
import './M24Sections.css';

interface Props {
  path: string;
  placeholder: string;
  onBrowse: () => void;
  disabled?: boolean;
  testIdPrefix: string;
}

export function VaultDestinationPicker({ path, placeholder, onBrowse, disabled, testIdPrefix }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="m24-path" data-testid={`${testIdPrefix}-path`} title={path || undefined}>
        {path || placeholder}
      </span>
      <button
        type="button"
        className="m24-btn"
        onClick={onBrowse}
        disabled={disabled}
        data-testid={`${testIdPrefix}-browse`}
      >
        Browse…
      </button>
    </div>
  );
}
