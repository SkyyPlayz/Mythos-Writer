// Beta 3 "Liquid Neon" M24 — Settings → Vault & Files → Import another vault
// (prototype 1922–1943). Obsidian is native — Notion, Scrivener and plain
// Markdown convert on the way in. Reuses the Beta-2 wizard shape: pick source
// → dry-run scan report → confirm → import. Destination is either a second
// vault folder inside the current Notes Vault (default) or its own new folder.
import { useState } from 'react';
import { M24Card, M24Seg } from './M24Controls';
import './M24Sections.css';

interface Props {
  /** Current Notes Vault root — shown as the "second vault" destination. */
  notesVaultPath: string;
}

type Scan = {
  noteCount: number;
  attachmentCount: number;
  totalFiles: number;
  sampleFiles: string[];
  warnings: string[];
};

const KIND_OPTIONS: [SettingsVaultImportKind, string][] = [
  ['obsidian', 'Obsidian'],
  ['notion', 'Notion'],
  ['scriv', 'Scrivener'],
  ['markdown', 'Markdown'],
];

const KIND_HINTS: Record<SettingsVaultImportKind, string> = {
  obsidian: 'Pick your Obsidian vault folder — notes, folders and [[links]] come across as-is.',
  notion: 'Pick an unzipped Notion export folder — page-id suffixes are stripped and links become wiki links.',
  scriv: 'Pick the .scrivx file inside your Scrivener project — binder documents become notes.',
  markdown: 'Pick any folder of .md files — the tree is preserved.',
};

