// SKY-11068 — a vault's author-set icon (image or glyph), or an
// initials-on-accent default so the switcher/rail never shows an empty slot.
import './VaultIconAvatar.css';

export interface VaultIconAvatarProps {
  icon: VaultIconRef | undefined;
  /** Source for the initials fallback and the accessible label. */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function initialsFor(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function VaultIconAvatar({ icon, label, size = 'md', className }: VaultIconAvatarProps) {
  const cls = ['vault-icon-avatar', `vault-icon-avatar--${size}`, className].filter(Boolean).join(' ');

  if (icon?.kind === 'image' && icon.dataUrl) {
    return (
      <span className={cls} data-testid="vault-icon-avatar" data-icon-kind="image">
        <img src={icon.dataUrl} alt="" className="vault-icon-avatar-img" />
      </span>
    );
  }
  if (icon?.kind === 'glyph' && icon.value) {
    return (
      <span className={cls} data-testid="vault-icon-avatar" data-icon-kind="glyph" aria-hidden="true">
        {icon.value}
      </span>
    );
  }
  return (
    <span className={`${cls} vault-icon-avatar--default`} data-testid="vault-icon-avatar" data-icon-kind="default" aria-hidden="true">
      {initialsFor(label)}
    </span>
  );
}
