/**
 * ProposalCard — SKY-1488
 *
 * Renders the top-of-queue NoteProposal inside the brainstorm facts column.
 * Handles default, edit, and Blank-mode disambiguation states.
 * NoteProposal types mirror the SKY-1483 interface; update the import path
 * once that issue lands and exports from a shared types module.
 */
import { useState, useCallback, useId } from 'react';
import './ProposalCard.css';

export type NoteProposalKind =
  | 'character'
  | 'location'
  | 'item'
  | 'faction'
  | 'scene_card'
  | 'inbox';

export interface NoteProposal {
  id: string;
  kind: NoteProposalKind;
  title: string;
  destinationPath: string;
  body: string;
  frontmatter: Record<string, unknown>;
  sourceConversationTurnId: string;
  extractionConfidence: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'edited_and_confirmed';
}

export interface ProposalCardProps {
  proposals: NoteProposal[];
  onConfirm: (proposal: NoteProposal) => void;
  onReject: (proposalId: string) => void;
  onDismissAll: () => void;
  /** Called when user picks a folder path in Blank-mode disambiguation. */
  onBrowseFolder?: () => Promise<string | null>;
}

const KIND_LABELS: Record<NoteProposalKind, string> = {
  character: 'CHARACTER',
  location: 'LOCATION',
  item: 'ITEM',
  faction: 'FACTION',
  scene_card: 'SCENE',
  inbox: 'INBOX',
};

const KIND_ARIA: Record<NoteProposalKind, string> = {
  character: 'Character note proposal',
  location: 'Location note proposal',
  item: 'Item note proposal',
  faction: 'Faction note proposal',
  scene_card: 'Scene card proposal',
  inbox: 'Inbox note proposal',
};

function isBlankMode(proposal: NoteProposal): boolean {
  return !proposal.destinationPath || proposal.destinationPath.trim() === '';
}

interface EditState {
  title: string;
  body: string;
  destinationPath: string;
}

