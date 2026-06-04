import { useEffect, useRef, useState, useMemo } from 'react';
import { SHORTCUT_GROUPS } from './shortcuts';
import './KeyboardShortcutsDialog.css';

interface Props {
  onClose: () => void;
}

export default function KeyboardShortcutsDialog({ onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUT_GROUPS;
    return SHORTCUT_GROUPS
      .map((group) => ({
        ...group,
        entries: group.entries.filter(
          (entry) =>
            entry.action.toLowerCase().includes(q) ||
            entry.keys.some((k) => k.toLowerCase().includes(q)),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [query]);

  return (
    <div className="ksd-backdrop" onClick={onClose} role="presentation">
      <div
        className="ksd-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ksd-header">
          <span className="ksd-title">Keyboard Shortcuts</span>
          <button className="ksd-close" onClick={onClose} aria-label="Close keyboard shortcuts">×</button>
        </div>
        <div className="ksd-search-row">
          <input
            ref={searchRef}
            className="ksd-search"
            type="search"
            placeholder="Filter shortcuts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter shortcuts"
          />
        </div>
        <div className="ksd-body" aria-live="polite">
          {filteredGroups.length === 0 ? (
            <p className="ksd-empty">No shortcuts match &ldquo;{query}&rdquo;</p>
          ) : (
            filteredGroups.map((group) => (
              <section key={group.label} className="ksd-group">
                <h3 className="ksd-group-label">{group.label}</h3>
                <table className="ksd-table" role="table">
                  <tbody>
                    {group.entries.map((entry, i) => (
                      <tr key={i} className="ksd-row">
                        <td className="ksd-keys">
                          {entry.keys.map((k, ki) => (
                            <span key={ki}>
                              {ki > 0 && <span className="ksd-or"> or </span>}
                              <kbd className="ksd-key">{k}</kbd>
                            </span>
                          ))}
                        </td>
                        <td className="ksd-action">{entry.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
