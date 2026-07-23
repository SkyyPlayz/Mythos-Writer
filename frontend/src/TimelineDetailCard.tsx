/**
 * SKY-793 — Timeline detail / hover card.
 *
 * Right-side glassmorphism panel that surfaces scene metadata when a timeline
 * node is hovered or selected. The card itself is presentational; the parent
 * view owns hover/selection state and the editing actions.
 *
 * Visual contract (Liquid Neon spec §2.3 + §6.4):
 *  - Glass fill `--glass-fill` + 12px backdrop-blur (with fallback via
 *    `--glass-fill-fallback` for `prefers-reduced-transparency` and unsupported
 *    backdrop-filter — both handled in tokens.css).
 *  - Hover state slides in from the right over 160ms with `--ease-out`.
 *  - Selected state adds a 32%-cyan tint and a 3px neon frame over 180ms.
 *  - `prefers-reduced-motion` removes the slide-in (handled in the global
 *    index.css reset + duration tokens).
 *  - Colors are read from tokens only — no hardcoded hex.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { ArcOption, CharOption, LocationOption } from './TimelineFilterBar';
import type { SpreadsheetScene } from './timelineFilters';
import './TimelineDetailCard.css';

export type DetailCardState = 'hover' | 'selected';

export type TimelineSceneAction =
  | 'edit'
  | 'delete-from-timeline'
  | 'change-pov'
  | 'change-arc'
  | 'duplicate';

interface DetailCardProps {
  scene: SpreadsheetScene | null;
  state: DetailCardState;
  arcs: ArcOption[];
  characters: CharOption[];
  locations: LocationOption[];
  onEdit: (sceneId: string) => void;
  /** Optional — called when the card itself is right-clicked. */
  onRequestContextMenu?: (sceneId: string, x: number, y: number) => void;
}

function resolveCharName(id: string, characters: CharOption[]): string {
  if (!id) return '';
  return characters.find(c => c.id === id)?.name ?? id;
}

function resolveLocationName(id: string, locations: LocationOption[]): string {
  if (!id) return '';
  return locations.find(l => l.id === id)?.name ?? id;
}

function parseMoodTags(mood: string): string[] {
  return mood
    .split(/[,;]/g)
    .map(t => t.trim())
    .filter(Boolean);
}

/**
 * Detail card panel. Renders `null` when no scene is provided so the parent
 * can mount it unconditionally without empty-state plumbing.
 */
export default function TimelineDetailCard({
  scene,
  state,
  arcs,
  characters,
  locations,
  onEdit,
  onRequestContextMenu,
}: DetailCardProps) {
  // Memoised resolutions so child renders stay cheap during rapid hover.
  const sceneArcs = useMemo(() => {
    if (!scene) return [];
    return scene.arcIds
      .map(id => arcs.find(a => a.id === id))
      .filter((a): a is ArcOption => Boolean(a));
  }, [scene, arcs]);

  const povName = scene ? resolveCharName(scene.pov, characters) : '';
  const locationName = scene ? resolveLocationName(scene.locationId, locations) : '';
  const moodTags = scene ? parseMoodTags(scene.mood) : [];

  if (!scene) return null;

  const wordsLabel =
    scene.wordCount != null ? `${scene.wordCount.toLocaleString()} words` : '—';

  return (
    <aside
      className={`tdc-root tdc-root--${state}`}
      data-testid="timeline-detail-card"
      data-state={state}
      aria-label={`Scene details: ${scene.title}`}
      role={state === 'selected' ? 'region' : 'tooltip'}
      onContextMenu={e => {
        if (!onRequestContextMenu) return;
        e.preventDefault();
        onRequestContextMenu(scene.id, e.clientX, e.clientY);
      }}
    >
      <header className="tdc-header">
        <h3 className="tdc-title" title={scene.title}>
          {scene.title || 'Untitled scene'}
        </h3>
        <button
          type="button"
          className="tdc-edit-btn"
          onClick={() => onEdit(scene.id)}
          data-testid="timeline-detail-card-edit"
        >
          Edit
        </button>
      </header>

      <dl className="tdc-meta">
        <div className="tdc-meta-row">
          <dt>POV</dt>
          <dd data-testid="tdc-pov">{povName || '—'}</dd>
        </div>
        <div className="tdc-meta-row">
          <dt>Words</dt>
          <dd data-testid="tdc-words">{wordsLabel}</dd>
        </div>
        <div className="tdc-meta-row">
          <dt>Location</dt>
          <dd data-testid="tdc-location">{locationName || '—'}</dd>
        </div>
      </dl>

      <section className="tdc-section" aria-label="Arcs">
        <div className="tdc-section-label">Arcs</div>
        {sceneArcs.length === 0 ? (
          <span className="tdc-empty">No arcs</span>
        ) : (
          <ul className="tdc-arc-list">
            {sceneArcs.map(arc => (
              <li key={arc.id} className="tdc-arc-pill">
                <span
                  className="tdc-arc-dot"
                  style={arc.color ? { background: arc.color } : undefined}
                  aria-hidden="true"
                />
                {arc.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tdc-section" aria-label="Mood">
        <div className="tdc-section-label">Mood</div>
        {moodTags.length === 0 ? (
          <span className="tdc-empty">No mood</span>
        ) : (
          <ul className="tdc-mood-list">
            {moodTags.map(tag => (
              <li key={tag} className="tdc-mood-tag">{tag}</li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Context menu — right-click affordances per SKY-793 scope.
// ─────────────────────────────────────────────────────────────────────────────

interface ContextMenuProps {
  sceneId: string;
  x: number;
  y: number;
  onAction: (action: TimelineSceneAction) => void;
  onDismiss: () => void;
}

interface MenuItem {
  action: TimelineSceneAction;
  label: string;
  danger?: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { action: 'edit', label: 'Edit scene details' },
  { action: 'change-pov', label: 'Change POV' },
  { action: 'change-arc', label: 'Change arc membership' },
  { action: 'duplicate', label: 'Duplicate' },
  { action: 'delete-from-timeline', label: 'Delete from timeline', danger: true },
];

/**
 * Floating glass menu anchored at (x, y). Dismisses on outside click, Escape,
 * or scroll so it can't strand the user.
 */
export function TimelineSceneContextMenu({
  sceneId,
  x,
  y,
  onAction,
  onDismiss,
}: ContextMenuProps) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (!ref.current) return;
      if (event.target instanceof Node && ref.current.contains(event.target)) return;
      onDismiss();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    const handleScroll = () => onDismiss();
    // Capture so we beat outer scroll listeners that might run after dismissal.
    document.addEventListener('mousedown', handlePointer, true);
    document.addEventListener('contextmenu', handlePointer, true);
    document.addEventListener('keydown', handleKey, true);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('contextmenu', handlePointer, true);
      document.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onDismiss]);

  // Auto-focus first item so Up/Down arrow keys land somewhere sensible.
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('button');
    first?.focus();
  }, []);

  return (
    <ul
      ref={ref}
      role="menu"
      aria-label="Scene actions"
      className="tdc-context-menu"
      style={{ top: y, left: x }}
      data-testid="timeline-scene-context-menu"
      data-scene-id={sceneId}
      onContextMenu={e => e.preventDefault()}
    >
      {MENU_ITEMS.map(item => (
        <li key={item.action} role="none">
          <button
            type="button"
            role="menuitem"
            className={`tdc-context-item${item.danger ? ' tdc-context-item--danger' : ''}`}
            onClick={() => {
              onAction(item.action);
              onDismiss();
            }}
            data-testid={`timeline-scene-context-${item.action}`}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
