// SKY-11068 — shared vault-icon state for the story switcher (WindowChrome)
// and Settings > Mythos vaults (MythosVaultsSection). Icons are vault-local
// (mythos.json + a file at the mythos root), so this hook is a thin cache
// over window.api.projectIcons/projectIconSet/projectIconPick.
import { useCallback, useState } from 'react';

export type VaultIconSetInput =
  | { kind: 'glyph'; value: string }
  | { kind: 'image'; sourcePath: string }
  | null;

export function useVaultIcons() {
  const [icons, setIcons] = useState<Record<string, VaultIconRef>>({});

  const loadIcons = useCallback(() => {
    window.api?.projectIcons?.()
      .then((res) => {
        if (!res?.icons) return;
        const byRoot: Record<string, VaultIconRef> = {};
        for (const icon of res.icons) byRoot[icon.vaultRoot] = icon;
        setIcons(byRoot);
      })
      .catch(() => {});
  }, []);

  const setVaultIcon = useCallback((vaultRoot: string, icon: VaultIconSetInput) => {
    return window.api?.projectIconSet?.({ vaultRoot, icon } as never)
      .then((res) => {
        if (res?.ok && res.icon) {
          setIcons((prev) => ({ ...prev, [vaultRoot]: res.icon as VaultIconRef }));
        }
        return res;
      })
      .catch(() => undefined);
  }, []);

  const pickIconImage = useCallback(() => {
    return window.api?.projectIconPick?.().catch(() => undefined);
  }, []);

  return { icons, loadIcons, setVaultIcon, pickIconImage };
}
