// SKY-11169: Story-vault switcher dropdown (mirrors NotesVaultPicker.tsx / SKY-11058).
// Home: LeftRail Zone 0 (top of the Story Writer left panel, above the Story
// Card) — CTO placement ruling on SKY-11169, keeps this control separate from
// the STORY NAVIGATOR stories switcher (SKY-11141 §1).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, type MenuItemDef } from './ui/Menu';
import { useTextPrompt } from '../useTextPrompt';
import './StoryVaultPicker.css';

interface StoryVaultEntry {
  id: string;
  displayName: string;
  dirName: string;
  createdAt: string;
  pairedNotesVaultId: string | null;
}

interface NotesVaultEntry {
  id: string;
  displayName: string;
}

export default function StoryVaultPicker() {
  const [vaults, setVaults] = useState<StoryVaultEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pairMenuOpen, setPairMenuOpen] = useState(false);
  const [notesVaults, setNotesVaults] = useState<NotesVaultEntry[]>([]);
  const [switching, setSwitching] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // window.prompt is unsupported in Electron — useTextPrompt renders the
  // in-app modal replacement instead (same pattern as NotesVaultPicker).
  const { requestText, promptModal } = useTextPrompt();

  const load = useCallback(async () => {
    const result = await window.api?.storyVaultRegistryList?.();
    if (!result || result.vaults === null) return; // legacy vault — hide picker
    setVaults(result.vaults);
    setActiveId(result.activeId);
  }, []);

  useEffect(() => {
    void load();
    const unsub = window.api?.onStoryVaultRegistryChanged?.(() => void load());
    return unsub;
  }, [load]);

  const activeVault = vaults.find((v) => v.id === activeId);

  // Don't render for legacy vaults — vaults stays empty when the api returns
  // null (mirrors NotesVaultPicker; a single registered vault still renders
  // so the create/rename/pair actions are always reachable).
  if (vaults.length === 0) return null;

  const menuItems: MenuItemDef[] = [
    ...vaults.map((v) => ({
      id: `switch:${v.id}`,
      label: v.id === activeId ? `✓ ${v.displayName}` : v.displayName,
    })),
    { id: 'sep-actions', label: '', separator: true, disabled: true },
    { id: 'create', label: '+ New story vault…' },
    { id: 'rename', label: 'Rename active vault…', disabled: !activeVault },
    {
      id: 'pair',
      label: activeVault?.pairedNotesVaultId ? 'Change paired notes vault…' : 'Pair to notes vault…',
      disabled: !activeVault,
    },
  ];

  const handleMenuAction = async (id: string) => {
    setMenuOpen(false);

    if (id === 'create') {
      const name = await requestText('Story vault name:');
      if (!name?.trim()) return;
      // Deliberately no setActive here — a freshly created vault becomes
      // active only when the user explicitly switches to it (mirrors
      // NotesVaultPicker's create-doesn't-activate behavior).
      await window.api?.storyVaultRegistryCreate?.({ displayName: name.trim() });
      return;
    }

    if (id === 'rename') {
      if (!activeVault) return;
      const name = await requestText('Rename story vault:', activeVault.displayName);
      if (!name?.trim() || name.trim() === activeVault.displayName) return;
      await window.api?.storyVaultRegistryRename?.(activeVault.id, name.trim());
      return;
    }

    if (id === 'pair') {
      if (!activeVault) return;
      const result = await window.api?.notesVaultRegistryList?.();
      setNotesVaults(result?.vaults ?? []);
      setPairMenuOpen(true);
      return;
    }

    if (id.startsWith('switch:')) {
      const targetId = id.slice('switch:'.length);
      if (targetId === activeId) return;
      // No pre-switch confirmation dialog: unlike notes vaults, story vaults
      // don't carry [[wikilink]] resolution state — a plain switch mirrors
      // storyVaultRegistry:setActive's own no-preview IPC surface.
      setSwitching(true);
      try {
        await window.api?.storyVaultRegistrySetActive?.(targetId);
      } finally {
        setSwitching(false);
      }
    }
  };

  const handlePairAction = async (id: string) => {
    setPairMenuOpen(false);
    if (!activeVault) return;
    if (id === 'unpair') {
      await window.api?.storyVaultRegistryPair?.(activeVault.id, null);
      return;
    }
    if (id.startsWith('pair:')) {
      const notesId = id.slice('pair:'.length);
      await window.api?.storyVaultRegistryPair?.(activeVault.id, notesId);
    }
  };

  const pairMenuItems: MenuItemDef[] = notesVaults.length
    ? [
        ...notesVaults.map((v) => ({
          id: `pair:${v.id}`,
          label: v.id === activeVault?.pairedNotesVaultId ? `✓ ${v.displayName}` : v.displayName,
        })),
        ...(activeVault?.pairedNotesVaultId
          ? [{ id: 'sep-unpair', label: '', separator: true, disabled: true }, { id: 'unpair', label: 'Unpair' }]
          : []),
      ]
    : [{ id: 'none', label: 'No notes vaults yet', disabled: true }];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="story-vault-picker-btn"
        aria-label={`Story vault: ${activeVault?.displayName ?? 'Story'}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        data-testid="story-vault-picker-btn"
        title="Switch story vault"
        disabled={switching}
      >
        <span className="story-vault-picker-name">
          {switching ? 'Switching…' : activeVault?.displayName ?? 'Story'}
        </span>
        <span className="story-vault-picker-chevron" aria-hidden>▾</span>
      </button>

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onAction={(id) => void handleMenuAction(id)}
        items={menuItems}
        anchorEl={btnRef.current}
        aria-label="Story vault options"
        data-testid="story-vault-picker-menu"
      />

      <Menu
        open={pairMenuOpen}
        onClose={() => setPairMenuOpen(false)}
        onAction={(id) => void handlePairAction(id)}
        items={pairMenuItems}
        anchorEl={btnRef.current}
        aria-label="Pair to notes vault"
        data-testid="story-vault-picker-pair-menu"
      />

      {promptModal}
    </>
  );
}
