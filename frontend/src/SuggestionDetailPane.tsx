import { useEffect, useRef, useState, useCallback } from 'react';
import './SuggestionDetailPane.css';

export type UnifiedSuggestionKind = 'suggestion' | 'continuity-issue' | 'wiki-link';
export type UnifiedSuggestionStatus =
  | 'proposed'
  | 'accepted'
  | 'applied'
  | 'rejected'
  | 'ignored'
  | 'rolled_back';
export type SuggestionSourceAgent = 'writing-assistant' | 'brainstorm' | 'archive';

export interface UnifiedSuggestion {
  id: string;
  kind: UnifiedSuggestionKind;
  sourceAgent: SuggestionSourceAgent;
  confidence: number;
  rationale: string;
  targetPath: string | null;
  targetAnchor: string | null;
  status: UnifiedSuggestionStatus;
  createdAt: string;
  appliedAt: string | null;
  budgetExceeded: boolean;
  category: string | null;
  payloadJson: string | null;
  preChangeSnapshot?: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  actor: string | null;
  created_at: string;
}

interface Props {
  suggestion: UnifiedSuggestion;
  onClose: () => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onRollback: (id: string) => void;
}

const AGENT_LABELS: Record<SuggestionSourceAgent, string> = {
  'writing-assistant': 'Writing Assistant',
  brainstorm: 'Brainstorm',
  archive: 'Archive',
};

function formatAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SuggestionDetailPane({
  suggestion,
  onClose,
  onAccept,
  onReject,
  onRollback,
}: Props) {
  const paneRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [auditRows, setAuditRows] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    setAuditLoading(true);
    setAuditRows([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api;
    if (typeof api?.auditList === 'function') {
      (api.auditList(suggestion.id) as Promise<AuditEntry[]>)
        .then((rows) => setAuditRows((rows ?? []).slice(0, 5)))
        .catch(() => setAuditRows([]))
        .finally(() => setAuditLoading(false));
    } else {
      setAuditLoading(false);
    }
  }, [suggestion.id]);

  // Focus the close button on mount
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Escape to close — captured here so it doesn't fall through to row keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  // Focus trap within the pane
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        pane.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    pane.addEventListener('keydown', handler);
    return () => pane.removeEventListener('keydown', handler);
  }, []);

  const handleRollback = useCallback(async () => {
    setRollingBack(true);
    try {
      onRollback(suggestion.id);
    } finally {
      setRollingBack(false);
    }
  }, [onRollback, suggestion.id]);

  const confidencePct = Math.round(suggestion.confidence * 100);

  // Parse payload for rich preview
  let payloadPreview: React.ReactNode = null;
  if (suggestion.payloadJson) {
    try {
      const p = JSON.parse(suggestion.payloadJson) as {
        prose?: string;
        proposed_link?: string;
        link?: string;
        anchor_text?: string;
        anchorText?: string;
        before?: string;
        after?: string;
      };
      if (suggestion.kind === 'wiki-link') {
        const link = p.proposed_link ?? p.link ?? '';
        const anchor = p.anchor_text ?? p.anchorText;
        if (link) {
          payloadPreview = (
            <div className="sdp-payload-wikilink">
              <span className="sdp-wikilink-badge">Wiki Link</span>
              <span className="sdp-wikilink-link">{link}</span>
              {anchor && (
                <span className="sdp-wikilink-anchor">on &ldquo;{anchor}&rdquo;</span>
              )}
            </div>
          );
        }
      } else if (suggestion.kind === 'continuity-issue' && (p.before || p.after)) {
        payloadPreview = (
          <div className="sdp-payload-continuity">
            {p.before && (
              <div className="sdp-continuity-side">
                <span className="sdp-continuity-label">Before</span>
                <pre className="sdp-continuity-pre">{p.before}</pre>
              </div>
            )}
            {p.after && (
              <div className="sdp-continuity-side">
                <span className="sdp-continuity-label">After</span>
                <pre className="sdp-continuity-pre">{p.after}</pre>
              </div>
            )}
          </div>
        );
      } else if (p.prose) {
        payloadPreview = (
          <details className="sdp-payload-prose">
            <summary className="sdp-prose-summary">Proposed content</summary>
            <pre className="sdp-prose-pre">{p.prose}</pre>
          </details>
        );
      }
    } catch {
      /* malformed JSON — skip */
    }
  }

  const canAcceptOrReject =
    suggestion.status === 'proposed' || suggestion.status === 'ignored';
  const canRollback = suggestion.status === 'accepted' || suggestion.status === 'applied';
  const preChangeSnapshot = suggestion.preChangeSnapshot?.trim() ? suggestion.preChangeSnapshot : null;

  return (
    <div
      className="sdp-overlay"
      ref={paneRef}
      role="complementary"
      aria-label="Suggestion detail"
      aria-modal="true"
    >
      <div className="sdp-pane">
        <div className="sdp-header">
          <div className="sdp-header-meta">
            <span className={`sdp-agent-badge sdp-agent-${suggestion.sourceAgent}`}>
              {AGENT_LABELS[suggestion.sourceAgent]}
            </span>
            {suggestion.kind === 'continuity-issue' && suggestion.category && (
              <span
                className={`sdp-severity-badge sdp-severity-${suggestion.category}`}
                aria-label={`Severity: ${suggestion.category}`}
              >
                {suggestion.category}
              </span>
            )}
          </div>
          {suggestion.targetPath && (
            <div className="sdp-target-path" title={suggestion.targetPath}>
              {suggestion.targetPath}
            </div>
          )}
          <button
            ref={closeRef}
            className="sdp-close"
            onClick={onClose}
            aria-label="Close detail pane"
          >
            ✕
          </button>
        </div>

        <div className="sdp-body">
          <section className="sdp-section">
            <h3 className="sdp-section-title">Rationale</h3>
            <p className="sdp-rationale">{suggestion.rationale}</p>
          </section>

          {suggestion.kind !== 'continuity-issue' && (
            <section className="sdp-section">
              <div className="sdp-confidence-row" aria-label={`Confidence ${confidencePct}%`}>
                <span className="sdp-confidence-label">Confidence</span>
                <div
                  className="sdp-confidence-bar"
                  role="progressbar"
                  aria-valuenow={confidencePct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="sdp-confidence-fill"
                    style={{ width: `${confidencePct}%` }}
                  />
                </div>
                <span className="sdp-confidence-pct">{confidencePct}%</span>
              </div>
            </section>
          )}

          {preChangeSnapshot && (
            <section className="sdp-section">
              <details className="sdp-before-details">
                <summary className="sdp-before-summary" role="button">Before</summary>
                <pre className="sdp-before-pre">{preChangeSnapshot}</pre>
              </details>
            </section>
          )}

          {suggestion.budgetExceeded && (
            <section className="sdp-section">
              <div
                className="sdp-budget-held-notice"
                role="status"
                aria-label="Auto-apply held \u2014 agent budget exceeded"
              >
                <span className="sdp-budget-held-icon" aria-hidden="true">&#9888;</span>
                <span className="sdp-budget-held-text">
                  Auto-apply was held \u2014 this suggestion exceeded the agent\u2019s hourly or daily
                  budget. Review and accept or reject it manually.
                </span>
              </div>
            </section>
          )}

          {payloadPreview && (
            <section className="sdp-section">
              <h3 className="sdp-section-title">Payload</h3>
              {payloadPreview}
            </section>
          )}

          <section className="sdp-section">
            <h3 className="sdp-section-title">Audit Trail</h3>
            {auditLoading ? (
              <p className="sdp-audit-loading">Loading&hellip;</p>
            ) : auditRows.length === 0 ? (
              <p className="sdp-audit-empty">No audit entries yet.</p>
            ) : (
              <ul className="sdp-audit-list" aria-label="Audit trail entries">
                {auditRows.map((row) => (
                  <li key={row.id} className="sdp-audit-row">
                    <span className={`sdp-audit-action sdp-audit-action--${row.action}`}>
                      {row.action}
                    </span>
                    <span className="sdp-audit-meta">
                      {row.actor ?? 'system'} &middot; {formatAge(row.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {(canAcceptOrReject || canRollback) && (
          <div className="sdp-actions">
            {canAcceptOrReject && (
              <>
                <button
                  className="sdp-btn sdp-btn-accept"
                  onClick={() => onAccept(suggestion.id)}
                  aria-label="Accept this suggestion"
                >
                  Accept
                </button>
                <button
                  className="sdp-btn sdp-btn-reject"
                  onClick={() => onReject(suggestion.id)}
                  aria-label="Reject this suggestion"
                >
                  Reject
                </button>
              </>
            )}
            {canRollback && (
              <button
                className="sdp-btn sdp-btn-rollback"
                onClick={handleRollback}
                disabled={rollingBack}
                aria-label="Rollback this accepted suggestion"
              >
                {rollingBack ? 'Rolling back…' : 'Rollback'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
