import { useState, useEffect, useCallback, useRef } from 'react';
import type { VaultListItem } from './treeUtils';

type Source = 'story' | 'notes';

// SKY-9: parameterise the source so the VaultBrowser can pull each vault
// from its own IPC. `story` keeps the existing single-root listing; `notes`
// reads from the Notes Vault root configured in Settings. The fallback
// preserves test-mock compatibility for environments that haven't shipped
// the new preload yet.
export function useVaultFiles(source: Source = 'story') {
  const [items, setItems] = useState<VaultListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const api = window.api as typeof window.api & {
        listNotesVault?: (root?: string) => Promise<{ items?: VaultListItem[]; error?: string }>;
      };
      const result =
        source === 'notes' && typeof api.listNotesVault === 'function'
          ? await api.listNotesVault()
          : await api.listVault();
      setItems(('items' in result ? result.items : undefined) ?? []);
    } catch {
      // vault not ready
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    window.api.startVaultWatch?.().catch(() => {});
    load();

    const unsub = window.api.onVaultFileChanged?.(() => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(load, 150);
    });

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsub?.();
    };
  }, [load]);

  return { items, loading, reload: load };
}
