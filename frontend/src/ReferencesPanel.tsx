// M9a (SKY-9822, PLAN.md §M9 item 1) — editor right-panel References tab:
// wiki-links typed anywhere in the manuscript auto-collect here with typed
// roles (`Character · POV`, `Location · hub`, `… · pinned`). Unresolved
// targets — no matching note/entity/scene in either vault — render flagged
// with a Create affordance. Picking a row goes through the same M16
// resolution path the editors use (`handleNotesWikiLinkClick`), which opens
// an existing reference or creates the note first when it doesn't exist yet,
// so a just-created note resolves here live via the shared vault state.
import { useMemo } from 'react';
import type { EntityEntry, Scene, Story } from './types';
import {
  ENTITY_TYPE_LABELS,
  WIKI_LINK_RE,
  isWikiLinkTargetResolved,
  buildWikiLinkTitleIndex,
  normalize,
  resolveCrossTabLink,
  wikiLinkTargetStem,
} from './crossTabLinkResolver';
import './ReferencesPanel.css';

export type ReferenceRole = 'pinned' | 'pov' | 'hub' | 'unresolved';

export interface CollectedReference {
  /** Raw wiki-link target of the first occurrence — what a click resolves. */
  target: string;
  /** Display title: the resolved entity/scene name, else the link stem as typed. */
  title: string;
  /** Prototype `Type · role` subtitle, e.g. "Character · POV". */
  subtitle: string;
  role: ReferenceRole;
  /** Distinct scenes whose prose links this reference. */
  sceneCount: number;
}

export interface ReferenceCollectionContext {
  stories: Story[];
  entities: EntityEntry[];
  notePaths: string[];
}

/** A reference linked from this many distinct scenes reads as a hub. */
const HUB_SCENE_THRESHOLD = 3;

const ROLE_TEXT: Record<ReferenceRole, string> = {
  pinned: 'pinned',
  pov: 'POV',
  hub: 'hub',
  unresolved: 'unresolved link',
};

/**
 * Scan every scene block of `story` for [[wiki-links]], dedupe by resolved
 * identity, and type each one. Pure and synchronous — computed from the same
 * live React state the editors render, so a link typed a moment ago is
 * collected immediately (same contract as `findStoryBacklinks`).
 * Exported for unit tests.
 */
export function collectStoryReferences(
  story: Story | null,
  context: ReferenceCollectionContext,
  activeScene?: Scene | null,
): CollectedReference[] {
  if (!story) return [];

  // Pass 1 — gather raw occurrences, keyed by normalized stem.
  const occurrences = new Map<string, { target: string; sceneIds: Set<string> }>();
  for (const chapter of story.chapters) {
    for (const scene of chapter.scenes) {
      for (const block of scene.blocks) {
        for (const m of (block.content ?? '').matchAll(WIKI_LINK_RE)) {
          const target = m[1];
          const key = normalize(wikiLinkTargetStem(target));
          if (!key) continue;
          const entry = occurrences.get(key);
          if (entry) entry.sceneIds.add(scene.id);
          else occurrences.set(key, { target, sceneIds: new Set([scene.id]) });
        }
      }
    }
  }
  if (occurrences.size === 0) return [];

  const titleIndex = buildWikiLinkTitleIndex(context);
  const povName = normalize(activeScene?.timelineMetadata?.pov ?? story.pov ?? '');

  // Pass 2 — resolve each unique stem; merge stems that land on the same
  // entity/scene (e.g. `[[Mira]]` and `[[character: Mira Veynn]]`).
  interface MergedReference {
    target: string;
    title: string;
    typeLabel: string;
    unresolved: boolean;
    names: Set<string>;
    sceneIds: Set<string>;
  }
  const merged = new Map<string, MergedReference>();
  for (const { target, sceneIds } of occurrences.values()) {
    const resolved = isWikiLinkTargetResolved(target, titleIndex);
    const match = resolveCrossTabLink(target, context).matches[0];

    let identity = `stem:${normalize(wikiLinkTargetStem(target))}`;
    let title = wikiLinkTargetStem(target);
    let typeLabel = 'Note';
    const names = new Set<string>([normalize(title)]);
    if (match?.kind === 'scene') {
      if (resolved) identity = `scene:${match.sceneId}`;
      title = match.scene.title;
      typeLabel = 'Scene';
      names.add(normalize(match.scene.title));
    } else if (match?.kind === 'entity') {
      if (resolved) identity = `entity:${match.entityId}`;
      title = match.entity.name;
      // Plain notes resolve as fallback 'other' entities — label those Note,
      // not Entity; real typed entities keep their vault type.
      typeLabel = match.entityId.startsWith('note:') && match.entity.type === 'other'
        ? 'Note'
        : ENTITY_TYPE_LABELS[match.entity.type];
      names.add(normalize(match.entity.name));
      for (const alias of match.entity.aliases ?? []) names.add(normalize(alias));
    }

    const existing = merged.get(identity);
    if (existing) {
      for (const id of sceneIds) existing.sceneIds.add(id);
      for (const n of names) existing.names.add(n);
    } else {
      merged.set(identity, { target, title, typeLabel, unresolved: !resolved, names, sceneIds: new Set(sceneIds) });
    }
  }

  // Pass 3 — assign roles now that per-reference scene counts are final.
  const result: CollectedReference[] = [];
  for (const ref of merged.values()) {
    let role: ReferenceRole = 'pinned';
    if (ref.unresolved) role = 'unresolved';
    else if (povName && ref.names.has(povName)) role = 'pov';
    else if (ref.sceneIds.size >= HUB_SCENE_THRESHOLD) role = 'hub';
    result.push({
      target: ref.target,
      title: ref.title,
      subtitle: `${ref.typeLabel} · ${ROLE_TEXT[role]}`,
      role,
      sceneCount: ref.sceneIds.size,
    });
  }
  return result;
}

