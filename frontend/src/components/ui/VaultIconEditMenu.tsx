// SKY-11068 — the icon-edit popover shared by the nav-rail vault tiles, the
// title-bar vault switcher, and Settings > Mythos vaults. A thin wrapper
// around the shared portaled Menu with a fixed set of quick-pick glyphs plus
// "Upload image…" / "Remove icon".
import { Menu, type MenuItemDef } from './Menu';
import type { VaultIconSetInput } from '../../hooks/useVaultIcons';

const QUICK_GLYPHS = ['📖', '✍️', '🐉', '🌙', '⚔️', '🔮', '🏰', '⭐'];

export interface VaultIconEditMenuProps {
  open: boolean;
  onClose: () => void;
  anchorEl?: HTMLElement | null;
  position?: { x: number; y: number };
  hasIcon: boolean;
  onPickImage: () => void;
  onSetIcon: (icon: VaultIconSetInput) => void;
  'data-testid'?: string;
}

export function VaultIconEditMenu({
  open,
  onClose,
  anchorEl,
  position,
  hasIcon,
  onPickImage,
  onSetIcon,
  'data-testid': testId,
}: VaultIconEditMenuProps) {
  const items: MenuItemDef[] = [
    { id: 'pick-image', label: 'Upload image…' },
    ...QUICK_GLYPHS.map((g) => ({ id: `glyph:${g}`, label: g })),
    { id: 'remove', label: 'Remove icon', destructive: true, disabled: !hasIcon, separator: true },
  ];

  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorEl={anchorEl}
      position={position}
      items={items}
      className="vault-icon-edit-menu"
      aria-label="Set vault icon"
      data-testid={testId}
      onAction={(id) => {
        if (id === 'pick-image') onPickImage();
        else if (id === 'remove') onSetIcon(null);
        else if (id.startsWith('glyph:')) onSetIcon({ kind: 'glyph', value: id.slice('glyph:'.length) });
      }}
    />
  );
}
