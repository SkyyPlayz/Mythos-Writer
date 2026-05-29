import { useState, useEffect, useCallback, useRef } from 'react';
import type { VaultListItem } from './treeUtils';

export function useVaultFiles() {
  const [items, setItems] = useState<VaultListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await window.api.listVault();
      setItems(result.items ?? []);
    } catch {
      // vault not ready
    } finally {
      setLoading(false);
    }
  }, []);

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
