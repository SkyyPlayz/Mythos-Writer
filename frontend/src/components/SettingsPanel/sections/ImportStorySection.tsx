// Beta 3 "Liquid Neon" M24 — Settings → Vault & Files → Import a story
// (prototype 1944–1955). Bring a manuscript in from anywhere — headings map
// to parts, chapters and scenes; a Story Plan note is created in the Notes
// Vault (Plans/) and the timeline builds from it.
import { useState } from 'react';
import { M24Card, M24Seg } from './M24Controls';
import './M24Sections.css';

const FORMAT_OPTIONS: [SettingsStoryImportFormat, string][] = [
  ['docx', 'Word .docx'],
  ['gdoc', 'Google Docs'],
  ['md', 'Markdown'],
  ['scriv', 'Scrivener'],
  ['epub', 'ePub'],
];

const FORMAT_HINTS: Record<SettingsStoryImportFormat, string> = {
  docx: 'Heading 1 → part or chapter, Heading 2 → chapter or scene — exactly as styled in Word.',
  gdoc: 'In Google Docs use File → Download → Word (.docx) or Web page (.html), then pick that file.',
  md: '# / ## / ### headings map to parts, chapters and scenes.',
  scriv: 'Pick the .scrivx file inside your project — binder folders become chapters, documents become scenes.',
  epub: 'Spine documents are read in order; chapter headings split the book.',
};

interface Done {
  storyTitle: string;
  partCount: number;
  chapterCount: number;
  sceneCount: number;
  planNotePath?: string;
  warnings: string[];
}

export default function ImportStorySection() {
  const [format, setFormat] = useState<SettingsStoryImportFormat>('docx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const runImport = async () => {
    if (busy) return;
    setError(null);
    setDone(null);
    try {
      const picked = await window.api.storyImportPickFile(format);
      if (picked.cancelled || !picked.filePath) return;
      setBusy(true);
      const res = await window.api.storyImportRun(format, picked.filePath);
      if (!res.ok) {
        setError(res.error ?? 'Import failed. Check the file and try again.');
        return;
      }
      setDone({
        storyTitle: res.storyTitle ?? 'Imported Story',
        partCount: res.partCount ?? 0,
        chapterCount: res.chapterCount ?? 0,
        sceneCount: res.sceneCount ?? 0,
        planNotePath: res.planNotePath,
        warnings: res.warnings ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section m24-root" aria-labelledby="section-import-story" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-import-story">Import a story</h3>

      <M24Card
        title="Import a story"
        sub="Bring a manuscript in from anywhere — headings map to parts, chapters and scenes; a Story Plan note is created and the timeline builds from it."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <M24Seg
            options={FORMAT_OPTIONS}
            current={format}
            onPick={(k) => { setFormat(k); setError(null); setDone(null); }}
            ariaLabel="Story format"
            testIdPrefix="import-story-format"
          />
          <button
            type="button"
            className="m24-btn m24-btn--primary"
            onClick={() => { void runImport(); }}
            disabled={busy}
            data-testid="import-story-run"
          >
            {busy ? 'Importing…' : 'Import story…'}
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: '#7686a2', marginTop: 8 }}>{FORMAT_HINTS[format]}</div>

        {done && (
          <div style={{ marginTop: 10 }} data-testid="import-story-done">
            <p className="settings-saved-msg" role="status" aria-live="polite">
              “{done.storyTitle}” imported —
              {done.partCount > 0 ? ` ${done.partCount} part${done.partCount === 1 ? '' : 's'},` : ''}
              {' '}{done.chapterCount} chapter{done.chapterCount === 1 ? '' : 's'}, {done.sceneCount} scene{done.sceneCount === 1 ? '' : 's'}.
              {done.planNotePath ? ` Story Plan note created (${done.planNotePath}).` : ''}
            </p>
            {done.warnings.map((w) => (
              <div key={w} style={{ fontSize: 10.5, color: '#ffd97a', marginTop: 4 }}>{w}</div>
            ))}
          </div>
        )}
        {error && (
          <p className="settings-error-msg" role="alert" data-testid="import-story-error">{error}</p>
        )}
      </M24Card>
    </section>
  );
}