export function ProposalCard({
  proposals,
  onConfirm,
  onReject,
  onDismissAll,
  onBrowseFolder,
}: ProposalCardProps) {
  const queueDepthId = useId();
  const blankGroupId = useId();
  const sessionCheckboxId = useId();

  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [blankPath, setBlankPath] = useState('');
  const [blankForSession, setBlankForSession] = useState(false);

  const current = proposals[0] ?? null;
  const queueLength = proposals.length;

  const enterEdit = useCallback(() => {
    if (!current) return;
    setEditState({
      title: current.title,
      body: current.body,
      destinationPath: current.destinationPath,
    });
    setEditMode(true);
  }, [current]);

  const cancelEdit = useCallback(() => {
    setEditMode(false);
    setEditState(null);
  }, []);

  const handleSaveAndCreate = useCallback(() => {
    if (!current || !editState) return;
    const updated: NoteProposal = {
      ...current,
      title: editState.title.trim() || current.title,
      body: editState.body,
      destinationPath: editState.destinationPath,
      status: 'edited_and_confirmed',
    };
    setEditMode(false);
    setEditState(null);
    onConfirm(updated);
  }, [current, editState, onConfirm]);

  const handleConfirm = useCallback(() => {
    if (!current) return;
    if (isBlankMode(current)) return; // require path before confirming
    onConfirm({ ...current, status: 'confirmed' });
  }, [current, onConfirm]);

  const handleBlankConfirm = useCallback(() => {
    if (!current) return;
    const path = blankPath.trim();
    if (!path) return;
    const updated: NoteProposal = {
      ...current,
      destinationPath: path,
      status: 'confirmed',
    };
    if (blankForSession) {
      // Caller can read updated.destinationPath to persist for session.
    }
    setBlankPath('');
    setBlankForSession(false);
    onConfirm(updated);
  }, [current, blankPath, blankForSession, onConfirm]);

  const handleBrowse = useCallback(async () => {
    if (!onBrowseFolder) return;
    const picked = await onBrowseFolder();
    if (picked) setBlankPath(picked);
  }, [onBrowseFolder]);

  const handleReject = useCallback(() => {
    if (!current) return;
    onReject(current.id);
    setBodyExpanded(false);
    setEditMode(false);
    setEditState(null);
    setBlankPath('');
  }, [current, onReject]);

  const blankMode = current ? isBlankMode(current) && !editMode : false;

  return (
    <div
      className="pc-region"
      role="region"
      aria-label="Proposed notes"
      data-testid="proposal-card-region"
    >
      {/* Queue depth live region — always in DOM so AT pre-registers it */}
      <div
        id={queueDepthId}
        className="pc-queue-depth"
        aria-live="polite"
        aria-atomic="true"
        style={{ display: 'none' }}
      >
        {queueLength > 0 ? `${queueLength} proposal${queueLength !== 1 ? 's' : ''} pending` : ''}
      </div>

      {current && (
        <div className="pc-card" data-testid={`proposal-card-${current.id}`}>
          {/* Header: kind badge + queue depth */}
          <div className="pc-header-row">
            <span
              className={`pc-kind-badge pc-kind-badge--${current.kind}`}
              role="img"
              aria-label={KIND_ARIA[current.kind]}
            >
              {KIND_LABELS[current.kind]}
            </span>
            <div
              className="pc-queue-depth"
              aria-live="polite"
              aria-atomic="true"
            >
              {queueLength === 1
                ? '1 proposal'
                : `1 of ${queueLength} proposals ▼`}
            </div>
          </div>

          {/* Title */}
          {editMode && editState ? (
            <input
              className="pc-edit-input pc-edit-input--title"
              value={editState.title}
              onChange={(e) => setEditState((s) => s && { ...s, title: e.target.value })}
              aria-label="Proposal title"
              data-testid="pc-edit-title"
              autoFocus
            />
          ) : (
            <div className="pc-title" title={current.title}>
              {current.title}
            </div>
          )}

          {/* Destination path */}
          {editMode && editState ? (
            <input
              className="pc-edit-input"
              value={editState.destinationPath}
              onChange={(e) => setEditState((s) => s && { ...s, destinationPath: e.target.value })}
              placeholder="Destination path (e.g. Characters/Heroes/)"
              aria-label="Destination path"
              data-testid="pc-edit-path"
            />
          ) : (
            !blankMode && (
              <div className="pc-path" title={current.destinationPath}>
                {current.destinationPath}
              </div>
            )
          )}

          <hr className="pc-separator" aria-hidden="true" />

          {/* Body preview / edit textarea */}
          {editMode && editState ? (
            <textarea
              className="pc-edit-textarea"
              value={editState.body}
              onChange={(e) => setEditState((s) => s && { ...s, body: e.target.value })}
              aria-label="Proposal body"
              data-testid="pc-edit-body"
              rows={4}
            />
          ) : (
            <>
              {current.body && (
                <p
                  className={`pc-body-preview${bodyExpanded ? ' pc-body-preview--expanded' : ''}`}
                  data-testid="pc-body-preview"
                >
                  {current.body}
                </p>
              )}
              {current.body && (
                <button
                  type="button"
                  className="pc-show-more"
                  onClick={() => setBodyExpanded((v) => !v)}
                  aria-expanded={bodyExpanded}
                  aria-label={bodyExpanded ? `Collapse ${current.title} body` : `Expand ${current.title} body`}
                  data-testid="pc-show-more"
                >
                  {bodyExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </>
          )}

          {/* Blank-mode disambiguation prompt */}
          {blankMode && (
            <div
              className="pc-blank-prompt"
              role="group"
              aria-labelledby={blankGroupId}
              data-testid="pc-blank-prompt"
            >
              <p id={blankGroupId} className="pc-blank-label">
                Where should I put {KIND_LABELS[current.kind].charAt(0) + KIND_LABELS[current.kind].slice(1).toLowerCase() + 's'}?
              </p>
              <div className="pc-blank-path-row">
                <input
                  type="text"
                  className="pc-blank-path-input"
                  value={blankPath}
                  onChange={(e) => setBlankPath(e.target.value)}
                  placeholder="e.g. Characters/Heroes/"
                  aria-label="Destination folder path"
                  data-testid="pc-blank-path-input"
                />
                {onBrowseFolder && (
                  <button
                    type="button"
                    className="pc-blank-folder-btn"
                    onClick={() => void handleBrowse()}
                    aria-label="Browse for folder"
                    data-testid="pc-blank-folder-btn"
                  >
                    Browse…
                  </button>
                )}
              </div>
              <div className="pc-blank-session-row">
                <input
                  type="checkbox"
                  id={sessionCheckboxId}
                  className="pc-blank-checkbox"
                  checked={blankForSession}
                  onChange={(e) => setBlankForSession(e.target.checked)}
                  data-testid="pc-blank-session-checkbox"
                />
                <label htmlFor={sessionCheckboxId} className="pc-blank-checkbox-label">
                  Remember for this session (not saved permanently)
                </label>
              </div>
              <div className="pc-blank-actions">
                <button
                  type="button"
                  className="pc-btn-save"
                  onClick={handleBlankConfirm}
                  disabled={!blankPath.trim()}
                  aria-label="Confirm destination and save proposal"
                  data-testid="pc-blank-confirm-btn"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="pc-btn-cancel"
                  onClick={handleReject}
                  aria-label="Cancel and reject proposal"
                  data-testid="pc-blank-cancel-btn"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Action row */}
          {!blankMode && (
            <div className="pc-actions-row" role="group" aria-label="Proposal actions">
              {editMode ? (
                <>
                  <button
                    type="button"
                    className="pc-btn-save"
                    onClick={handleSaveAndCreate}
                    disabled={!editState?.title.trim()}
                    aria-label="Save edits and create note"
                    data-testid="pc-save-btn"
                  >
                    Save &amp; Create
                  </button>
                  <button
                    type="button"
                    className="pc-btn-cancel"
                    onClick={cancelEdit}
                    aria-label="Cancel editing"
                    data-testid="pc-cancel-btn"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="pc-btn-confirm"
                    onClick={handleConfirm}
                    aria-label={`Confirm proposal: ${current.title}`}
                    data-testid="pc-confirm-btn"
                  >
                    ✓ Confirm
                  </button>
                  <button
                    type="button"
                    className="pc-btn-reject"
                    onClick={handleReject}
                    aria-label={`Reject proposal: ${current.title}`}
                    data-testid="pc-reject-btn"
                  >
                    ✗ Reject
                  </button>
                  <button
                    type="button"
                    className="pc-btn-edit"
                    onClick={enterEdit}
                    aria-label={`Edit proposal: ${current.title}`}
                    data-testid="pc-edit-btn"
                  >
                    ✏ Edit
                  </button>
                </>
              )}
            </div>
          )}

          {/* Dismiss all */}
          {queueLength > 1 && !editMode && (
            <button
              type="button"
              className="pc-dismiss-all"
              onClick={onDismissAll}
              aria-label={`Dismiss all ${queueLength} proposals`}
              data-testid="pc-dismiss-all-btn"
            >
              Dismiss all ({queueLength})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
