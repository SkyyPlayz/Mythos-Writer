import { useState, useEffect, useRef, useCallback } from 'react';
import './EntriesPanel.css';

const ENTRIES_DIR = 'Entries';
const NOTES_DIR = 'notes';
const BRAINSTORM_DIR = 'notes/brainstorm';

const BRAINSTORM_SYSTEM = `You are a creative writing assistant. Your task is to take a quick captured idea and expand it into a detailed, useful note for a story writer.

Expand the idea with:
- Deeper exploration of the concept
- Possible story implications and connections
- Specific vivid details and sensory qualities
- Questions to consider or directions to explore

Format your response as a clear markdown note. Be creative, concrete, and focused on helping the writer develop their story.`;

// ─── Exported pure helpers (testable without DOM) ───

export interface EntrySourcePayload {
  entryId: string;
  body: string;
  tags: string[];
}

interface ParsedEntry {
  body: string;
  tags: string[];
  createdAt: string;
  promotedNoteId?: string;
}

export function buildEntryContent(
  body: string,
  tags: string[],
  createdAt: string,
  promotedNoteId?: string,
): string {
  const lines = ['---', 'entry: true', 'source: quick-capture', `createdAt: ${createdAt}`];
  if (tags.length > 0) lines.push(`tags: ${tags.join(', ')}`);
  if (promotedNoteId) lines.push(`promotedNoteId: ${promotedNoteId}`);
  lines.push('---', '', body);
  return lines.join('\n');
}

export function parseEntryFrontmatter(content: string): ParsedEntry | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const [, front, body] = match;
  const createdAtLine = front.match(/^createdAt:\s*(.+)$/m);
  if (!createdAtLine) return null;
  const tagsLine = front.match(/^tags:\s*(.+)$/m);
  const promotedLine = front.match(/^promotedNoteId:\s*(.+)$/m);
  return {
    body: body.trim(),
    tags: tagsLine ? tagsLine[1].split(',').map((t) => t.trim()).filter(Boolean) : [],
    createdAt: createdAtLine[1].trim(),
    promotedNoteId: promotedLine ? promotedLine[1].trim() : undefined,
  };
}

export function buildBrainstormMessages(
  body: string,
  tags: string[],
  storyName: string,
  entityNames: string[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const ctxParts: string[] = [];
  if (storyName) ctxParts.push(`Story: "${storyName}"`);
  if (entityNames.length > 0) ctxParts.push(`Known entities: ${entityNames.join(', ')}`);
  if (tags.length > 0) ctxParts.push(`Tags: ${tags.join(', ')}`);
  const ctx = ctxParts.length > 0 ? `\n\nContext:\n${ctxParts.join('\n')}` : '';
  return [
    {
      role: 'user',
      content: `Expand this quick-capture idea into a detailed story note:${ctx}\n\nIdea:\n${body}`,
    },
  ];
}

/** Wraps a string in a YAML double-quoted scalar, escaping chars that would break frontmatter. */
function yamlScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

export function buildPromotedNoteContent(
  body: string,
  entryPath: string,
  storyTitle: string,
): string {
  return [
    '---',
    'type: note',
    'source: promoted-entry',
    `sourceEntry: ${yamlScalar(entryPath)}`,
    `story: ${yamlScalar(storyTitle || 'unknown')}`,
    '---',
    '',
    body,
  ].join('\n');
}

export function buildSceneCrafterPayload(
  entries: Array<{ id: string; body: string; tags: string[] }>,
): EntrySourcePayload[] {
  return entries.map((e) => ({ entryId: e.id, body: e.body, tags: e.tags }));
}

function slugify(text: string): string {
  return (
    text
      .slice(0, 50)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'entry'
  );
}

export async function findAvailablePromotedNotePath(
  basePath: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(basePath))) return basePath;

  const match = basePath.match(/^(.*?)(\.md)?$/i);
  const stem = match?.[1] ?? basePath;
  const extension = match?.[2] ?? '';
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('Could not find an available note filename.');
}

