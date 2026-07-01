import { useState, useRef, useCallback, useEffect } from 'react';
import './EntriesQuickAdd.css';

export const ENTRIES_SYSTEM_PROMPT =
  'You are a creative writing assistant. The user has jotted down a quick entry — a brief idea, character note, plot point, scene snippet, or worldbuilding thought. Expand it into a concise, well-structured note (2–4 short paragraphs) suitable for a story development vault. Write in a clear reference-note style. Do not include FACT tags. Do not ask follow-up questions.';

export const ENTRIES_MAX_TOKENS = 512;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function makeFilename(text: string): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const slug = slugify(text.slice(0, 60)) || 'entry';
  return `${ts}-${slug}.md`;
}

export function buildNoteContent(isoNow: string, body: string): string {
  return ['---', 'entry: true', 'source: quick-add', `createdAt: ${isoNow}`, '---', '', body.trim()].join(
    '\n',
  );
}

interface Props {
  onEntrySaved?: (path: string) => void;
}

export default function EntriesQuickAdd({ onEntrySaved }: Props) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoPath, setUndoPath] = useState<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const streamTextRef = useRef<string>('');

  const clearUndo = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setUndoPath(null);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const handleUndo = useCallback(async () => {
    const path = undoPath;
    clearUndo();
    if (!path) return;
    try {
      await window.api.deleteNotesVault(path);
    } catch {
      // Silently ignore undo failures — entry stays in vault
    }
  }, [undoPath, clearUndo]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);
    clearUndo();
    streamTextRef.current = '';

    try {
      const { streamId } = await window.api.streamStart({
        messages: [{ role: 'user', content: trimmed }],
        system: ENTRIES_SYSTEM_PROMPT,
        maxTokens: ENTRIES_MAX_TOKENS,
      });
      streamIdRef.current = streamId;

      await new Promise<void>((resolve, reject) => {
        const unsubToken = window.api.onStreamToken(({ streamId: sid, token }) => {
          if (sid !== streamId) return;
          streamTextRef.current += token;
          window.api.streamAck(sid, 1);
        });
        const unsubEnd = window.api.onStreamEnd(({ streamId: sid }) => {
          if (sid !== streamId) return;
          unsubToken();
          unsubEnd();
          unsubError();
          resolve();
        });
        const unsubError = window.api.onStreamError(({ streamId: sid, error: msg }) => {
          if (sid !== streamId) return;
          unsubToken();
          unsubEnd();
          unsubError();
          reject(new Error(msg || 'Generation failed'));
        });
      });

      const generatedBody = streamTextRef.current.trim();
      if (!generatedBody) {
        throw new Error('Generated entry was empty. Nothing saved.');
      }

      const fileName = makeFilename(trimmed);
      const filePath = `Entries/${fileName}`;
      const noteContent = buildNoteContent(new Date().toISOString(), generatedBody);

      try {
        await window.api.mkdirNotesVault('Entries');
      } catch {
        // Directory may already exist
      }

      await window.api.writeNotesVault(filePath, noteContent);
      setText('');
      onEntrySaved?.(filePath);
      setUndoPath(filePath);
      undoTimerRef.current = setTimeout(clearUndo, 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed — check your AI settings.');
    } finally {
      setSaving(false);
      streamIdRef.current = null;
    }
  }, [text, saving, clearUndo, onEntrySaved]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="entries-qa">
      <div className="entries-qa-header">
        <span className="entries-qa-title">Quick Entry</span>
        <span className="entries-qa-hint">Brainstorm agent expands &amp; saves to vault</span>
      </div>
      <div className="entries-qa-body">
        <textarea
          className="entries-qa-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Jot an idea, character note, or plot point…"
          rows={2}
          disabled={saving}
          aria-label="Entry text"
          data-testid="entries-qa-textarea"
        />
        <button
          className="entries-qa-save-btn"
          onClick={() => void handleSubmit()}
          disabled={!text.trim() || saving}
          type="button"
          aria-label="Save entry"
          data-testid="entries-qa-save-btn"
        >
          {saving ? 'Saving…' : 'Save Entry'}
        </button>
      </div>
      {error && (
        <div className="entries-qa-error" role="alert" data-testid="entries-qa-error">
          {error}
        </div>
      )}
      {undoPath && (
        <div className="entries-qa-toast" role="status" aria-live="polite" data-testid="entries-qa-toast">
          <span>Saved to vault.</span>
          <button
            className="entries-qa-undo-btn"
            onClick={() => void handleUndo()}
            type="button"
            data-testid="entries-qa-undo-btn"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
