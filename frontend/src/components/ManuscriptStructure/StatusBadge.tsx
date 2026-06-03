import { type ReactElement } from 'react';
import type { DraftState } from '../../types';

export type SceneStatus = 'draft' | 'review' | 'final' | 'cut';

export function draftStateToStatus(draftState?: DraftState): SceneStatus {
  if (draftState === 'final') return 'final';
  if (draftState === 'review') return 'review';
  return 'draft';
}

interface StatusBadgeProps {
  status: SceneStatus;
  /** Display size in px (default 12) */
  size?: number;
}

const LABEL: Record<SceneStatus, string> = {
  draft: 'Draft',
  review: 'In Review',
  final: 'Final',
  cut: 'Cut',
};

export function StatusBadge({ status, size = 12 }: StatusBadgeProps): ReactElement {
  return (
    <span
      className={`status-badge status-badge--${status}`}
      style={{ width: size, height: size }}
      aria-label={`Status: ${LABEL[status]}`}
      title={LABEL[status]}
      role="img"
    />
  );
}