function makeEntryPath(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ENTRIES_DIR}/${ts}-${rand}.md`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface EntryRecord {
  id: string;
  path: string;
  body: string;
  tags: string[];
  createdAt: string;
  promotedNoteId?: string;
}

interface Props {
  storyTitle?: string;
}

export default function EntriesPanel({ storyTitle = '' }: Props) {
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [newBody, setNewBody] = useState('');
  const [newTagsInput, setNewTagsInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [brainstormingIdState, setBrainstormingIdState] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Refs for stream handlers — avoids stale closures
  const brainstormingIdRef = useRef<string | null>(null);
  const activeStreamIdRef = useRef<string | null>(null);
  const streamAccumRef = useRef('');

  const setBrainstormingId = useCallback((id: string | null) => {
    brainstormingIdRef.current = id;
    setBrainstormingIdState(id);
  }, []);

  const showFeedback = useCallback((msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  }, []);

  // ─── Load entries ───

  const loadEntries = useCallback(async () => {
    setLoadState('loading');
    try {
      const listResult = await window.api.listNotesVault(ENTRIES_DIR);
      // IPC returns { error } when the directory doesn't exist yet — treat as empty.
      if ('error' in listResult) {
        setEntries([]);
        setLoadState('ready');
        return;
      }
      const mdFiles = listResult.items.filter(
        (item) => !item.isDirectory && item.name.endsWith('.md'),
      );
      const records: EntryRecord[] = [];
      await Promise.all(
        mdFiles.map(async (item) => {
          try {
            // listVaultFiles returns paths relative to the Entries/ dir; prepend to get the
            // full path within the notes vault (needed for readNotesVault and writeNotesVault).
            const entryPath = `${ENTRIES_DIR}/${item.path}`;
            const readResult = await window.api.readNotesVault(entryPath);
            if ('error' in readResult) return;
            const parsed = parseEntryFrontmatter(readResult.content);
            if (!parsed) return;
            records.push({
              id: entryPath,
              path: entryPath,
              body: parsed.body,
              tags: parsed.tags,
              createdAt: parsed.createdAt,
              promotedNoteId: parsed.promotedNoteId,
            });
          } catch {
            // skip unreadable files
          }
        }),
      );
      records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setEntries(records);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  // ─── Stream handlers (set up once on mount) ───

  useEffect(() => {
    const unsubToken = window.api.onStreamToken(({ streamId, token }) => {
      if (streamId !== activeStreamIdRef.current) return;
      streamAccumRef.current += token;
      window.api.streamAck(streamId, streamAccumRef.current.length);
      setStreamingText(streamAccumRef.current);
    });

    const unsubEnd = window.api.onStreamEnd(({ streamId }) => {
      if (streamId !== activeStreamIdRef.current) return;
      const entryId = brainstormingIdRef.current;
      const text = streamAccumRef.current;
      activeStreamIdRef.current = null;
      streamAccumRef.current = '';
      setBrainstormingId(null);
      setStreamingText('');

      if (entryId && text.trim()) {
        const filename = entryId.replace(`${ENTRIES_DIR}/`, '').replace('.md', '');
        const notePath = `${BRAINSTORM_DIR}/${filename}-expanded.md`;
        const noteContent = [
          '---',
          'type: note',
          'agent: brainstorm-entry',
          `sourceEntry: ${entryId}`,
          `story: ${storyTitle || 'unknown'}`,
          '---',
          '',
          text.trim(),
        ].join('\n');
        void (async () => {
          try {
            await window.api.mkdirNotesVault(BRAINSTORM_DIR);
            await window.api.writeNotesVault(notePath, noteContent);
            // Update entry frontmatter with promotedNoteId
            const readResult = await window.api.readNotesVault(entryId);
            if ('error' in readResult) return;
            const parsed = parseEntryFrontmatter(readResult.content);
            if (parsed) {
              const updated = buildEntryContent(
                parsed.body,
                parsed.tags,
                parsed.createdAt,
                notePath,
              );
              await window.api.writeNotesVault(entryId, updated);
            }
            await loadEntries();
            showFeedback(`Brainstorm note saved to ${notePath}`);
          } catch {
            showFeedback('Failed to save brainstorm note.');
          }
        })();
      }
    });

    const unsubError = window.api.onStreamError(({ streamId, message }) => {
      if (streamId !== activeStreamIdRef.current) return;
      activeStreamIdRef.current = null;
      streamAccumRef.current = '';
      setBrainstormingId(null);
      setStreamingText('');
      setStreamError(message);
    });

    return () => {
      unsubToken();
      unsubEnd();
      unsubError();
    };
  }, [loadEntries, setBrainstormingId, showFeedback, storyTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Create entry ───

  const handleCreate = useCallback(async () => {
    const body = newBody.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      const tags = newTagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const createdAt = new Date().toISOString();
      const path = makeEntryPath();
      const content = buildEntryContent(body, tags, createdAt);
      const mkResult = await window.api.mkdirNotesVault(ENTRIES_DIR);
      if ('error' in mkResult) throw new Error(mkResult.error);
      const writeResult = await window.api.writeNotesVault(path, content);
      if ('error' in writeResult) throw new Error(writeResult.error);
      setNewBody('');
      setNewTagsInput('');
      await loadEntries();
    } catch {
      showFeedback('Failed to save entry.');
    } finally {
      setSubmitting(false);
    }
  }, [newBody, newTagsInput, submitting, loadEntries, showFeedback]);

  // ─── Promote to note (direct) ───

  const handlePromote = useCallback(
    async (entry: EntryRecord) => {
      if (promotingId !== null) return;
      setPromotingId(entry.id);
      try {
        const slug = slugify(entry.body);
        const baseNotePath = `${NOTES_DIR}/${slug}.md`;
        const notePath = await findAvailablePromotedNotePath(baseNotePath, async (path) => {
          const existing = await window.api.readNotesVault(path);
          return !('error' in existing);
        });
        const noteContent = buildPromotedNoteContent(entry.body, entry.path, storyTitle);
        const mkNoteResult = await window.api.mkdirNotesVault(NOTES_DIR);
        if ('error' in mkNoteResult) throw new Error(mkNoteResult.error);
        const writeNoteResult = await window.api.writeNotesVault(notePath, noteContent);
        if ('error' in writeNoteResult) throw new Error(writeNoteResult.error);
        const updated = buildEntryContent(entry.body, entry.tags, entry.createdAt, notePath);
        const updateResult = await window.api.writeNotesVault(entry.path, updated);
        if ('error' in updateResult) throw new Error(updateResult.error);
        await loadEntries();
        showFeedback(`Note saved to ${notePath}`);
      } catch {
        showFeedback('Failed to promote entry.');
      } finally {
        setPromotingId(null);
      }
    },
    [promotingId, storyTitle, loadEntries, showFeedback],
  );

  // ─── Brainstorm handoff ───

  const handleBrainstorm = useCallback(
    async (entry: EntryRecord) => {
      if (brainstormingIdState !== null) return;
      setBrainstormingId(entry.id);
      setStreamError(null);
      try {
        const entityResult = await window.api.entityList();
        const entityNames = entityResult.entities.slice(0, 10).map((e) => e.name);
        const messages = buildBrainstormMessages(entry.body, entry.tags, storyTitle, entityNames);
        const { streamId } = await window.api.streamStart({
          messages,
          system: BRAINSTORM_SYSTEM,
          maxTokens: 1000,
        });
        activeStreamIdRef.current = streamId;
        streamAccumRef.current = '';
      } catch (e) {
        setBrainstormingId(null);
        setStreamError(String(e));
      }
    },
    [brainstormingIdState, storyTitle, setBrainstormingId],
  );

  const handleCancelBrainstorm = useCallback(() => {
    if (activeStreamIdRef.current) {
      void window.api.streamCancel(activeStreamIdRef.current);
      activeStreamIdRef.current = null;
    }
    streamAccumRef.current = '';
    setBrainstormingId(null);
    setStreamingText('');
  }, [setBrainstormingId]);

  // ─── Render ───

  return (
    <div className="entries-panel" data-testid="entries-panel">
      <div className="entries-header">
        <h2 className="entries-title">Entries</h2>
        <p className="entries-subtitle">
          Quick-capture raw thoughts — then promote to a note or expand via Brainstorm.
        </p>
      </div>

      {/* Capture form */}
      <div className="entries-form">
        <textarea
          className="entries-body-input"
          placeholder="Capture a raw idea, image, or question…"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleCreate();
            }
          }}
          rows={3}
          aria-label="Entry body"
          data-testid="entry-body-input"
        />
        <div className="entries-form-footer">
          <input
            className="entries-tags-input"
            placeholder="Tags (comma-separated)"
            value={newTagsInput}
            onChange={(e) => setNewTagsInput(e.target.value)}
            aria-label="Entry tags"
            data-testid="entry-tags-input"
          />
          <button
            className="entries-add-btn"
            onClick={() => void handleCreate()}
            disabled={!newBody.trim() || submitting}
            aria-label="Add entry"
            data-testid="entry-add-btn"
          >
            {submitting ? 'Saving…' : 'Add Entry'}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="entries-feedback" role="status" aria-live="polite" data-testid="entries-feedback">
          {feedback}
        </div>
      )}

      {streamError && (
        <div className="entries-stream-error" role="alert">
          Brainstorm error: {streamError}
          <button onClick={() => setStreamError(null)} aria-label="Dismiss error">×</button>
        </div>
      )}

      {/* Entry list */}
      <div className="entries-list" role="list" data-testid="entries-list">
        {loadState === 'loading' && (
          <div className="entries-loading" role="status">Loading entries…</div>
        )}
        {loadState === 'error' && (
          <div className="entries-error" role="alert">Failed to load entries.</div>
        )}
        {loadState === 'ready' && entries.length === 0 && (
          <div className="entries-empty" data-testid="entries-empty">
            <p className="entries-empty-heading">Nothing captured yet</p>
            <p>
              Jot down ideas, fragments, and questions as they come to you —
              no need to organize them right away.
            </p>
            <p>Once captured, you can:</p>
            <ul>
              <li>
                <strong>Promote to Note</strong> — save the idea directly as a Notes
                Vault file
              </li>
              <li>
                <strong>Brainstorm</strong> — send it to the AI Brainstorm Agent to
                expand into a full note
              </li>
            </ul>
          </div>
        )}
        {loadState === 'ready' &&
          entries.map((entry) => {
            const isBrainstorming = brainstormingIdState === entry.id;
            const isPromoting = promotingId === entry.id;
            const createdDate = new Date(entry.createdAt);
            const dateLabel = isNaN(createdDate.getTime())
              ? entry.createdAt
              : createdDate.toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

            return (
              <div
                key={entry.id}
                className={`entries-item${isBrainstorming ? ' brainstorming' : ''}`}
                role="listitem"
                data-testid={`entry-item-${entry.id}`}
              >
                <div className="entries-item-body" data-testid="entry-body-display">
                  {entry.body}
                </div>
                <div className="entries-item-meta">
                  {entry.tags.length > 0 && (
                    <div className="entries-tags">
                      {entry.tags.map((tag) => (
                        <span key={tag} className="entries-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="entries-date">{dateLabel}</span>
                  {entry.promotedNoteId && (
                    <span className="entries-promoted-badge" title={entry.promotedNoteId}>
                      Promoted
                    </span>
                  )}
                </div>

                {isBrainstorming && streamingText && (
                  <div className="entries-streaming" aria-live="polite" data-testid="entries-streaming">
                    <div className="entries-streaming-label">Brainstorming…</div>
                    <div className="entries-streaming-text">{streamingText}</div>
                  </div>
                )}

                <div className="entries-item-actions">
                  <button
                    className="entries-action-btn"
                    onClick={() => void handlePromote(entry)}
                    disabled={isPromoting || isBrainstorming || brainstormingIdState !== null}
                    aria-label={`Promote entry to note`}
                    data-testid="entry-promote-btn"
                  >
                    {isPromoting ? 'Saving…' : 'Promote to Note'}
                  </button>
                  {isBrainstorming ? (
                    <button
                      className="entries-action-btn entries-action-cancel"
                      onClick={handleCancelBrainstorm}
                      aria-label="Cancel brainstorm"
                      data-testid="entry-cancel-brainstorm-btn"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      className="entries-action-btn entries-action-brainstorm"
                      onClick={() => void handleBrainstorm(entry)}
                      disabled={brainstormingIdState !== null || isPromoting}
                      aria-label={`Send entry to Brainstorm Agent`}
                      data-testid="entry-brainstorm-btn"
                    >
                      Brainstorm
                    </button>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
