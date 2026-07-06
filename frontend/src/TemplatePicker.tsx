// M15: note-template picker — the six templates ported from the Liquid Neon
// prototype's "NEW NOTE — TEMPLATE" popover (ntplItems). Creates a
// correctly-frontmattered note in the Notes Vault, following the same contract
// as the bundled note templates (quoted `title:` + `createdAt:`) plus the
// entity `type:` field the Brainstorm agent writes (character/location/…).
import React, { useState } from 'react';
import './TemplatePicker.css';

export interface NoteTemplateDef {
  id: string;
  name: string;
  description: string;
  /** Entity type written to frontmatter; blank notes carry none. */
  type?: 'character' | 'location' | 'faction' | 'item' | 'event';
  /** `## Section` headings scaffolded into the note body. */
  sections: string[];
}

// Names + descriptions are exactly the prototype's ntplItems (~line 4691).
export const NOTE_TEMPLATES: NoteTemplateDef[] = [
  { id: 'character', name: 'Character', description: 'Bio, arc, relationships, voice', type: 'character', sections: ['Bio', 'Arc', 'Relationships', 'Voice'] },
  { id: 'location', name: 'Location', description: 'Region, environment, danger', type: 'location', sections: ['Region', 'Environment', 'Danger'] },
  { id: 'faction', name: 'Faction', description: 'Goals, members, secrets', type: 'faction', sections: ['Goals', 'Members', 'Secrets'] },
  { id: 'item-system', name: 'Item / System', description: 'Rules, costs, limits', type: 'item', sections: ['Rules', 'Costs', 'Limits'] },
  { id: 'event-history', name: 'Event / History', description: 'Date, impact, witnesses', type: 'event', sections: ['Date', 'Impact', 'Witnesses'] },
  { id: 'blank', name: 'Blank note', description: 'Empty page', sections: [] },
];

// Same slug rules as NoteTemplateDialog (components/NoteTemplateDialog).
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/^-+|-+$/g, '') || 'note';
}

/** Render the full markdown (frontmatter + scaffold body) for a template. */
export function buildTemplateNote(
  template: NoteTemplateDef,
  title: string,
  now: string = new Date().toISOString(),
): string {
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, "'")}"`,
    ...(template.type ? [`type: ${template.type}`] : []),
    `createdAt: ${now}`,
    '---',
  ].join('\n');
  if (template.sections.length === 0) return `${frontmatter}\n\n`;
  const body = template.sections.map((s) => `## ${s}\n\n`).join('\n');
  return `${frontmatter}\n\n# ${title}\n\n${body}`;
}

interface Props {
  onApplied: () => void;
  onClose: () => void;
  /** Optional: receive the vault-relative path of the created note. */
  onCreated?: (path: string) => void;
}

export default function TemplatePicker({ onApplied, onClose, onCreated }: Props) {
  const [selected, setSelected] = useState<NoteTemplateDef | null>(null);
  const [noteName, setNoteName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleGridArrowKeys(e: React.KeyboardEvent<HTMLDivElement>) {
    const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    const idx = cards.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % cards.length;
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   next = (idx - 1 + cards.length) % cards.length;
    if (next !== -1) { e.preventDefault(); cards[next].focus(); }
  }

  const handleApply = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const title =
        noteName.trim() || (selected.id === 'blank' ? 'Untitled note' : `New ${selected.name}`);
      const path = `${slugify(title)}.md`;
      await window.api.writeNotesVault(path, buildTemplateNote(selected, title));
      onCreated?.(path);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create note');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tp-backdrop" role="dialog" aria-modal="true" aria-label="New note from template">
      <div className="tp-modal">
        <div className="tp-header">
          <h2 className="tp-title">New note — template</h2>
          <button className="tp-close" onClick={onClose} aria-label="Close template picker">×</button>
        </div>
        <div className="tp-grid" role="radiogroup" aria-label="Note templates" onKeyDown={handleGridArrowKeys}>
          {NOTE_TEMPLATES.map((t, i) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={selected?.id === t.id}
              className={`tp-card${selected?.id === t.id ? ' tp-card--selected' : ''}`}
              data-testid={`template-${t.id}`}
              tabIndex={selected?.id === t.id || (!selected && i === 0) ? 0 : -1}
              onClick={() => setSelected(t)}
            >
              <span className="tp-card-name">{t.name}</span>
              <span className="tp-card-desc">{t.description}</span>
            </button>
          ))}
        </div>
        <label className="tp-name-label" htmlFor="tp-note-name">Note name</label>
        <input
          id="tp-note-name"
          className="tp-name-input"
          type="text"
          value={noteName}
          onChange={(e) => setNoteName(e.target.value)}
          placeholder={selected && selected.id !== 'blank' ? `New ${selected.name}` : 'Untitled note'}
          data-testid="tp-note-name"
          autoComplete="off"
        />
        {error && <p className="tp-error" role="alert">{error}</p>}
        <div className="tp-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleApply} disabled={!selected || busy} data-testid="tp-apply">
            {busy ? 'Creating…' : `Create "${selected?.name ?? '…'}"`}
          </button>
        </div>
      </div>
    </div>
  );
}
