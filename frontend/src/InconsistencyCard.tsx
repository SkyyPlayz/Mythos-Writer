import { useState, useCallback } from 'react';
import './InconsistencyCard.css';

export type ResolutionAction = 'match_archive_to_story' | 'suggest_story_change' | 'ignore';

export interface InconsistencyItem {
  id: string;
  category: 'character_attribute_drift' | 'location_attribute_mismatch' | 'factual_contradiction';
  severity: 'critical' | 'high' | 'medium' | 'low';
  manuscriptAnchor: { sceneId: string; offset: number; excerpt: string };
  vaultAnchor: { notePath: string; line: number; excerpt: string };
  rationale: string;
  proposedResolution: { matchArchiveToStory: string; suggestStoryChange: string };
  status: 'open' | 'resolved' | 'ignored';
  resolvedAt: string | null;
  resolvedAction: ResolutionAction | null;
  createdAt: string;
}

const SEVERITY_LABEL: Record<InconsistencyItem['severity'], string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

const SEVERITY_ARIA: Record<InconsistencyItem['severity'], string> = {
  critical: 'Critical severity',
  high: 'High severity',
  medium: 'Medium severity',
  low: 'Low severity',
};

const CATEGORY_LABEL: Record<InconsistencyItem['category'], string> = {
  character_attribute_drift: 'Character Attribute Drift',
  location_attribute_mismatch: 'Location Attribute Mismatch',
  factual_contradiction: 'Factual Contradiction',
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

export interface InconsistencyCardProps {
  item: InconsistencyItem;
  archiveStoryEditConsentGiven: boolean;
  onResolve: (id: string, action: ResolutionAction) => Promise<void>;
  onConsentGranted: () => void;
}

interface ExpandState {
  kind: 'match' | 'suggest';
  suggestText: string;
  editMode: boolean;
  editValue: string;
  busy: boolean;
}

export function InconsistencyCard({
  item,
  archiveStoryEditConsentGiven,
  onResolve,
  onConsentGranted,
}: InconsistencyCardProps) {
  const [rationaleExpanded, setRationaleExpanded] = useState(false);
  const [expand, setExpand] = useState<ExpandState | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [busy, setBusy] = useState(false);

  const excerptLabel = truncate(item.manuscriptAnchor.excerpt, 40);

  const handleIgnore = useCallback(async () => {
    setBusy(true);
    await onResolve(item.id, 'ignore');
    setBusy(false);
  }, [item.id, onResolve]);

  const handleMatchArchive = useCallback(() => {
    setExpand({
      kind: 'match',
      suggestText: '',
      editMode: false,
      editValue: '',
      busy: false,
    });
  }, []);

  const handleMatchConfirm = useCallback(async () => {
    setExpand((prev) => prev ? { ...prev, busy: true } : prev);
    await onResolve(item.id, 'match_archive_to_story');
    setExpand(null);
  }, [item.id, onResolve]);

  const handleSuggestEdit = useCallback(() => {
    if (!archiveStoryEditConsentGiven) {
      setShowConsentModal(true);
      return;
    }
    setExpand({
      kind: 'suggest',
      suggestText: item.proposedResolution.suggestStoryChange,
      editMode: false,
      editValue: item.proposedResolution.suggestStoryChange,
      busy: false,
    });
  }, [archiveStoryEditConsentGiven, item.proposedResolution.suggestStoryChange]);

  const handleConsentContinue = useCallback(() => {
    if (dontShowAgain) {
      onConsentGranted();
    }
    setShowConsentModal(false);
    setExpand({
      kind: 'suggest',
      suggestText: item.proposedResolution.suggestStoryChange,
      editMode: false,
      editValue: item.proposedResolution.suggestStoryChange,
      busy: false,
    });
  }, [dontShowAgain, item.proposedResolution.suggestStoryChange, onConsentGranted]);

  const handleSuggestConfirm = useCallback(async () => {
    setExpand((prev) => prev ? { ...prev, busy: true } : prev);
    await onResolve(item.id, 'suggest_story_change');
    setExpand(null);
  }, [item.id, onResolve]);

  const handleCancelExpand = useCallback(() => {
    setExpand(null);
  }, []);

  const expandOpen = expand !== null;
  const isBusy = busy || (expand?.busy ?? false);

  return (
    <>
      {showConsentModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ic-consent-title"
          className="ic-consent-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setShowConsentModal(false); }}
        >
          <div className="ic-consent-modal">
            <h2 id="ic-consent-title" className="ic-consent-title">
              Archive Agent — Editing Your Manuscript
            </h2>
            <p className="ic-consent-body">
              The Archive Agent is about to suggest a change to your manuscript text. You&apos;ll review and
              approve every edit before it&apos;s applied — nothing changes without your confirmation.
            </p>
            <label className="ic-consent-checkbox-row">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                aria-label="Don't show this again"
              />
              <span>Don&apos;t show this again</span>
            </label>
            <div className="ic-consent-actions">
              <button
                type="button"
                className="ic-btn ic-btn--primary"
                onClick={handleConsentContinue}
              >
                Continue
              </button>
              <button
                type="button"
                className="ic-btn ic-btn--ghost"
                onClick={() => setShowConsentModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <li
        className="ic-card"
        aria-label={`${SEVERITY_LABEL[item.severity]} ${CATEGORY_LABEL[item.category]}: ${excerptLabel}`}
      >
        {/* Header row */}
        <div className="ic-header-row">
          <span
            role="checkbox"
            aria-checked="false"
            className="ic-checkbox"
            aria-label="Select card"
            tabIndex={0}
          />
          <span
            className={`ic-severity-badge ic-severity-badge--${item.severity}`}
            role="img"
            aria-label={SEVERITY_ARIA[item.severity]}
          >
            {SEVERITY_LABEL[item.severity]}
          </span>
          <span className="ic-category">{CATEGORY_LABEL[item.category]}</span>
          <button
            type="button"
            className="ic-dismiss-btn"
            aria-label={`Dismiss — ${excerptLabel}`}
            onClick={() => void handleIgnore()}
            disabled={isBusy}
          >
            ×
          </button>
        </div>

        {/* Anchor row */}
        <div className="ic-anchors" role="group" aria-label="Inconsistency location">
          <span
            className="ic-anchor ic-anchor--manuscript"
            title={item.manuscriptAnchor.excerpt}
          >
            &ldquo;{truncate(item.manuscriptAnchor.excerpt, 36)}&rdquo;
          </span>
          <span className="ic-arrow" aria-hidden="true">→</span>
          <span
            className="ic-anchor ic-anchor--vault"
            title={item.vaultAnchor.excerpt}
          >
            &ldquo;{truncate(item.vaultAnchor.excerpt, 36)}&rdquo;
          </span>
        </div>

        <hr className="ic-separator" aria-hidden="true" />

        {/* Rationale */}
        <div className="ic-rationale-row">
          <p
            className={`ic-rationale${rationaleExpanded ? ' ic-rationale--expanded' : ''}`}
          >
            {item.rationale}
          </p>
          {item.rationale.length > 120 && (
            <button
              type="button"
              className="ic-show-more"
              aria-expanded={rationaleExpanded}
              onClick={() => setRationaleExpanded((v) => !v)}
            >
              {rationaleExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>

        {/* Action row — labels match the M9 comments-v2 archive-action wording
            verbatim (frontend/src/comments/agentActions.ts AGENT_ACTIONS) so
            the Notes right panel's flag cards (SKY-6978) read identically to
            the manuscript's Archive Agent comment card. */}
        <div className="ic-action-row" role="group" aria-label="Inconsistency actions">
          <button
            type="button"
            className="ic-btn ic-btn--primary"
            aria-label={`Match Archive to Story — ${excerptLabel}`}
            onClick={handleMatchArchive}
            disabled={isBusy || expandOpen}
          >
            Edit notes to match
          </button>
          <button
            type="button"
            className="ic-btn ic-btn--secondary"
            aria-label={`Suggest Story Change — ${excerptLabel}`}
            onClick={handleSuggestEdit}
            disabled={isBusy || expandOpen}
          >
            Suggest story change
          </button>
          <button
            type="button"
            className="ic-btn ic-btn--ghost"
            aria-label={`Ignore — ${excerptLabel}`}
            onClick={() => void handleIgnore()}
            disabled={isBusy || expandOpen}
          >
            Ignore
          </button>
        </div>

        {/* Expand area */}
        <div className={`ic-expand-area${expandOpen ? ' ic-expand-area--open' : ''}`} aria-hidden={expandOpen ? undefined : true}>
          {expand?.kind === 'match' && (
            <div className="ic-diff-preview">
              <p className="ic-diff-label">Proposed vault change</p>
              <p className="ic-diff-old">{item.vaultAnchor.excerpt}</p>
              <p className="ic-diff-new">{item.proposedResolution.matchArchiveToStory}</p>
              <div className="ic-expand-actions">
                <button
                  type="button"
                  className="ic-btn ic-btn--primary"
                  onClick={() => void handleMatchConfirm()}
                  disabled={expand.busy}
                  aria-label="Apply vault change"
                >
                  ✓ Apply Change
                </button>
                <button
                  type="button"
                  className="ic-btn ic-btn--ghost"
                  onClick={handleCancelExpand}
                  disabled={expand.busy}
                  aria-label="Cancel match archive"
                >
                  ✗ Cancel
                </button>
              </div>
            </div>
          )}
          {expand?.kind === 'suggest' && (
            <div className="ic-suggest-preview">
              <p className="ic-diff-label">Suggested manuscript change</p>
              <p className="ic-diff-old">Original: {item.manuscriptAnchor.excerpt}</p>
              {expand.editMode ? (
                <textarea
                  className="ic-suggest-edit-area"
                  value={expand.editValue}
                  onChange={(e) => setExpand((prev) => prev ? { ...prev, editValue: e.target.value } : prev)}
                  rows={3}
                  aria-label="Edit suggested manuscript change"
                />
              ) : (
                <p className="ic-diff-new">Suggested: {expand.suggestText}</p>
              )}
              <div className="ic-expand-actions">
                <button
                  type="button"
                  className="ic-btn ic-btn--primary"
                  onClick={() => void handleSuggestConfirm()}
                  disabled={expand.busy}
                  aria-label="Apply suggested edit"
                >
                  ✓ Apply Edit
                </button>
                {!expand.editMode && (
                  <button
                    type="button"
                    className="ic-btn ic-btn--secondary"
                    onClick={() => setExpand((prev) => prev ? { ...prev, editMode: true } : prev)}
                    disabled={expand.busy}
                    aria-label="Edit before applying"
                  >
                    ✏ Edit before applying
                  </button>
                )}
                <button
                  type="button"
                  className="ic-btn ic-btn--ghost"
                  onClick={handleCancelExpand}
                  disabled={expand.busy}
                  aria-label="Cancel suggested edit"
                >
                  ✗ Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </li>
    </>
  );
}
