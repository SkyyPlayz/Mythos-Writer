import { useState, useEffect, useCallback, useRef } from 'react';
import type { Scene } from './types';
import ArchiveConfirmDialog from './ArchiveConfirmDialog';
import './ArchivePanel.css';

interface ArchivePayload {
  kind: 'inconsistency' | 'wiki-link';
  anchorText?: string;
  link?: string;
  entityName?: string;
}

interface ArchiveItem {
  id: string;
  kind: 'inconsistency' | 'wiki-link';
  description: string;
  anchorText: string;
  wikiLink: string | null;
  confidence: number;
  createdAt: string;
  status: 'proposed' | 'rejected' | 'accepted';
}

const MOCK_ITEMS: ArchiveItem[] = [
  {
    id: 'arc-inc-mock-1',
    kind: 'inconsistency',
    description: 'The Foundry appears in this scene but was destroyed in chapter 1.',
    anchorText: 'The Foundry gates swung open',
    wikiLink: null,
    confidence: 0.91,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    status: 'proposed',
  },
  {
    id: 'arc-wl-mock-1',
    kind: 'wiki-link',
    description: 'Detected reference to a known entity — add a wiki-link.',
    anchorText: 'the foundry',
    wikiLink: '[[The Foundry]]',
    confidence: 0.87,
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    status: 'proposed',
  },
];

function parseItem(raw: Record<string, unknown>): ArchiveItem | null {
  if (!raw.payload_json) return null;
  let payload: ArchivePayload;
  try {
    payload = JSON.parse(raw.payload_json as string);
  } catch {
    return null;
  }
  if (payload.kind !== 'inconsistency' && payload.kind !== 'wiki-link') return null;
  return {
    id: raw.id as string,
    kind: payload.kind,
    description: (raw.rationale as string) || '',
    anchorText: payload.anchorText || payload.link?.replace(/\[\[|\]\]/g, '') || '',
    wikiLink: payload.kind === 'wiki-link' ? (payload.link ?? null) : null,
    confidence: (raw.confidence as number) ?? 0,
    createdAt: (raw.created_at as string) || new Date().toISOString(),
    status: (raw.status as ArchiveItem['status']) || 'proposed',
  };
}

export interface Props {
  scene: Scene | null;
  onJumpToText: (text: string) => void;
  onInsertWikiLink: (link: string, anchorText: string) => void;
  enabled?: boolean;
  onWikiLinkSuggestionsChange?: (suggestions: Array<{ id: string; anchorText: string; wikiLink: string }>) => void;
}

interface DialogState {
  suggestionId: string;
  rationale: string;
  anchorText: string;
}

