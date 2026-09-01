// SKY-11058: Notes vault switcher dropdown (FULL-SPEC §119).
// Shows the active notes vault name + chevron; opens a menu listing all
// registered notes vaults and options to create or import one.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, type MenuItemDef } from './ui/Menu';
import Dialog, {
  DialogHeader,
  DialogBody,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { useTextPrompt } from '../useTextPrompt';

interface NotesVaultEntry {
  id: string;
  displayName: string;
  dirName: string;
  createdAt: string;
  origin: 'created' | 'imported';
}

interface NotesVaultPickerProps {
  /** Called when the user chooses "Import a vault…". Caller opens the import UI. */
  onImportVault?: () => void;
}

interface LinkReport {
  resolvedCount: number;
  unresolvedStems: string[];
  totalStems: number;
}

interface PendingSwitch {
  entry: NotesVaultEntry;
  report: LinkReport;
}

export default function NotesVaultPicker({ onImportVault }: NotesVaultPickerProps = {}) {
  const [vaults, setVaults] = useState<NotesVaultEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [switching, setSwitching] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // window.prompt is unsupported in Electron ("prompt() is not supported") —
  // useTextPrompt renders the in-app modal replacement instead.
  const { requestText, promptModal } = useTextPrompt();

  const load = useCallback(async () => {
    const result = await window.api?.notesVaultRegistryList?.();
    if (!result || result.vaults === null) return; // legacy vault — hide picker
    setVaults(result.vaults);
    setActiveId(result.activeId);
  }, []);

  useEffect(() => {
    void load();
    const unsub = window.api?.onNotesVaultRegistryChanged?.(() => void load());
    return unsub;
  }, [load]);

  const activeVault = vaults.find((v) => v.id === activeId);

  // Don't render for legacy vaults (vaults is empty array when api returned null)
  // or when there's only one vault (nothing to switch).
  if (vaults.length === 0) return null;

  const menuItems: MenuItemDef[] = [
    ...vaults.map((v) => ({
      id: `switch:${v.id}`,
      label: v.id === activeId ? `✓ ${v.displayName}` : v.displayName,
    })),
    { id: 'sep-actions', label: '', separator: true, disabled: true },
    { id: 'create', label: '+ New notes vault…' },
    { id: 'import', label: 'Import a vault…' },
  ];

  const handleMenuAction = async (id: string) => {
    setMenuOpen(false);

    if (id === 'create') {
      const name = await requestText('Notes vault name:');
      if (!name?.trim()) return;
      // Deliberately no setActive here — a freshly created vault becomes
      // active only when the user explicitly switches to it (SKY-11058).
      await window.api?.notesVaultRegistryCreate?.(name.trim());
      return;
    }

    if (id === 'import') {
      onImportVault?.();
      return;
    }

    if (id.startsWith('switch:')) {
      const targetId = id.slice('switch:'.length);
      if (targetId === activeId) return;

      const target = vaults.find((v) => v.id === targetId);
      if (!target) return;

      // Get the link resolution preview before switching.
      const report = await window.api?.notesVaultRegistrySetActivePreview?.(targetId);
      if (!report) return;

      if (report.totalStems === 0) {
        // No links in story — switch immediately, no dialog needed.
        await window.api?.notesVaultRegistrySetActive?.(targetId);
        return;
      }

      // Show the confirm dialog with the report.
      setPending({ entry: target, report });
    }
  };

  const handleConfirmSwitch = async () => {
    if (!pending) return;
    setSwitching(true);
    try {
      await window.api?.notesVaultRegistrySetActive?.(pending.entry.id);
    } finally {
      setSwitching(false);
      setPending(null);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="notes-vault-picker-btn"
        aria-label={`Notes vault: ${activeVault?.displayName ?? 'Notes'}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        data-testid="notes-vault-picker-btn"
        title="Switch notes vault"
      >
        <span className="notes-vault-picker-name">
          {activeVault?.displayName ?? 'Notes'}
        </span>
        <span className="notes-vault-picker-chevron" aria-hidden>▾</span>
      </button>

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onAction={(id) => void handleMenuAction(id)}
        items={menuItems}
        anchorEl={btnRef.current}
        aria-label="Notes vault options"
        data-testid="notes-vault-picker-menu"
      />

      {promptModal}

      {pending && (
        <Dialog
          open
          onClose={() => setPending(null)}
          aria-labelledby="nvp-dialog-title"
          aria-describedby="nvp-dialog-body"
          testId="notes-vault-switch-dialog"
        >
          <DialogHeader onClose={() => setPending(null)}>
            <span id="nvp-dialog-title">Switch to &ldquo;{pending.entry.displayName}&rdquo;?</span>
          </DialogHeader>
          <DialogBody id="nvp-dialog-body">
            <p>
              <strong>{pending.report.resolvedCount}</strong> of{' '}
              <strong>{pending.report.totalStems}</strong> linked notes resolve in this vault.
            </p>
            {pending.report.unresolvedStems.length > 0 && (
              <>
                <p>
                  These {pending.report.unresolvedStems.length} link
                  {pending.report.unresolvedStems.length === 1 ? '' : 's'} will show as unresolved:
                </p>
                <ul className="notes-vault-picker-unresolved">
                  {pending.report.unresolvedStems.slice(0, 20).map((stem) => (
                    <li key={stem}>
                      <code>[[{stem}]]</code>
                    </li>
                  ))}
                  {pending.report.unresolvedStems.length > 20 && (
                    <li>…and {pending.report.unresolvedStems.length - 20} more</li>
                  )}
                </ul>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={switching}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleConfirmSwitch()}
              disabled={switching}
              data-testid="notes-vault-switch-confirm"
            >
              {switching ? 'Switching…' : 'Switch vault'}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}