export default function ImportVaultSection({ notesVaultPath }: Props) {
  const [kind, setKind] = useState<SettingsVaultImportKind>('obsidian');
  const [into, setInto] = useState<'second' | 'new'>('second');
  const [srcPath, setSrcPath] = useState('');
  const [newTargetPath, setNewTargetPath] = useState('');
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setScan(null);
    setError(null);
    setDone(null);
  };

  const pickSource = async () => {
    try {
      const res = await window.api.chooseVaultFolder(
        kind === 'scriv' ? 'Pick your Scrivener project folder' : 'Pick the vault folder to import',
        srcPath || undefined,
      );
      if (!res.cancelled && res.path) {
        setSrcPath(res.path);
        reset();
      }
    } catch {
      /* picker unavailable */
    }
  };

  const pickNewTarget = async () => {
    try {
      const res = await window.api.chooseVaultFolder('Pick a folder for the new vault', newTargetPath || undefined);
      if (!res.cancelled && res.path) setNewTargetPath(res.path);
    } catch {
      /* picker unavailable */
    }
  };

  const runScan = async () => {
    if (!srcPath || busy) return;
    setBusy(true);
    reset();
    try {
      const res = await window.api.vaultImportScan(kind, srcPath);
      if (!res.ok) {
        setError(res.error ?? 'Could not scan this folder. Check the path and try again.');
      } else {
        setScan({
          noteCount: res.noteCount ?? 0,
          attachmentCount: res.attachmentCount ?? 0,
          totalFiles: res.totalFiles ?? 0,
          sampleFiles: res.sampleFiles ?? [],
          warnings: res.warnings ?? [],
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not scan this folder.');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!scan || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.vaultImportRun({
        kind,
        srcPath,
        into,
        ...(into === 'new' ? { targetPath: newTargetPath } : {}),
      });
      if (!res.ok) {
        setError(res.error ?? 'Import failed. Check the folder and try again.');
      } else {
        setScan(null);
        setDone(
          `${res.imported ?? 0} file${(res.imported ?? 0) === 1 ? '' : 's'} imported`
          + `${(res.skipped ?? 0) > 0 ? ` (${res.skipped} already present, skipped)` : ''}`
          + ` → ${res.targetPath ?? ''}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section m24-root" aria-labelledby="section-import-vault" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-import-vault">Import another vault</h3>

      <M24Card
        title="Import another vault"
        sub="Obsidian is native — Notion, Scrivener and plain Markdown convert on the way in. The Brainstorm Agent can read and edit every vault."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <M24Seg
            options={KIND_OPTIONS}
            current={kind}
            onPick={(k) => { setKind(k); reset(); }}
            ariaLabel="Import source"
            testIdPrefix="import-vault-kind"
          />
        </div>
        <div style={{ fontSize: 10.5, color: '#7686a2', margin: '8px 0 10px' }}>{KIND_HINTS[kind]}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className="m24-path" data-testid="import-vault-src" title={srcPath || undefined}>
            {srcPath || 'No folder selected'}
          </span>
          <button type="button" className="m24-btn" onClick={() => { void pickSource(); }} disabled={busy} data-testid="import-vault-browse">
            Browse…
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: '#8e9db8' }}>Import as</span>
          <M24Seg
            options={[['second', 'Second vault in this universe'], ['new', 'Its own new vault']]}
            current={into}
            onPick={(k) => { setInto(k); setDone(null); }}
            ariaLabel="Import destination"
            testIdPrefix="import-vault-into"
          />
        </div>
        {into === 'second' ? (
          <div style={{ fontSize: 10.5, color: '#7686a2', marginBottom: 10 }}>
            Lands in <span style={{ fontFamily: 'ui-monospace,monospace' }}>Imported/</span> inside your Notes Vault
            {notesVaultPath ? ` (${notesVaultPath})` : ''} — it shows up in the notes tree next to your own folders.
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span className="m24-path" data-testid="import-vault-new-target" title={newTargetPath || undefined}>
              {newTargetPath || 'Pick a destination folder for the new vault'}
            </span>
            <button type="button" className="m24-btn" onClick={() => { void pickNewTarget(); }} disabled={busy} data-testid="import-vault-new-browse">
              Browse…
            </button>
          </div>
        )}

        {!scan && (
          <button
            type="button"
            className="m24-btn m24-btn--accent"
            onClick={() => { void runScan(); }}
            disabled={busy || !srcPath || (into === 'new' && !newTargetPath)}
            data-testid="import-vault-dry-run"
          >
            {busy ? 'Scanning…' : 'Dry-run import…'}
          </button>
        )}

        {scan && (
          <div
            data-testid="import-vault-report"
            style={{
              marginTop: 4, padding: 12, borderRadius: 12,
              background: 'var(--gs1,rgba(0,240,255,.06))',
              border: 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.45))',
            }}
          >
            <div style={{ fontSize: 11.5, color: '#dbe4f5', marginBottom: 6 }}>
              Dry-run clean — {scan.noteCount} note{scan.noteCount === 1 ? '' : 's'}
              {scan.attachmentCount > 0 ? ` · ${scan.attachmentCount} attachment${scan.attachmentCount === 1 ? '' : 's'}` : ''}. Nothing written yet.
            </div>
            {scan.sampleFiles.length > 0 && (
              <div style={{ fontSize: 10.5, color: '#8e9db8', marginBottom: 6 }}>
                e.g. {scan.sampleFiles.slice(0, 3).join(' · ')}
              </div>
            )}
            {scan.warnings.map((w) => (
              <div key={w} style={{ fontSize: 10.5, color: '#ffd97a', marginBottom: 4 }}>{w}</div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="m24-btn m24-btn--primary" onClick={() => { void runImport(); }} disabled={busy} data-testid="import-vault-confirm">
                {busy ? 'Importing…' : `Import ${scan.totalFiles} file${scan.totalFiles === 1 ? '' : 's'}`}
              </button>
              <button type="button" className="m24-btn" onClick={reset} disabled={busy} data-testid="import-vault-back">
                Back
              </button>
            </div>
          </div>
        )}

        {done && (
          <p className="settings-saved-msg" role="status" aria-live="polite" data-testid="import-vault-done">
            Vault imported — {done}
          </p>
        )}
        {error && (
          <p className="settings-error-msg" role="alert" data-testid="import-vault-error">{error}</p>
        )}
      </M24Card>
    </section>
  );
}