export default function ArchivePanel({ scene, onJumpToText, onInsertWikiLink, enabled = true, onWikiLinkSuggestionsChange }: Props) {
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [manualScanning, setManualScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const onWLSuggestionsRef = useRef(onWikiLinkSuggestionsChange);
  onWLSuggestionsRef.current = onWikiLinkSuggestionsChange;

  const loadArchiveItems = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).api;
      if (typeof api?.suggestionsList === 'function') {
        const result = await api.suggestionsList(undefined, 'archive');
        if (isCancelled()) return;
        const rows: Record<string, unknown>[] = result?.suggestions ?? [];
        const parsed = rows.map(parseItem).filter(Boolean) as ArchiveItem[];
        setItems(parsed);
        setIsLive(true);
      } else if (!isCancelled()) {
        setItems(MOCK_ITEMS);
        setIsLive(false);
      }
    } catch {
      if (!isCancelled()) {
        setItems(MOCK_ITEMS);
        setIsLive(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadArchiveItems(() => cancelled).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [scene?.id, enabled, loadArchiveItems]);

  useEffect(() => {
    const proposed = items.filter((i) => i.status === 'proposed' && i.kind === 'wiki-link' && i.wikiLink);
    onWLSuggestionsRef.current?.(
      proposed.map((i) => ({ id: i.id, anchorText: i.anchorText, wikiLink: i.wikiLink! }))
    );
  }, [items]);

  const handleReject = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).api;
      if (typeof api?.suggestionsReject === 'function') {
        await api.suggestionsReject(id);
      }
    } catch { /* optimistic update already applied */ }
  }, []);

  const handleOpenDialog = useCallback((item: ArchiveItem) => {
    setDialog({
      suggestionId: item.id,
      rationale: item.description,
      anchorText: item.anchorText,
    });
  }, []);

  const handleDialogResolved = useCallback(() => {
    if (!dialog) return;
    setItems((prev) => prev.filter((i) => i.id !== dialog.suggestionId));
    setDialog(null);
  }, [dialog]);

  const handleAcceptWikiLink = useCallback(async (item: ArchiveItem) => {
    if (!item.wikiLink) return;
    onInsertWikiLink(item.wikiLink, item.anchorText);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).api;
      if (typeof api?.suggestionsAccept === 'function') {
        await api.suggestionsAccept(item.id);
      }
    } catch { /* optimistic update already applied */ }
  }, [onInsertWikiLink]);

  const handleJump = useCallback((anchorText: string) => {
    onJumpToText(anchorText);
  }, [onJumpToText]);

  const handleScanNow = useCallback(async () => {
    if (!scene || manualScanning) return;
    const prose = scene.blocks.map((b) => b.content).join('\n\n').trim();
    setManualScanning(true);
    setScanStatus('Scanning archive continuity…');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).api;
      if (typeof api?.archiveScan === 'function') {
        await api.archiveScan(prose, scene.path);
      }
      await loadArchiveItems();
      setScanStatus('Archive scan complete.');
    } catch {
      setScanStatus('Archive scan failed.');
    } finally {
      setManualScanning(false);
    }
  }, [loadArchiveItems, manualScanning, scene]);

  if (!enabled) {
    return (
      <div className="archive-panel archive-disabled">
        <p className="archive-disabled-msg">Archive Agent is disabled. Enable it in Settings.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="archive-panel">
        <div className="ap-loading" aria-label="Loading archive suggestions">Loading…</div>
      </div>
    );
  }

  const proposed = items.filter((i) => i.status === 'proposed');
  const inconsistencies = proposed.filter((i) => i.kind === 'inconsistency');
  const wikiLinks = proposed.filter((i) => i.kind === 'wiki-link');

  return (
    <>
    {dialog && (
      <ArchiveConfirmDialog
        suggestionId={dialog.suggestionId}
        rationale={dialog.rationale}
        anchorText={dialog.anchorText}
        onClose={() => setDialog(null)}
        onResolved={handleDialogResolved}
      />
    )}
    <div className="archive-panel">
      {!isLive && (
        <div className="ap-mock-banner" role="note">
          Preview mode — live API not yet connected.
        </div>
      )}

      {!scene && (
        <div className="ap-no-scene">Select a scene to see archive suggestions.</div>
      )}

      <div className="ap-toolbar" aria-label="Archive tools">
        <button
          type="button"
          className="ap-btn ap-btn-scan-now"
          onClick={handleScanNow}
          disabled={!scene || manualScanning}
          aria-disabled={!scene || manualScanning}
        >
          {manualScanning ? 'Scanning…' : 'Scan now'}
        </button>
        <span
          role="status"
          aria-label="Archive scan status"
          aria-live="polite"
          className="ap-scan-status"
        >
          {scanStatus}
        </span>
      </div>

      <section aria-label="Inconsistencies">
        <div className="ap-section-header">
          <h3 className="ap-section-title">Inconsistencies</h3>
          {inconsistencies.length > 0 && (
            <span className="ap-badge" aria-label={`${inconsistencies.length} inconsistencies`}>
              {inconsistencies.length}
            </span>
          )}
        </div>

        {inconsistencies.length === 0 ? (
          <div className="ap-empty-section" role="status">No inconsistencies found.</div>
        ) : (
          <ul className="ap-card-list" aria-label="Inconsistency list">
            {inconsistencies.map((item) => (
              <li
                key={item.id}
                className="ap-card ap-card-inconsistency"
                role="article"
                aria-label={`Inconsistency: ${item.description}`}
              >
                <p className="ap-card-description">{item.description}</p>
                {item.anchorText && (
                  <p className="ap-card-anchor">
                    Near: <em>&ldquo;{item.anchorText}&rdquo;</em>
                  </p>
                )}
                <div className="ap-actions">
                  {item.anchorText && (
                    <button
                      className="ap-btn ap-btn-jump"
                      onClick={() => handleJump(item.anchorText)}
                      aria-label={`Jump to line: ${item.anchorText}`}
                    >
                      Jump to Line
                    </button>
                  )}
                  <button
                    className="ap-btn ap-btn-resolve"
                    onClick={() => handleOpenDialog(item)}
                    aria-label="Resolve inconsistency"
                    title="Choose how to resolve this continuity issue"
                  >
                    Resolve…
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Wiki-link suggestions">
        <div className="ap-section-header">
          <h3 className="ap-section-title">Wiki Links</h3>
          {wikiLinks.length > 0 && (
            <span className="ap-badge" aria-label={`${wikiLinks.length} wiki-link suggestions`}>
              {wikiLinks.length}
            </span>
          )}
        </div>

        {wikiLinks.length === 0 ? (
          <div className="ap-empty-section" role="status">No wiki-link suggestions.</div>
        ) : (
          <ul className="ap-card-list" aria-label="Wiki-link list">
            {wikiLinks.map((item) => (
              <li
                key={item.id}
                className="ap-card ap-card-wikilink"
                role="article"
                aria-label={`Wiki-link suggestion: ${item.wikiLink}`}
              >
                <p className="ap-card-link-text">{item.wikiLink}</p>
                <p className="ap-card-description">{item.description}</p>
                <div className="ap-actions">
                  <button
                    className="ap-btn ap-btn-accept"
                    onClick={() => handleAcceptWikiLink(item)}
                    aria-label={`Accept wiki-link ${item.wikiLink}`}
                  >
                    Accept
                  </button>
                  <button
                    className="ap-btn ap-btn-reject"
                    onClick={() => handleReject(item.id)}
                    aria-label={`Reject wiki-link ${item.wikiLink}`}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
    </>
  );
}
