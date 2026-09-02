// SKY-11152 (parent spec SKY-11141 §3c) — Vault & Files tab entry points for
// the shared AddVaultDialog. Kept as its own tiny section (rather than
// folded into MythosVaultsSection) so this ticket's surface is a clean diff
// against a component owned by a different ticket (SKY-10401).
import { useState } from 'react';
import AddVaultDialog, { type AddVaultKind } from './AddVaultDialog';

export default function AddVaultButtonsSection() {
  const [openKind, setOpenKind] = useState<AddVaultKind | null>(null);

  return (
    <section className="settings-section" aria-labelledby="section-add-vault">
      <h3 className="settings-section-title" id="section-add-vault">Add a vault</h3>
      <p className="settings-hint">
        Add another Notes Vault or Story Vault inside the current Mythos vault.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="m24-btn m24-btn--primary"
          data-testid="add-notes-vault-btn"
          onClick={() => setOpenKind('notes')}
        >
          + Add Notes Vault
        </button>
        <button
          type="button"
          className="m24-btn m24-btn--primary"
          data-testid="add-story-vault-btn"
          onClick={() => setOpenKind('story')}
        >
          + Add Story Vault
        </button>
      </div>
      <AddVaultDialog kind="notes" open={openKind === 'notes'} onClose={() => setOpenKind(null)} />
      <AddVaultDialog kind="story" open={openKind === 'story'} onClose={() => setOpenKind(null)} />
    </section>
  );
}
