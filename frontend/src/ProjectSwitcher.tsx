import { useState, useEffect, useRef, useCallback } from 'react';
import { truncatePath, type TruncatePathOptions } from './utils/truncatePath';
import './ProjectSwitcher.css';

interface ProjectEntry {
  name: string;
  vaultRoot: string;
  // SKY-320: paired Notes Vault for atomic switching.
  notesVaultRoot?: string;
  openedAt: string;
}

interface Props {
  activeVaultRoot: string;
  onSwitched: (vaultRoot: string) => void;
}

// SKY-320: parent folder of `<Mythos Vault>/Story Vault/` is the user-facing
// vault name when the bundle layout is followed. Falling back to the Story
// Vault basename keeps display sane for legacy single-folder vaults.
function deriveDisplayName(p: ProjectEntry | { vaultRoot: string; notesVaultRoot?: string }): string {
  const split = (s: string) => s.split(/[/\\]/).filter(Boolean);
  const story = split(p.vaultRoot);
  if (p.notesVaultRoot) {
    const notes = split(p.notesVaultRoot);
    if (story.length >= 2 && notes.length >= 2 && story[story.length - 2] === notes[notes.length - 2]) {
      return story[story.length - 2];
    }
  }
  return story[story.length - 1] ?? p.vaultRoot;
}

export default function ProjectSwitcher({ activeVaultRoot, onSwitched }: Props) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [activeNotesVaultRoot, setActiveNotesVaultRoot] = useState<string | undefined>(undefined);
  const [pathOptions, setPathOptions] = useState<TruncatePathOptions>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const activeName = activeVaultRoot
    ? deriveDisplayName({ vaultRoot: activeVaultRoot, notesVaultRoot: activeNotesVaultRoot })
    : 'No Project';

  const loadProjects = useCallback(async () => {
    try {
      const result = await (window as any).api?.projectList?.();
      if (result?.projects) setProjects(result.projects);
      if (typeof result?.activeNotesVaultRoot === 'string') {
        setActiveNotesVaultRoot(result.activeNotesVaultRoot);
      }
    } catch { /* non-fatal */ }
  }, []);

  // Load on mount and when dropdown opens
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    window.api?.vaultGetPaths?.().then((paths) => {
      setPathOptions({ homeDir: paths.homeDir, sep: paths.pathSeparator });
    }).catch(() => { /* non-fatal */ });
  }, []);

  // Keyboard shortcut: Ctrl/Cmd+Shift+P
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setOpen((o) => {
          if (!o) loadProjects();
          return !o;
        });
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loadProjects]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const handleSwitch = useCallback(async (entry: ProjectEntry) => {
    setOpen(false);
    if (entry.vaultRoot === activeVaultRoot) return;
    try {
      // SKY-320: pass the paired Notes Vault so main switches both halves
      // atomically. Falls back to the legacy single-arg behavior on entries
      // written before pairing.
      const result = await (window as any).api?.projectSwitch?.(entry.vaultRoot, entry.notesVaultRoot);
      if (result?.switched) {
        if (typeof result?.notesVaultRoot === 'string') {
          setActiveNotesVaultRoot(result.notesVaultRoot);
        }
        onSwitched(entry.vaultRoot);
      } else if (result?.error) {
        alert(`Could not switch project: ${result.error}`);
      }
    } catch (err) {
      alert(`Switch failed: ${(err as Error).message}`);
    }
  }, [activeVaultRoot, onSwitched]);

  const handleOpenOther = useCallback(async () => {
    setOpen(false);
    try {
      const result = await (window as any).api?.openVaultFolder?.();
      if (!result?.cancelled && result?.vaultRoot) {
        onSwitched(result.vaultRoot);
      }
    } catch { /* non-fatal */ }
  }, [onSwitched]);

  // SKY-320: Obsidian-style "Create new Mythos Vault" from the switcher.
  // Asks for a friendly name (Cancel → bails) then mints a fresh bundle
  // under ~/Mythos/Vaults/ and switches to it. Custom locations stay
  // available through "Open Other Folder…" + the onboarding wizard.
  const handleCreateNewMythosVault = useCallback(async () => {
    if (creating) return;
    setOpen(false);
    const name = window.prompt('Name for the new Mythos Vault:', '');
    if (name === null) return; // user cancelled
    const trimmed = name.trim();
    if (trimmed && (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..')) {
      alert('Vault name cannot contain slashes or path traversal.');
      return;
    }
    setCreating(true);
    try {
      const result = await (window as any).api?.vaultCreateDefaultMythos?.({
        vaultName: trimmed || undefined,
        seedMode: 'default',
      });
      if (!result || result.error) {
        alert(`Could not create vault: ${result?.error ?? 'unknown error'}`);
        return;
      }
      // Main already persisted settings + added to recents; tell App to
      // reload so the new Story Vault becomes the active surface.
      onSwitched(result.vaultRoot);
      await loadProjects();
    } catch (err) {
      alert(`Create failed: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  }, [creating, loadProjects, onSwitched]);

  const handleBtnClick = () => {
    if (!open) loadProjects();
    setOpen((o) => !o);
  };

  return (
    <div className="project-switcher" ref={dropdownRef}>
      <button
        ref={btnRef}
        className="project-switcher-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active project: ${activeName}. Click to switch projects.`}
        title={`${activeName}\n${activeVaultRoot}\n\nCtrl+Shift+P to open switcher`}
        onClick={handleBtnClick}
      >
        <span className="project-switcher-label">{activeName}</span>
        <span className="project-switcher-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div
          className="project-switcher-dropdown"
          role="listbox"
          aria-label="Recent projects"
        >
          {projects.length > 0 && (
            <>
              <span className="project-switcher-section-label">Mythos Vaults</span>
              {projects.map((p) => {
                const displayName = deriveDisplayName(p) || p.name;
                const tooltip = p.notesVaultRoot
                  ? `${p.vaultRoot}\n${p.notesVaultRoot}`
                  : p.vaultRoot;
                return (
                  <button
                    key={p.vaultRoot}
                    role="option"
                    aria-selected={p.vaultRoot === activeVaultRoot}
                    className={`project-switcher-item${p.vaultRoot === activeVaultRoot ? ' active' : ''}`}
                    onClick={() => handleSwitch(p)}
                    title={tooltip}
                  >
                    <div>
                      <div className="project-switcher-item-name">{displayName}</div>
                      <div className="project-switcher-item-path">{truncatePath(p.vaultRoot, 28, pathOptions)}</div>
                    </div>
                  </button>
                );
              })}
              <div className="project-switcher-sep" role="separator" />
            </>
          )}
          <button
            className="project-switcher-item create-new"
            onClick={handleCreateNewMythosVault}
            disabled={creating}
            data-testid="project-switcher-create-new"
          >
            {creating ? 'Creating…' : '+ Create new Mythos Vault'}
          </button>
          <button
            className="project-switcher-item open-other"
            onClick={handleOpenOther}
          >
            Open Other Folder…
          </button>
        </div>
      )}
    </div>
  );
}
