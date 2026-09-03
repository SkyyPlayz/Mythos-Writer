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
    const scheduleReload = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(load, 150);
    };

    // SKY-11182: subscribe to the change channel that matches this hook's vault.
    // Previously both sources listened on the Story-Vault channel
    // (`vault:file-changed`), so background Story-Vault writes spuriously
    // reloaded the Notes tree, and real Notes-Vault edits (which emit only on
    // `vault:notes-updated`) were missed. Branch on `source` so each tree
    // refreshes on — and only on — its own vault's changes.
    let unsub: (() => void) | undefined;
    if (source === 'notes') {
      // Main starts the Notes watcher (`startNotesVaultWatcher`) on project
      // switch, so no renderer-side watch start is needed here.
      unsub = window.api.onVaultNotesUpdated?.(scheduleReload);
    } else {
      window.api.startVaultWatch?.().catch(() => {});
      unsub = window.api.onVaultFileChanged?.(scheduleReload);
    }

    // SKY-11375: a project switch repoints BOTH vault roots in main, but
    // neither fs-watch channel above fires on switch — so without an explicit
    // reload this tree keeps listing the OUTGOING vault's files (the delete
    // asymmetry the owner saw: a note removed in one vault still showed in the
    // other because that pane was serving a stale, pre-switch tree). Reload
    // from disk on every switch so both trees always reflect the active vault.
    const unsubSwitch = window.api.onProjectSwitched?.(() => { void load(); });

    load();

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsub?.();
      unsubSwitch?.();
    };
  }, [load, source]);

  return { items, loading, reload: load };
}
