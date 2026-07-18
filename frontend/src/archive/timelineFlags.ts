// SKY-7379 — Timeline-scoped Archive Agent flag contract (prereq for M25).
//
// Distinct from the scene-scoped continuity-flag model in `continuityComments.ts`
// (`InconsistencyItem`, anchored to a manuscript offset): a `TimelineFlag` is
// anchored to a *lane item* on the Timeline canvas (`affectedItemId`) and its
// `kind` vocabulary matches the Timeline design spec's problem-flag surfacing
// (docs/TIMELINE-VIEWS-DESIGN-SPEC.md §2/§7) — contradiction / gap / ordering
// skip — so the Inspector Archive tab's Flags section and the canvas per-item
// outline (M25, SKY-6981) have one shape to consume.
//
// Emission wiring lives with each detector's own domain: ordering-skip and gap
// flags come from the timeline auto-build pass (`timelinePlanBuild.ts`, which
// already computes plan-vs-written state); contradiction flags are a timeline-
// scoped projection of the existing scene-level continuity scan (`InconsistencyItem`,
// `continuityComments.ts`) via `continuityItemsToTimelineFlags` below.

import type { InconsistencyItem } from '../InconsistencyCard';

export type TimelineFlagKind = 'contradiction' | 'gap' | 'ordering_skip';

export interface TimelineFlag {
  /** Stable id — dedupe key across re-scans, like `InconsistencyItem.id`. */
  id: string;
  kind: TimelineFlagKind;
  /** One-line, human-readable (Inspector Flags card / canvas tooltip). */
  description: string;
  /** e.g. "Between Ch. 17 and Ch. 18" — where the badge/card points. */
  anchor: string;
  /** The lane item (scene/chapter/etc. id) to outline and select on Jump-to-scene. */
  affectedItemId: string;
}

/**
 * Timeline-level projection of open scene-scoped continuity flags: only the
 * ones whose flagged scene is actually present on this timeline become a
 * `contradiction` TimelineFlag, anchored to that scene as the lane item.
 */
export function continuityItemsToTimelineFlags(
  items: readonly InconsistencyItem[],
  timelineSceneIds: ReadonlySet<string>,
): TimelineFlag[] {
  const flags: TimelineFlag[] = [];
  for (const item of items) {
    if (item.status !== 'open') continue;
    const sceneId = item.manuscriptAnchor.sceneId;
    if (!timelineSceneIds.has(sceneId)) continue;
    flags.push({
      id: item.id,
      kind: 'contradiction',
      description: item.rationale,
      anchor: item.manuscriptAnchor.excerpt.trim(),
      affectedItemId: sceneId,
    });
  }
  return flags;
}
