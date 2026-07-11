// Beta 4 M3 — New Story wizard (BETA-REFINE M3; FULL-SPEC §4; prototype
// "New Story" modal, HTML 3639–3688): name, genre voice preset ("tunes the
// Writing Coach"), and links to existing Notes-Vault plan folders. Creating
// hands a NewStoryDraft to DesktopShell, which makes the story AND writes the
// Story Plan note (see newStoryFlow.ts).

import { useEffect, useRef, useState } from 'react';
import Dialog, { DialogBody, DialogFooter, DialogHeader } from './components/ui/Dialog';
import {
  NEW_STORY_GENRES,
  NEW_STORY_POVS,
  NEW_STORY_VOICES,
  buildFolderOptions,
} from './newStoryFlow';
import type { NewStoryDraft, NoteFolderOption } from './newStoryFlow';
import './NewStoryWizard.css';

export interface NewStoryWizardProps {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: NewStoryDraft) => void;
}

/** Prototype 3672: the timeline info-card line under the folder list. */
export function linkedPlansLabel(count: number): string {
  return count > 0
    ? `${count} plan${count > 1 ? 's' : ''} linked — the planned lane fills from them`
    : 'Nothing linked yet — the timeline starts empty';
}

export default function NewStoryWizard({ open, onClose, onCreate }: NewStoryWizardProps) {
  const [name, setName] = useState('');
  const [genre, setGenre] = useState<string>(NEW_STORY_GENRES[0]);
  const [voice, setVoice] = useState<string>(NEW_STORY_VOICES[0]);
  const [pov, setPov] = useState<string>(NEW_STORY_POVS[0]);
  const [linked, setLinked] = useState<Record<string, boolean>>({});
  const [folders, setFolders] = useState<NoteFolderOption[]>([]);
  // The wizard unmounts a render after create — this guard stops a fast
  // double-click from creating two stories (and two plan notes) in one tick.
  const submittedRef = useRef(false);

  // Fresh form + a fresh Notes-Vault folder listing on every open.
  useEffect(() => {
    if (!open) return;
    submittedRef.current = false;
    setName('');
    setGenre(NEW_STORY_GENRES[0]);
    setVoice(NEW_STORY_VOICES[0]);
    setPov(NEW_STORY_POVS[0]);
    setLinked({});
    setFolders([]);
    let cancelled = false;
    window.api?.listNotesVault?.()
      .then((res) => {
        if (cancelled || !res || 'error' in res) return;
        setFolders(buildFolderOptions(res.items));
      })
      .catch(() => {
        /* no listing → the checklist just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const linkedCount = Object.values(linked).filter(Boolean).length;

  const handleCreate = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCreate({
      name,
      genre,
      voice,
      pov,
      linkedFolders: folders.map((f) => f.path).filter((p) => linked[p]),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} variant="form" aria-labelledby="nsw-title">
      <DialogHeader onClose={onClose}>
        <div>
          <h2 className="nsw-title" id="nsw-title">New Story</h2>
          <p className="nsw-sub">A new story in this vault — with its own timeline, plan, and voice.</p>
        </div>
      </DialogHeader>
      <DialogBody className="nsw-body">
        <div className="nsw-label" id="nsw-name-label">NAME</div>
        <input
          className="nsw-name"
          placeholder="Story name…"
          aria-labelledby="nsw-name-label"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="nsw-name"
        />

        <div className="nsw-label">VOICE — TUNES THE WRITING COACH</div>
        <div className="nsw-voice-row">
          <select
            className="nsw-select"
            aria-label="Genre"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            data-testid="nsw-genre"
          >
            {NEW_STORY_GENRES.map((g) => <option key={g}>{g}</option>)}
          </select>
          <select
            className="nsw-select"
            aria-label="Voice"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            data-testid="nsw-voice"
          >
            {NEW_STORY_VOICES.map((v) => <option key={v}>{v}</option>)}
          </select>
          <select
            className="nsw-select"
            aria-label="Point of view"
            value={pov}
            onChange={(e) => setPov(e.target.value)}
            data-testid="nsw-pov"
          >
            {NEW_STORY_POVS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>

        <div className="nsw-label">LINK YOUR PLANS — FROM THE NOTES VAULT</div>
        <p className="nsw-hint">
          Already planned this story in your notes? Link those folders so the system knows
          which story you&rsquo;re writing. The Archive Agent reads the linked plans to fill
          the <b>planned</b> lane of this story&rsquo;s timeline.
        </p>
        <div className="nsw-folders" role="group" aria-label="Link existing note folders">
          {folders.length === 0 && (
            <div className="nsw-folders-empty">No note folders yet — the Notes Vault is empty.</div>
          )}
          {folders.map((folder) => {
            const on = !!linked[folder.path];
            return (
              <button
                key={folder.path}
                type="button"
                className={`nsw-folder${on ? ' nsw-folder--on' : ''}`}
                aria-pressed={on}
                onClick={() => setLinked((prev) => ({ ...prev, [folder.path]: !prev[folder.path] }))}
                data-testid={`nsw-folder-${folder.path}`}
              >
                <span className="nsw-folder-check" aria-hidden="true">✓</span>
                <span className="nsw-folder-glyph" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
                  </svg>
                </span>
                <span className="nsw-folder-label">{folder.label}</span>
                <span className="nsw-folder-count">{folder.noteCount} notes</span>
              </button>
            );
          })}
        </div>

        <div className="nsw-timeline-card">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M3 12h4l2-6 4 12 2-6h6" />
          </svg>
          <span data-testid="nsw-linked-label">
            Every story gets its <b>own timeline</b>. {linkedPlansLabel(linkedCount)}.
          </span>
        </div>
      </DialogBody>
      <DialogFooter className="nsw-footer">
        <span className="nsw-footnote">
          A Story Plan note is created in this vault — Brainstorm fills the outline.
        </span>
        <button type="button" className="nsw-cancel" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="nsw-create"
          onClick={handleCreate}
          data-testid="nsw-create"
        >
          Create Story ✦
        </button>
      </DialogFooter>
    </Dialog>
  );
}
