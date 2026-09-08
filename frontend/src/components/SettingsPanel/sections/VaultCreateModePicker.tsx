// SKY-11151 / SKY-11141 §3 — THE vault-creation option set as one shared
// radiogroup: template (RECOMMENDED) · blank · import. Every surface that
// creates a vault renders this same component so the three choices can't
// drift between callers; only the surrounding chrome differs. Extracted from
// the SKY-11152 Add-vault dialog (SKY-11452) so Settings "New vault…" could
// reuse it instead of carrying its own (option-less, demo-seeded) form.
//
// Copy per `kind` — 'notes'/'story' verbatim from the design's nvModes (HTML
// ~8977-8989); 'mythos' describes the whole Story Vault + Notes Vault bundle
// the SKY-11151 primitive scaffolds (docs/vault-creation-primitive.md).
import './VaultCreateModePicker.css';

export type VaultCreateMode = 'template' | 'blank' | 'import';
export type VaultCreateKind = 'notes' | 'story' | 'mythos';

interface ModeOption {
  key: VaultCreateMode;
  label: string;
  desc: string;
  recommended?: boolean;
}

export const VAULT_CREATE_MODES: Record<VaultCreateKind, ModeOption[]> = {
  notes: [
    {
      key: 'template',
      label: 'From template',
      desc: 'A ready structure — empty folders for Characters, Locations, Stories, Plot, Worldbuilding and Research. No notes, just the shape.',
      recommended: true,
    },
    { key: 'blank', label: 'Start blank', desc: 'One empty folder. You build the structure yourself as you go.' },
    {
      key: 'import',
      label: 'Import existing',
      desc: 'Bring in an Obsidian or Notion vault, or a plain Markdown folder — folders, notes and wiki-links preserved.',
    },
  ],
  story: [
    {
      key: 'template',
      label: 'From template',
      desc: 'Three acts with placeholder chapters — a spine you can rename and reorder as the story finds its shape.',
      recommended: true,
    },
    { key: 'blank', label: 'Start blank', desc: 'One empty manuscript. Add your first chapter and scene when you are ready.' },
    {
      key: 'import',
      label: 'Import existing',
      desc: 'Bring in a Scrivener project, Word manuscript or Markdown folder — chapters and scenes preserved.',
    },
  ],
  mythos: [
    {
      key: 'template',
      label: 'From template',
      desc: 'A ready shape — empty Notes Vault folders for Characters, Locations, Stories, Plot, Worldbuilding and Research, plus an empty Story Vault. No notes, just the shape.',
      recommended: true,
    },
    {
      key: 'blank',
      label: 'Start blank',
      desc: 'An empty Story Vault and Notes Vault. Nothing in the tree — you build the structure yourself as you go.',
    },
    {
      key: 'import',
      label: 'Import existing',
      desc: 'Copy an Obsidian vault or plain Markdown folder in as the Notes Vault, and/or a Markdown story folder as the Story Vault. The source is never touched.',
    },
  ],
};

interface Props {
  kind: VaultCreateKind;
  value: VaultCreateMode;
  onChange: (mode: VaultCreateMode) => void;
  disabled?: boolean;
  /** data-testid prefix; each option renders as `${testIdPrefix}-${mode}`. */
  testIdPrefix: string;
}

export default function VaultCreateModePicker({ kind, value, onChange, disabled, testIdPrefix }: Props) {
  return (
    <div className="vcm-modes" role="radiogroup" aria-label="How to start">
      {VAULT_CREATE_MODES[kind].map((m) => (
        <button
          key={m.key}
          type="button"
          role="radio"
          aria-checked={value === m.key}
          className={`vcm-mode${value === m.key ? ' vcm-mode--on' : ''}`}
          onClick={() => onChange(m.key)}
          disabled={disabled}
          data-testid={`${testIdPrefix}-${m.key}`}
        >
          <span className="vcm-mode__head">
            <span className="vcm-mode__dot" aria-hidden="true" />
            <span className="vcm-mode__label">{m.label}</span>
            {m.recommended && <span className="vcm-mode__tag">RECOMMENDED</span>}
          </span>
          <span className="vcm-mode__desc">{m.desc}</span>
        </button>
      ))}
    </div>
  );
}
