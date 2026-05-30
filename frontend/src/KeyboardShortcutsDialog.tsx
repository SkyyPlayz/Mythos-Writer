import { useEffect, useRef } from 'react';
import './KeyboardShortcutsDialog.css';

interface ShortcutRow {
  keys: string[];
  action: string;
}

interface ShortcutGroup {
  label: string;
  rows: ShortcutRow[];
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

const GROUPS: ShortcutGroup[] = [
  {
    label: 'Global',
    rows: [
      { keys: [`${mod}+Shift+N`], action: 'Switch to Normal mode' },
      { keys: [`${mod}+Shift+F`], action: 'Switch to Focus mode' },
      { keys: [`${mod}+Shift+E`], action: 'Switch to Edit mode' },
      { keys: [`${mod}+Shift+P`], action: 'Toggle Project Switcher' },
      { keys: ['?'], action: 'Open Keyboard Shortcuts help' },
      { keys: ['Escape'], action: 'Close modal / dismiss overlay' },
    ],
  },
  {
    label: 'Editor — Navigation',
    rows: [
      { keys: [`${mod}+Alt+↑`], action: 'Zoom view depth up (Scene → Chapter → Book)' },
      { keys: [`${mod}+Alt+↓`], action: 'Zoom view depth down' },
      { keys: [`${mod}+Alt+←`], action: 'Previous scene or chapter' },
      { keys: [`${mod}+Alt+→`], action: 'Next scene or chapter' },
    ],
  },
  {
    label: 'Editor — Text (Tiptap)',
    rows: [
      { keys: [`${mod}+B`], action: 'Bold' },
      { keys: [`${mod}+I`], action: 'Italic' },
      { keys: [`${mod}+Z`], action: 'Undo' },
      { keys: [`${mod}+Shift+Z`], action: 'Redo' },
    ],
  },
  {
    label: 'Story Navigator',
    rows: [
      { keys: ['Enter', 'Space'], action: 'Open selected scene' },
      { keys: ['↑'], action: 'Move scene up in chapter' },
      { keys: ['↓'], action: 'Move scene down in chapter' },
    ],
  },
  {
    label: 'Suggestion Review',
    rows: [
      { keys: ['Enter'], action: 'Accept suggestion' },
      { keys: ['Delete', 'Backspace'], action: 'Reject suggestion' },
      { keys: ['I'], action: 'Ignore suggestion' },
    ],
  },
  {
    label: 'Brainstorm & Writing Assistant',
    rows: [
      { keys: ['Enter'], action: 'Submit prompt' },
      { keys: ['Shift+Enter'], action: 'Insert newline in prompt' },
    ],
  },
  {
    label: 'Search Bar',
    rows: [
      { keys: ['↓', '↑'], action: 'Navigate results' },
      { keys: ['Enter'], action: 'Select highlighted result' },
      { keys: ['Escape'], action: 'Close results' },
    ],
  },
  {
    label: 'Right Sidebar',
    rows: [
      { keys: ['→'], action: 'Next sidebar tab' },
      { keys: ['←'], action: 'Previous sidebar tab' },
    ],
  },
];

interface Props {
  onClose: () => void;
}

export default function KeyboardShortcutsDialog({ onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.focus();
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
        <div className="ksd-body">
          {GROUPS.map((group) => (
            <section key={group.label} className="ksd-group">
              <h3 className="ksd-group-label">{group.label}</h3>
              <table className="ksd-table" role="table">
                <tbody>
                  {group.rows.map((row, i) => (
                    <tr key={i} className="ksd-row">
                      <td className="ksd-keys">
                        {row.keys.map((k, ki) => (
                          <span key={ki}>
                            {ki > 0 && <span className="ksd-or"> or </span>}
                            <kbd className="ksd-key">{k}</kbd>
                          </span>
                        ))}
                      </td>
                      <td className="ksd-action">{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
