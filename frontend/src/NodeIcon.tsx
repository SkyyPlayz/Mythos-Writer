// NodeIcon — renders per-node icon from frontmatter `icon:` field.
// Supports emoji, bundled Lucide icons, and user SVG packs.
import { useState, useEffect } from 'react';
import type { FC } from 'react';
import { parseIconValue } from './iconUtils';
import { LUCIDE_ICONS } from './lucideRegistry';

const SIZE = 14;
const STROKE = 1.5;

interface NodeIconProps {
  /** Raw frontmatter icon string, e.g. "🗡️" or "pack:lucide/sword" */
  icon?: string;
  /** Fallback rendered when icon is absent or unresolvable */
  fallback: string;
}

export const NodeIcon: FC<NodeIconProps> = ({ icon, fallback }) => {
  const parsed = parseIconValue(icon);

  if (parsed.kind === 'default') return <>{fallback}</>;
  if (parsed.kind === 'emoji') return <>{parsed.value}</>;

  if (parsed.kind === 'lucide') {
    const Comp = LUCIDE_ICONS[parsed.name];
    if (!Comp) return <>{fallback}</>;
    return (
      <Comp
        size={SIZE}
        strokeWidth={STROKE}
        aria-hidden="true"
        focusable="false"
        style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      />
    );
  }

  // user-svg: async load rendered as img
  return <UserSvgIcon pack={parsed.pack} name={parsed.name} fallback={fallback} />;
};

function UserSvgIcon({ pack, name, fallback }: { pack: string; name: string; fallback: string }) {
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
