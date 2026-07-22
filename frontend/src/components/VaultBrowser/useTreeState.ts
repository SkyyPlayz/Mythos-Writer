import { useState, useCallback, useRef } from 'react';

const LS_PREFIX = 'vb-expanded:';

function loadExpanded(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore parse errors
  }
  return new Set();
}

function saveExpanded(key: string, set: Set<string>) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify([...set]));
  } catch {
    // ignore quota errors
  }
}

export function useTreeState(storageKey: string) {
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(storageKey));
  const [selected, setSelected] = useState<string | null>(null);

  const toggle = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        saveExpanded(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  // SKY-7995: this must only seed the expand state once per mount, on the
  // *first* tree render — not every time the tree shape changes (new/renamed/
  // deleted files bump treeLen in VaultBrowser's effect). Gating on
  // `prev.size > 0` alone re-fired after Collapse All (which sets the set to
  // size 0) and silently re-expanded every folder on the very next tree
  // change, making "Collapse all" impossible to keep collapsed.
  const initializedRef = useRef(false);
  const initExpand = useCallback(
    (paths: Iterable<string>) => {
      if (initializedRef.current) return;
      initializedRef.current = true;
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<string>(paths);
        saveExpanded(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const setExpandedPaths = useCallback(
    (paths: Iterable<string>) => {
      setExpanded(() => {
        const next = new Set<string>(paths);
        saveExpanded(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const reveal = useCallback(
    (path: string) => {
      setSelected(path);
      setExpanded((prev) => {
        const next = new Set(prev);
        const parts = path.split('/').filter(Boolean);
        for (let i = 1; i < parts.length; i += 1) {
          next.add(parts.slice(0, i).join('/'));
        }
        saveExpanded(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const select = useCallback((path: string) => setSelected(path), []);

  return { expanded, selected, toggle, initExpand, setExpandedPaths, reveal, select };
}
