import { useState, useCallback } from 'react';
import './InconsistencyCard.css';

export type ResolutionAction = 'match_archive_to_story' | 'suggest_story_change' | 'ignore';

/** M9d (SKY-9825): which two sources the flag says disagree.
 *  M12.B1 (SKY-10736) / M12.B3 (SKY-10738): `story_internal` is Check 1 —
 *  the manuscript contradicting itself across scenes; there is no vault side to it. */
export type ContinuityScope = 'story_internal' | 'story_vault' | 'vault_internal' | 'timeline';

export interface InconsistencyItem {
  id: string;
  scope: ContinuityScope;
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

/** M9d: scope tag copy — exact prototype labels (PLAN.md §M9 item 4).
 *  M12.B3 (SKY-10738): `story_internal` label + placement per the owner's
 *  annotated screenshot ruling (SKY-10528) — build to the screenshot, not
 *  the prototype, where the two disagree. */
const SCOPE_LABEL: Record<ContinuityScope, string> = {
  story_internal: 'Story internal',
  story_vault: 'Story ↔ Vault',
  vault_internal: 'Vault internal',
  timeline: 'Timeline',
};

/** M12.B3: the card's second anchor is a vault note for every scope except
 *  `story_internal`, where Check 1 compares two manuscript scenes instead —
 *  the label and "Open sources" copy read accordingly. */
function secondAnchorLabel(scope: ContinuityScope): string {
  return scope === 'story_internal' ? 'Earlier scene' : 'Vault note';
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

export interface InconsistencyCardProps {
  item: InconsistencyItem;
  archiveStoryEditConsentGiven: boolean;
  /** `note` carries the author's edited suggestion text (M9d) — the drafted
   *  story change that lands in the suggestions inbox. */
  onResolve: (id: string, action: ResolutionAction, note?: string) => Promise<void>;
  onConsentGranted: () => void;
}

interface ExpandState {
  /** M12.B3: `fix-choice` is the "Suggest fix" entry point for scopes that
   *  have a vault side — it offers `match` or `suggest` as sub-choices.
   *  `story_internal` items (no vault side) skip straight to `suggest`. */
  kind: 'fix-choice' | 'match' | 'suggest' | 'sources';
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
    if (!expand) return;
    // The author's edited draft (or the untouched proposal) is the story
    // change that gets suggested — pass it through so the drafted suggestion
    // says what the author approved (M9d).
    const noteText = expand.editMode ? expand.editValue : expand.suggestText;
    setExpand({ ...expand, busy: true });
    await onResolve(item.id, 'suggest_story_change', noteText);
    setExpand(null);
  }, [expand, item.id, onResolve]);

  const handleCancelExpand = useCallback(() => {
    setExpand(null);
  }, []);

  // M12.B3 (SKY-10738): "Suggest fix" replaces the old two top-level buttons
  // ("Edit notes to match" / "Suggest story change") with one entry point.
  // A `story_internal` flag has no vault side, so it skips the choice and
  // goes straight to the manuscript-side suggestion; every other scope shows
  // both underlying fix directions as a sub-choice, preserving both flows.
  const handleSuggestFix = useCallback(() => {
    if (item.scope === 'story_internal') {
      handleSuggestEdit();
      return;
    }
    setExpand({ kind: 'fix-choice', suggestText: '', editMode: false, editValue: '', busy: false });
  }, [item.scope, handleSuggestEdit]);

  // M12.B3: "Open sources" — reveals the flag's two full, untruncated
  // anchors in place (no navigation surface exists at this layer to jump
  // into a specific scene/note, so this is the anchor-level "source" reveal).
  const handleToggleSources = useCallback(() => {
    setExpand((prev) =>
      prev?.kind === 'sources' ? null : { kind: 'sources', suggestText: '', editMode: false, editValue: '', busy: false },
    );
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
          <span className="ic-scope-tag" data-testid="ic-scope-tag">
            {SCOPE_LABEL[item.scope]}
          </span>
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

        {/* Action row — M12.B3 (SKY-10738): two actions per the owner's
            annotated screenshot ruling (`Suggest fix` / `Open sources`),
            replacing the prototype's three. Dismiss/ignore stays reachable
            via the header's × button, so no capability is lost. */}
        <div className="ic-action-row" role="group" aria-label="Inconsistency actions">
          <button
            type="button"
            className="ic-btn ic-btn--primary"
            aria-label={`Suggest fix — ${excerptLabel}`}
            onClick={handleSuggestFix}
            disabled={isBusy || expandOpen}
          >
            Suggest fix
          </button>
          <button
            type="button"
            className="ic-btn ic-btn--secondary"
            aria-label={`Open sources — ${excerptLabel}`}
            aria-pressed={expand?.kind === 'sources'}
            onClick={handleToggleSources}
            disabled={isBusy || (expandOpen && expand?.kind !== 'sources')}
          >
            Open sources
          </button>
        </div>

        {/* Expand area */}
        <div className={`ic-expand-area${expandOpen ? ' ic-expand-area--open' : ''}`} aria-hidden={expandOpen ? undefined : true}>
          {expand?.kind === 'fix-choice' && (
            <div className="ic-fix-choice">
              <p className="ic-diff-label">How should this be fixed?</p>
              <div className="ic-expand-actions">
                <button
                  type="button"
                  className="ic-btn ic-btn--primary"
                  onClick={handleMatchArchive}
                  aria-label="Update your notes to match the story"
                >
                  Update your notes
                </button>
                <button
                  type="button"
                  className="ic-btn ic-btn--secondary"
                  onClick={handleSuggestEdit}
                  aria-label="Suggest a change to the story"
                >
                  Suggest a story change
                </button>
                <button
                  type="button"
                  className="ic-btn ic-btn--ghost"
                  onClick={handleCancelExpand}
                  aria-label="Cancel suggest fix"
                >
                  ✗ Cancel
                </button>
              </div>
            </div>
          )}
          {expand?.kind === 'sources' && (
            <div className="ic-sources-preview" data-testid="ic-sources-preview">
              <p className="ic-diff-label">Manuscript</p>
              <p className="ic-diff-old">{item.manuscriptAnchor.excerpt || '(no excerpt captured)'}</p>
              <p className="ic-diff-label">{secondAnchorLabel(item.scope)}</p>
              <p className="ic-diff-old">{item.vaultAnchor.excerpt || '(no excerpt captured)'}</p>
              <div className="ic-expand-actions">
                <button
                  type="button"
                  className="ic-btn ic-btn--ghost"
                  onClick={handleCancelExpand}
                  aria-label="Close sources"
                >
                  ✗ Close
                </button>
              </div>
            </div>
          )}
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
