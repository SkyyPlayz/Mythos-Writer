import { useState, useEffect, useRef, useCallback } from 'react';
import './ProjectSwitcher.css';

interface ProjectEntry {
  name: string;
  vaultRoot: string;
  openedAt: string;
}

interface Props {
  activeVaultRoot: string;
  onSwitched: (vaultRoot: string) => void;
}

export default function ProjectSwitcher({ activeVaultRoot, onSwitched }: Props) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const activeName = activeVaultRoot
    ? activeVaultRoot.split(/[/\\]/).filter(Boolean).pop() ?? activeVaultRoot
    : 'No Project';

  const loadProjects = useCallback(async () => {
    try {
      const result = await (window as any).api?.projectList?.();
      if (result?.projects) setProjects(result.projects);
    } catch { /* non-fatal */ }
  }, []);

  // Load on mount and when dropdown opens
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

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

  const handleSwitch = useCallback(async (vaultRoot: string) => {
    setOpen(false);
    if (vaultRoot === activeVaultRoot) return;
    try {
      const result = await (window as any).api?.projectSwitch?.(vaultRoot);
      if (result?.switched) {
        onSwitched(vaultRoot);
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
              <span className="project-switcher-section-label">Recent Projects</span>
              {projects.map((p) => (
                <button
                  key={p.vaultRoot}
                  role="option"
                  aria-selected={p.vaultRoot === activeVaultRoot}
                  className={`project-switcher-item${p.vaultRoot === activeVaultRoot ? ' active' : ''}`}
                  onClick={() => handleSwitch(p.vaultRoot)}
                  title={p.vaultRoot}
                >
                  <div>
                    <div className="project-switcher-item-name">{p.name}</div>
                    <div className="project-switcher-item-path">{p.vaultRoot}</div>
                  </div>
                </button>
              ))}
              <div className="project-switcher-sep" role="separator" />
            </>
          )}
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
