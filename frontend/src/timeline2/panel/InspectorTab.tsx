// Beta 4 M25 — Inspector tab (§8.6, prototype 3305–3475).
// Three editors, resolved from the shared selection:
//   · Scene-card editor  — plotline cards (title / plotline / chapter /
//     what-happens / written toggle / delete)
//   · Lane-item editor   — eras, spans, arcs, character journeys, world
//     events, themes, custom-row items (exact-time, EMBEDS, color row)
//   · Event editor       — key events (pencil toggles edit: title, chapter,
//     DATE/TIME → picker, location, POV, summary; static view shows rows +
//     KEY EVENT badge + impact chips)
// All numeric fields are §1.4 draft-commit via DraftInput.
import { useState } from 'react';
import type {
  TimelineCalendar,
  TimelineDefinition,
  TimelineEra,
  TimelineEvent,
  TimelineRow,
  TimelineSpan,
} from '../../timelinesTypes';
import type { InspectorTarget, TimelineSelectableType } from './selection';
import { formatWhen, roundWhen, whenPerYear } from '../axis/calendarCodec';
import { LANE_PALETTE } from '../axis/palette';
import { DraftNumberInput, DraftTextInput } from './DraftInput';

type AnyItem = TimelineEra | TimelineSpan | TimelineEvent;

export interface InspectorTabProps {
  target: InspectorTarget | null;
  calendar: TimelineCalendar;
  /** Axis start — display fallback for invalid stored `when`s (§8.2). */
  fallbackWhen: number;
  /** All timelines (EMBEDS select) + the active one to exclude. */
  timelines: TimelineDefinition[];
  activeTimelineId: string;
  /** Plotline rows for the scene-card PLOTLINE select. */
  plotlines: TimelineRow[];
  /** Ordered chapter labels for the scene-card CHAPTER select. */
  chapterLabels: string[];
  /** Re-plot a card onto a chapter's date (0-based index). */
  whenForChapter: (chapterIndex: number) => number;
  onLocalMutate: (type: TimelineSelectableType, item: AnyItem) => void;
  onPersist: (type: TimelineSelectableType, item: AnyItem) => void;
  onDelete: (type: TimelineSelectableType, item: AnyItem, kindLabel: string) => void;
  onOpenExactTime: () => void;
  onClose: () => void;
}

/** `when` = absolute hours / 10 in the ACTIVE calendar (M21 codec) — the
 *  YEAR fields edit plain calendar-year floats (871.25 = quarter into 871). */
const whenToYear = (when: number, cal: TimelineCalendar) => when / whenPerYear(cal);
const yearToWhen = (year: number, cal: TimelineCalendar) => roundWhen(year * whenPerYear(cal));

export default function InspectorTab(props: InspectorTabProps) {
  const { target } = props;
  if (!target) {
    return (
      <div className="trp-empty" data-testid="trp-inspector-empty">
        <div className="trp-empty-title">Nothing selected</div>
        <div className="trp-empty-sub">
          Click any event, span or lane item on the timeline to inspect and edit it here.
        </div>
      </div>
    );
  }
  // Keyed remount per item so edit-mode and drafts reset cleanly on reselect.
  if (target.editor === 'card') return <SceneCardEditor key={target.item.id} {...props} card={target.item} />;
  if (target.editor === 'event') return <EventEditor key={target.item.id} {...props} event={target.item} />;
  return <LaneItemEditor key={target.item.id} {...props} target={target} />;
}

/* ── Shared bits ── */

function FieldLabel({ children, title }: { children: React.ReactNode; title?: string }) {
  return <div className="trp-label" title={title}>{children}</div>;
}

function DeleteButton({ label, onClick, testid }: { label: string; onClick: () => void; testid: string }) {
  return (
    <button type="button" className="trp-delete" onClick={onClick} data-testid={testid}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </svg>
      {label}
    </button>
  );
}

function ExactTimeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="trp-exact"
      onClick={onClick}
      title="Set year, month, day and hour — uses this timeline's calendar"
      data-testid="trp-exact-time"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
      Set exact time…
    </button>
  );
}

/* ── Scene-card editor (prototype tlCardSel, 3313–3345) ── */

