import { useState, useRef, useCallback, type CSSProperties, type ReactNode } from 'react';
import { IdeaContextMenu } from './IdeaContextMenu';
import './IdeaCard.css';

export type IdeaCardType = 'character' | 'location' | 'item' | 'note' | 'scene';

export interface IdeaCardChip {
  id: string;
  name: string;
  type: IdeaCardType;
}

export interface IdeaCardIdea {
  id: string;
  title: string;
  type: Exclude<IdeaCardType, 'scene'>;
  linkedEntities?: IdeaCardChip[];
  savedPath?: string;
  updatedAt?: string;
  savedLabel?: string;
  /** Notes body — shown as a 120-char inline preview when expanded. */
  body?: string;
}

interface IdeaCardProps {
  idea: IdeaCardIdea;
  onOpenDetail: (ideaId: string) => void;
  metaAction?: ReactNode;
  isMultiSelect?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (ideaId: string) => void;
  onMenuAction?: (ideaId: string, actionId: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: (ideaId: string) => void;
  onChipClick?: (chip: IdeaCardChip) => void;
}

const TYPE_LABELS: Record<IdeaCardIdea['type'], string> = {
  character: 'Character',
  location: 'Location',
  item: 'Item',
  note: 'Note',
};

const BADGE_STYLES: Record<IdeaCardIdea['type'], CSSProperties> = {
  character: { background: 'var(--entity-char-bg)', color: 'var(--entity-char-text)' },
  location: { background: 'var(--entity-loc-bg)', color: 'var(--entity-loc-text)' },
  item: { background: 'var(--entity-item-bg)', color: 'var(--entity-item-text)' },
  note: { background: 'var(--entity-concept-bg)', color: 'var(--entity-concept-text)' },
};

const CHIP_STYLES: Record<IdeaCardType, CSSProperties> = {
  character: BADGE_STYLES.character,
  location: BADGE_STYLES.location,
  item: BADGE_STYLES.item,
  note: BADGE_STYLES.note,
  scene: { background: 'var(--bg-inset)', color: 'var(--neon-cyan)' },
};

const CARD_STYLE_COMPACT: CSSProperties = {
  height: '72px',
  padding: 'var(--space-3)',
  borderRadius: 'var(--radius-md)',
};

const CARD_STYLE_EXPANDED: CSSProperties = {
  padding: 'var(--space-3)',
  borderRadius: 'var(--radius-md)',
};

const TOGGLE_BTN_STYLE: CSSProperties = {
  flexShrink: 0,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0 2px',
  lineHeight: 1,
  fontSize: '10px',
  color: 'var(--text-muted)',
};

const MENU_STYLE: CSSProperties = {
  width: '28px',
  height: '28px',
};

const CHIPS_ROW_STYLE: CSSProperties = {
  overflow: 'hidden',
};

const BODY_PREVIEW_MAX = 120;

function truncateTitle(title: string) {
  return title.length > 80 ? `${title.slice(0, 80)}…` : title;
}

function truncateBody(body: string) {
  return body.length > BODY_PREVIEW_MAX ? `${body.slice(0, BODY_PREVIEW_MAX)}…` : body;
}

function formatRelativeUpdatedAt(updatedAt?: string) {
  if (!updatedAt) return 'Last updated: just now';
  const updatedMs = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedMs)) return 'Last updated: just now';

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - updatedMs) / 1000));
  if (elapsedSeconds < 60) return 'Last updated: just now';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `Last updated: ${elapsedMinutes} min ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Last updated: ${elapsedHours} hr ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Last updated: ${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
}

const LONG_PRESS_MS = 500;

export function IdeaCard({
  idea,
  onOpenDetail,
  metaAction,
  isMultiSelect = false,
  isSelected = false,
  onToggleSelect,
  onMenuAction,
  isExpanded = false,
  onToggleExpand,
  onChipClick,
}: IdeaCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = truncateTitle(idea.title);
  const metadata = idea.savedPath ? formatRelativeUpdatedAt(idea.updatedAt) : 'unsaved session idea';
  const bodyPreview = idea.body ? truncateBody(idea.body) : '';
  const bodyPreviewId = `idea-card-body-${idea.id}`;

  const openMenu = useCallback(() => setMenuOpen(true), []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuBtnRef.current?.focus();
  }, []);

  const handleMenuAction = useCallback(
    (actionId: string) => {
      setMenuOpen(false);
      menuBtnRef.current?.focus();
      onMenuAction?.(idea.id, actionId);
    },
    [idea.id, onMenuAction],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    openMenu();
  }, [openMenu]);

  const handleTouchStart = useCallback(() => {
    longPressTimerRef.current = setTimeout(() => {
      openMenu();
    }, LONG_PRESS_MS);
  }, [openMenu]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isMultiSelect) return;
      if ((e.target as HTMLElement).closest('.idea-card-menu-button')) return;
      onToggleSelect?.(idea.id);
    },
    [isMultiSelect, idea.id, onToggleSelect],
  );

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isMultiSelect && e.target === e.currentTarget) {
        e.preventDefault();
        onOpenDetail(idea.id);
      } else if (isMultiSelect && e.key === ' ' && e.target === e.currentTarget) {
        e.preventDefault();
        onToggleSelect?.(idea.id);
      }
    },
    [isMultiSelect, idea.id, onToggleSelect, onOpenDetail],
  );

  return (
    <li
      className={`idea-card idea-card-compact${isExpanded ? ' idea-card-expanded' : ''}${isMultiSelect ? ' idea-card-multiselect' : ''}${isSelected ? ' idea-card-selected' : ''}`}
      data-testid={`idea-card-${idea.id}`}
      style={isExpanded ? CARD_STYLE_EXPANDED : CARD_STYLE_COMPACT}
      aria-label={`${idea.title}, ${TYPE_LABELS[idea.type]}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      tabIndex={0}
    >
      {isMultiSelect && (
        <input
          type="checkbox"
          className="idea-card-checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect?.(idea.id)}
          aria-label={`Select idea ${idea.title}`}
          data-testid={`idea-card-checkbox-${idea.id}`}
        />
      )}

      <div className="idea-card-row idea-card-title-row">
        <button
          className="idea-card-toggle-btn"
          type="button"
          style={TOGGLE_BTN_STYLE}
          aria-expanded={isExpanded}
          aria-controls={bodyPreviewId}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} body preview for ${idea.title}`}
          data-testid={`idea-card-toggle-${idea.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.(idea.id);
          }}
        >
          {isExpanded ? '▾' : '▸'}
        </button>
        <button
          className="idea-card-title"
          type="button"
          title={idea.title}
          aria-label={`Open idea detail for ${idea.title}`}
          onClick={() => onOpenDetail(idea.id)}
        >
          {title}
        </button>
        <span className="idea-card-type-badge" style={BADGE_STYLES[idea.type]}>
          {TYPE_LABELS[idea.type]}
        </span>
        <button
          ref={menuBtnRef}
          className="idea-card-menu-button"
          type="button"
          aria-label={`Idea actions for ${idea.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={MENU_STYLE}
          onClick={(e) => {
            e.stopPropagation();
            openMenu();
          }}
        >
          ⋮
        </button>
      </div>

      <div
        className="idea-card-row idea-card-chip-row"
        data-testid={`idea-card-chips-${idea.id}`}
        style={CHIPS_ROW_STYLE}
        aria-label="Linked entities"
      >
        {(idea.linkedEntities ?? []).map((chip) =>
          onChipClick ? (
            <button
              key={chip.id}
              type="button"
              className="idea-card-chip idea-card-chip-interactive"
              style={CHIP_STYLES[chip.type]}
              title={chip.name}
              aria-label={`Navigate to ${chip.name}`}
              onClick={(e) => { e.stopPropagation(); onChipClick(chip); }}
            >
              {chip.name}
            </button>
          ) : (
            <span key={chip.id} className="idea-card-chip" style={CHIP_STYLES[chip.type]} title={chip.name}>
              {chip.name}
            </span>
          )
        )}
      </div>

      <div className="idea-card-row idea-card-meta-row">
        <span>{metadata}</span>
        {metaAction ?? (idea.savedLabel && <span className="idea-card-saved-label">{idea.savedLabel}</span>)}
      </div>

      {isExpanded && (
        <div
          id={bodyPreviewId}
          className="idea-card-body-preview"
          data-testid={`idea-card-body-preview-${idea.id}`}
          aria-label="Body preview"
        >
          {bodyPreview || null}
        </div>
      )}

      {menuOpen && (
        <IdeaContextMenu
          anchorEl={menuBtnRef.current}
          onAction={handleMenuAction}
          onClose={closeMenu}
          hasSavedPath={!!idea.savedPath}
        />
      )}
    </li>
  );
}
