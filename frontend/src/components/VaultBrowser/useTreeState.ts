import { useState, useCallback } from 'react';

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

  const initExpand = useCallback(
    (paths: Iterable<string>) => {
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