function SceneCardEditor(props: InspectorTabProps & { card: TimelineEvent }) {
  const { card, plotlines, chapterLabels, whenForChapter, onLocalMutate, onPersist, onDelete, onClose } = props;
  const save = (next: TimelineEvent) => {
    onLocalMutate('event', next);
    onPersist('event', next);
  };
  const chapterValue = card.chapter ?? 1;
  return (
    <div className="trp-card trp-card--editor" data-testid="trp-card-editor">
      <div className="trp-card-head">
        <span className="trp-card-title">Scene card</span>
        {card.beat && <span className="trp-beat-badge" data-testid="trp-beat-badge">TEMPLATE BEAT</span>}
        <button type="button" className="trp-close" onClick={onClose} aria-label="Close inspector" data-testid="trp-card-close">✕</button>
      </div>
      <FieldLabel>TITLE</FieldLabel>
      <DraftTextInput
        className="trp-input"
        value={card.name}
        onLive={(name) => onLocalMutate('event', { ...card, name })}
        onCommit={(name) => save({ ...card, name: name.trim() || card.name })}
        aria-label="Card title"
        data-testid="trp-card-title"
      />
      <div className="trp-row">
        <div className="trp-col">
          <FieldLabel>PLOTLINE</FieldLabel>
          <select
            className="trp-select"
            value={card.rowId ?? ''}
            onChange={(e) => save({ ...card, rowId: e.target.value })}
            aria-label="Plotline"
            data-testid="trp-card-plotline"
          >
            {plotlines.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="trp-col trp-col--narrow">
          <FieldLabel>CHAPTER</FieldLabel>
          <select
            className="trp-select"
            value={chapterValue}
            onChange={(e) => {
              const chapter = parseInt(e.target.value, 10);
              save({ ...card, chapter, when: whenForChapter(chapter - 1) });
            }}
            aria-label="Chapter"
            data-testid="trp-card-chapter"
          >
            {chapterLabels.map((label, i) => (
              <option key={i} value={i + 1}>{label || `Ch. ${i + 1}`}</option>
            ))}
            {chapterValue > chapterLabels.length && (
              <option value={chapterValue}>{`Ch. ${chapterValue}`}</option>
            )}
          </select>
        </div>
      </div>
      <FieldLabel>WHAT HAPPENS</FieldLabel>
      <DraftTextInput
        multiline
        className="trp-textarea"
        value={card.summary ?? ''}
        onCommit={(summary) => save({ ...card, summary })}
        aria-label="What happens"
        data-testid="trp-card-summary"
      />
      <div className="trp-toggle-row">
        <button
          type="button"
          role="switch"
          aria-checked={card.written === true}
          aria-label="Written"
          className={`trp-toggle${card.written ? ' trp-toggle--on' : ''}`}
          onClick={() => save({ ...card, written: !card.written, beat: card.written ? card.beat : undefined })}
          data-testid="trp-card-written"
        >
          <span className="trp-toggle-knob" />
        </button>
        <span className="trp-toggle-label">Written (bar shows on the card)</span>
      </div>
      <DeleteButton label="Delete card" onClick={() => onDelete('event', card, 'Scene card')} testid="trp-card-delete" />
    </div>
  );
}

/* ── Lane-item editor (prototype tlLaneEd, 3346–3407) ── */

function LaneItemEditor(props: InspectorTabProps & { target: Extract<InspectorTarget, { editor: 'lane' }> }) {
  const { target, calendar, fallbackWhen, timelines, activeTimelineId, onLocalMutate, onPersist, onDelete, onOpenExactTime, onClose } = props;
  const { item, type, variant, kindLabel } = target;
  const save = (next: AnyItem) => {
    onLocalMutate(type, next);
    onPersist(type, next);
  };
  const isRange = variant !== 'world' && variant !== 'theme';
  const rangeItem = item as TimelineEra | TimelineSpan;
  const pointItem = item as TimelineEvent;
  const startLabel = variant === 'journey' ? 'APPEARS (YEAR)' : 'STARTS (YEAR)';
  const endLabel = variant === 'journey' ? 'UNTIL (YEAR)' : 'ENDS (YEAR)';
  const hasColor = type !== 'event';

  return (
    <div className="trp-card trp-card--editor" data-testid="trp-lane-editor">
      <div className="trp-card-head">
        <span className="trp-card-title" data-testid="trp-lane-kind">{kindLabel}</span>
        <button type="button" className="trp-close" onClick={onClose} aria-label="Close inspector" data-testid="trp-lane-close">✕</button>
      </div>
      <FieldLabel>TITLE</FieldLabel>
      <DraftTextInput
        className="trp-input"
        value={item.name}
        onLive={(name) => onLocalMutate(type, { ...item, name })}
        onCommit={(name) => save({ ...item, name: name.trim() || item.name })}
        aria-label={`${kindLabel} title`}
        data-testid="trp-lane-title"
      />
      {isRange ? (
        <div className="trp-row">
          <div className="trp-col">
            <FieldLabel title={variant === 'journey' ? 'When the line begins — birth, or first appearance' : undefined}>
              {startLabel}
            </FieldLabel>
            <DraftNumberInput
              className="trp-input trp-input--mono"
              value={whenToYear(rangeItem.startWhen, calendar)}
              onCommit={(year) => {
                const startWhen = yearToWhen(year, calendar);
                // The store rejects end ≤ start — keep at least one tick apart.
                const endWhen = rangeItem.endWhen > startWhen ? rangeItem.endWhen : roundWhen(startWhen + 0.1);
                save({ ...rangeItem, startWhen, endWhen });
              }}
              aria-label={`${kindLabel} start year`}
              data-testid="trp-lane-start"
            />
          </div>
          <div className="trp-col">
            <FieldLabel title={variant === 'journey' ? 'When the line ends — death, or last appearance' : undefined}>
              {endLabel}
            </FieldLabel>
            <DraftNumberInput
              className="trp-input trp-input--mono"
              value={whenToYear(rangeItem.endWhen, calendar)}
              onCommit={(year) => {
                const endWhen = yearToWhen(year, calendar);
                if (endWhen <= rangeItem.startWhen) return; // snaps back (§8.2 guard)
                save({ ...rangeItem, endWhen });
              }}
              aria-label={`${kindLabel} end year`}
              data-testid="trp-lane-end"
            />
          </div>
        </div>
      ) : (
        <div className="trp-row">
          <div className="trp-col">
            <FieldLabel>DAY / DATE</FieldLabel>
            <div className="trp-readout" data-testid="trp-lane-when-readout">
              {formatWhen(pointItem.when, calendar, fallbackWhen)}
            </div>
          </div>
          <div className="trp-col trp-col--narrow">
            <FieldLabel title="Sets where it plots on the time axis">YEAR</FieldLabel>
            <DraftNumberInput
              className="trp-input trp-input--mono"
              value={whenToYear(pointItem.when, calendar)}
              onCommit={(year) => save({ ...pointItem, when: yearToWhen(year, calendar) })}
              aria-label={`${kindLabel} year`}
              data-testid="trp-lane-year"
            />
          </div>
        </div>
      )}
      {variant === 'world' && (
        <>
          <FieldLabel>WHAT HAPPENS</FieldLabel>
          <DraftTextInput
            multiline
            className="trp-textarea trp-textarea--short"
            value={pointItem.summary ?? ''}
            onCommit={(summary) => save({ ...pointItem, summary })}
            aria-label="What happens"
            data-testid="trp-lane-summary"
          />
        </>
      )}
      <ExactTimeButton onClick={onOpenExactTime} />
      {variant === 'span' && (
        <>
          <FieldLabel title="Drop an existing timeline into this span — clicking the span then opens it">
            EMBEDS TIMELINE
          </FieldLabel>
          <select
            className="trp-select"
            value={(item as TimelineSpan).opensTimelineId ?? ''}
            onChange={(e) => {
              const span = { ...(item as TimelineSpan) };
              if (e.target.value) span.opensTimelineId = e.target.value;
              else delete span.opensTimelineId;
              save(span);
            }}
            aria-label="Embeds timeline"
            data-testid="trp-lane-embed"
          >
            <option value="">Nothing — plain span</option>
            {timelines
              .filter((t) => t.id !== activeTimelineId)
              .map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
          </select>
        </>
      )}
      {hasColor && (
        <>
          <FieldLabel>COLOR</FieldLabel>
          <div className="trp-swatches" role="radiogroup" aria-label={`${kindLabel} color`} data-testid="trp-lane-colors">
            {LANE_PALETTE.map((color) => {
              const current = (item as TimelineEra | TimelineSpan).color;
              const active = current === color;
              return (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`Color ${color}`}
                  className={`trp-swatch${active ? ' trp-swatch--active' : ''}`}
                  style={{ background: color, boxShadow: active ? `0 0 10px ${color}` : undefined }}
                  onClick={() => save({ ...item, color })}
                  data-testid={`trp-swatch-${color.replace('#', '')}`}
                />
              );
            })}
          </div>
        </>
      )}
      <DeleteButton label="Delete" onClick={() => onDelete(type, item, kindLabel)} testid="trp-lane-delete" />
    </div>
  );
}

/* ── Event editor (prototype evDetail / tlEvEd, 3408–3460) ── */

function EventEditor(props: InspectorTabProps & { event: TimelineEvent }) {
  const { event, calendar, fallbackWhen, onLocalMutate, onPersist, onDelete, onOpenExactTime, onClose } = props;
  const [editing, setEditing] = useState(false);
  const save = (next: TimelineEvent) => {
    onLocalMutate('event', next);
    onPersist('event', next);
  };
  const whenLabel = formatWhen(event.when, calendar, fallbackWhen);
  const impactChips = (event.impact ?? '')
    .split(',')
    .map((chip) => chip.trim())
    .filter(Boolean);

  return (
    <div className="trp-card trp-card--event" data-testid="trp-event-editor">
      <div className="trp-event-head">
        <div className="trp-event-icon" aria-hidden="true">{event.icon ?? '✦'}</div>
        <div className="trp-event-titles">
          <div className="trp-event-title" data-testid="trp-event-title">{event.name}</div>
          <span className="trp-key-badge">KEY EVENT</span>
        </div>
        <div className="trp-event-tools">
          <button
            type="button"
            className={`trp-pencil${editing ? ' trp-pencil--active' : ''}`}
            onClick={() => setEditing((v) => !v)}
            title="Edit this event manually"
            aria-label={editing ? 'Stop editing' : 'Edit event'}
            aria-pressed={editing}
            data-testid="trp-event-pencil"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M14.5 5.5l4 4L8 20H4v-4z" />
              <path d="M12.5 7.5l4 4" />
            </svg>
          </button>
          <button type="button" className="trp-close" onClick={onClose} aria-label="Close inspector" data-testid="trp-event-close">✕</button>
        </div>
      </div>

      {editing ? (
        <>
          <FieldLabel>TITLE</FieldLabel>
          <DraftTextInput
            className="trp-input"
            value={event.name}
            onLive={(name) => onLocalMutate('event', { ...event, name })}
            onCommit={(name) => save({ ...event, name: name.trim() || event.name })}
            aria-label="Event title"
            data-testid="trp-event-title-input"
          />
          <div className="trp-row">
            <div className="trp-col trp-col--narrow">
              <FieldLabel>CHAPTER</FieldLabel>
              <DraftNumberInput
                className="trp-input trp-input--mono"
                value={event.chapter ?? 0}
                validate={(n) => Number.isInteger(n) && n >= 0}
                onCommit={(n) => save({ ...event, chapter: n >= 1 ? n : undefined })}
                aria-label="Event chapter"
                data-testid="trp-event-chapter"
              />
            </div>
            <div className="trp-col">
              <FieldLabel title="Opens the exact-time picker — year, month, day, hour">DATE / TIME</FieldLabel>
              <button
                type="button"
                className="trp-exact trp-exact--field"
                onClick={onOpenExactTime}
                title="Set the exact time — year, month, day and hour"
                data-testid="trp-event-datetime"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
                <span className="trp-exact-label">{whenLabel}</span>
              </button>
            </div>
          </div>
          <div className="trp-row">
            <div className="trp-col">
              <FieldLabel>LOCATION</FieldLabel>
              <DraftTextInput
                className="trp-input"
                value={event.location ?? ''}
                onCommit={(location) => save({ ...event, location: location.trim() || undefined })}
                aria-label="Event location"
                data-testid="trp-event-location"
              />
            </div>
            <div className="trp-col">
              <FieldLabel>POV</FieldLabel>
              <DraftTextInput
                className="trp-input"
                value={event.pov ?? ''}
                onCommit={(pov) => save({ ...event, pov: pov.trim() || undefined })}
                aria-label="Event point of view"
                data-testid="trp-event-pov"
              />
            </div>
          </div>
          <FieldLabel>SUMMARY</FieldLabel>
          <DraftTextInput
            multiline
            className="trp-textarea"
            value={event.summary ?? ''}
            onCommit={(summary) => save({ ...event, summary })}
            aria-label="Event summary"
            data-testid="trp-event-summary"
          />
          <FieldLabel title="Comma-separated tags, shown as chips">IMPACT</FieldLabel>
          <DraftTextInput
            className="trp-input"
            value={event.impact ?? ''}
            placeholder="War begins, The city falls…"
            onCommit={(impact) => save({ ...event, impact: impact.trim() || undefined })}
            aria-label="Event impact tags"
            data-testid="trp-event-impact"
          />
          <div className="trp-row trp-row--actions">
            <button type="button" className="trp-done" onClick={() => setEditing(false)} data-testid="trp-event-done">
              Done
            </button>
            <DeleteButton label="Delete" onClick={() => onDelete('event', event, 'Event')} testid="trp-event-delete" />
          </div>
        </>
      ) : (
        <>
          <div className="trp-static-rows" data-testid="trp-event-static">
            {event.chapter != null && (
              <div className="trp-static-row"><span>Chapter</span><span>Ch. {event.chapter}</span></div>
            )}
            <div className="trp-static-row"><span>Date</span><span>{whenLabel}</span></div>
            {event.location && (
              <div className="trp-static-row"><span>Location</span><span>{event.location}</span></div>
            )}
            {event.pov && (
              <div className="trp-static-row"><span>POV</span><span>{event.pov}</span></div>
            )}
          </div>
          {event.summary && (
            <>
              <FieldLabel>SUMMARY</FieldLabel>
              <div className="trp-summary">{event.summary}</div>
            </>
          )}
          {impactChips.length > 0 && (
            <>
              <FieldLabel>IMPACT</FieldLabel>
              <div className="trp-impact" data-testid="trp-event-impact-chips">
                {impactChips.map((chip) => (
                  <span key={chip} className="trp-impact-chip">{chip}</span>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