/** Document glyph from the prototype's References-tab rows. */
function DocGlyph() {
  return (
    <svg
      className="references-panel-glyph"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

/** Open-arrow glyph (↗) from the prototype's References-tab rows. */
function OpenArrow() {
  return (
    <svg
      className="references-panel-arrow"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

interface Props {
  story: Story | null;
  /** Scene whose POV types the `Character · POV` role; story POV is the fallback. */
  activeScene: Scene | null;
  stories: Story[];
  entities: EntityEntry[];
  notePaths: string[];
  /**
   * M16 wiki-link click path: opens a resolved reference, creates-then-opens
   * an unresolved one (DesktopShell's `handleNotesWikiLinkClick`).
   */
  onPickReference: (target: string) => void;
}

export default function ReferencesPanel({
  story,
  activeScene,
  stories,
  entities,
  notePaths,
  onPickReference,
}: Props) {
  const references = useMemo(
    () => collectStoryReferences(story, { stories, entities, notePaths }, activeScene),
    [story, stories, entities, notePaths, activeScene],
  );

  if (!story) {
    return (
      <div className="references-panel-none">
        <p>Select a story to see its references.</p>
      </div>
    );
  }

  return (
    <div className="references-panel-root">
      <div className="references-panel-label">Pinned References</div>
      {references.length === 0 ? (
        <div className="references-panel-empty" data-testid="references-empty">
          <DocGlyph />
          <p>No references yet.</p>
          <p className="references-panel-empty-sub">
            Type <code>[[Note Name]]</code> in your manuscript and it lands here automatically.
          </p>
        </div>
      ) : (
        <ul className="references-panel-list">
          {references.map((ref) => (
            <li key={`${ref.role === 'unresolved' ? 'u' : 'r'}:${ref.title}`}>
              <button
                type="button"
                className={`references-panel-row${ref.role === 'unresolved' ? ' references-panel-row--unresolved' : ''}`}
                onClick={() => onPickReference(ref.target)}
                aria-label={
                  ref.role === 'unresolved'
                    ? `${ref.title} — unresolved link, create the note`
                    : `Open ${ref.title}`
                }
              >
                <DocGlyph />
                <span className="references-panel-text">
                  <span className="references-panel-title">{ref.title}</span>
                  <span className="references-panel-sub">{ref.subtitle}</span>
                </span>
                {ref.role === 'unresolved'
                  ? <span className="references-panel-create">+ Create</span>
                  : <OpenArrow />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="references-panel-hint">
        Wiki-links in the manuscript land here automatically.
      </div>
    </div>
  );
}
