// NodeIcon — renders per-node icon from frontmatter `icon:` field.
// Supports emoji, bundled Lucide icons, and user SVG packs.
import { useState, useEffect } from 'react';
import type { FC, ReactNode } from 'react';
import { parseIconValue, unpackIconEntry } from './iconUtils';
import type { VaultIconEntry } from './iconUtils';
import { LUCIDE_ICONS } from './lucideRegistry';

const SIZE = 14;
const STROKE = 1.5;

interface NodeIconProps {
  /**
   * Raw icon entry: a frontmatter/legacy string ("🗡️" or "pack:lucide/sword"),
   * or the SKY-11190 colour-tagged `{icon, color}` form from the Boards
   * closed picker. An unresolvable icon name (corrupted/renamed out of the
   * picker's known set) falls through to `fallback` — never a blank render.
   */
  icon?: VaultIconEntry;
  /** Fallback rendered when icon is absent or unresolvable — e.g. a drawn default icon */
  fallback: ReactNode;
}

export const NodeIcon: FC<NodeIconProps> = ({ icon, fallback }) => {
  const { icon: raw, color } = unpackIconEntry(icon);
  const parsed = parseIconValue(raw);

  if (parsed.kind === 'default') return <>{fallback}</>;
  if (parsed.kind === 'emoji') return <span style={color ? { color } : undefined}>{parsed.value}</span>;

  if (parsed.kind === 'lucide') {
    const Comp = LUCIDE_ICONS[parsed.name];
    if (!Comp) return <>{fallback}</>;
    return (
      <Comp
        size={SIZE}
        strokeWidth={STROKE}
        color={color}
        aria-hidden="true"
        focusable="false"
        style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      />
    );
  }

  // user-svg: async load rendered as img
  return <UserSvgIcon pack={parsed.pack} name={parsed.name} fallback={fallback} />;
};

function UserSvgIcon({ pack, name, fallback }: { pack: string; name: string; fallback: ReactNode }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api.iconReadSvg(pack, name)
      .then(({ svg }) => {
        if (!cancelled && svg) {
          setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pack, name]);

  if (!src) return <>{fallback}</>;
  return (
    <img
      src={src}
      width={SIZE}
      height={SIZE}
      alt=""
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    />
  );
}
