interface Props {
  mode: 'idle' | 'no-match' | 'no-vault';
}

const MESSAGES = {
  idle: {
    icon: '◈',
    title: 'No selection',
    body: 'Select text in the editor to look up an entity, or type a name in the search box.',
  },
  'no-match': {
    icon: '○',
    title: 'No entity found',
    body: 'Nothing in the Notes Vault matched this selection. Try the search box above.',
  },
  'no-vault': {
    icon: '⚠',
    title: 'No Notes Vault linked',
    body: 'Link a Notes Vault in Settings to enable entity lookup.',
  },
};

export default function ContinuityEmptyState({ mode }: Props) {
  const msg = MESSAGES[mode];
  return (
    <div className="continuity-empty" role="status" aria-live="polite">
      <span className="continuity-empty-icon" aria-hidden="true">{msg.icon}</span>
      <span className="continuity-empty-title">{msg.title}</span>
      <span className="continuity-empty-body">{msg.body}</span>
    </div>
  );
}
