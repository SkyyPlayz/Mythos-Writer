// Prism (#1764) — sidebar Analytics checklist.
//
// Lists what the manuscript editor's Prism layer found in the open scene,
// grouped by check, with the book's per-check switches beside each row. The
// counts and items come from the live snapshot PrismExtension publishes; the
// switches write through the per-book settings store (`<story>/prism.json`).
//
// Rule checks only: nothing here reads the AI switch, calls a model or edits
// prose. "Go to" just selects the passage in the editor; the writer does the
// rewriting.

import { useId, useState } from 'react';
import type { Chapter, Story } from '../../types';
import { usePrismBook, usePrismLive } from '../../prism/usePrism';
import type { PrismLiveFinding, PrismLiveSnapshot } from '../../prism/store';
import type { PrismSettingsPatch } from '../../prism/settings';
import {
  PRISM_CHECKS,
  type PrismCheckDef,
  type PrismCheckId,
  type PrismSettings,
  type PrismStats,
} from '../../prism/types';
import './PrismChecklist.css';

/** Items shown per check before the "+N more" note. */
const MAX_VISIBLE_ITEMS = 50;

const FLAG_CHECKS = PRISM_CHECKS.filter((c) => c.kind === 'flag');
const TINT_CHECKS = PRISM_CHECKS.filter((c) => c.kind === 'tint');

interface Props {
  story: Story | null;
  sceneId: string | null;
}

function formatStats(stats: PrismStats): string {
  const parts = [
    `${stats.words.toLocaleString()} ${stats.words === 1 ? 'word' : 'words'}`,
    `${stats.avgSentenceWords.toLocaleString(undefined, { maximumFractionDigits: 1 })} words per sentence`,
  ];
  if (stats.readingEase !== null) parts.push(`Reading ease ${stats.readingEase}`);
  return parts.join(' · ');
}

/** Whether `sceneId` is one of `story`'s scenes (flat chapters or Part-grouped). */
function storyHasScene(story: Story, sceneId: string): boolean {
  const inChapters = (chapters: readonly Chapter[]) =>
    chapters.some((ch) => ch.scenes.some((sc) => sc.id === sceneId));
  return inChapters(story.chapters) || (story.parts ?? []).some((part) => inChapters(part.chapters));
}

function groupByCheck(findings: readonly PrismLiveFinding[]): Map<PrismCheckId, PrismLiveFinding[]> {
  const out = new Map<PrismCheckId, PrismLiveFinding[]>();
  for (const f of findings) {
    const list = out.get(f.checkId);
    if (list) list.push(f);
    else out.set(f.checkId, [f]);
  }
  return out;
}

export default function PrismChecklist({ story, sceneId }: Props) {
  const [settings, update] = usePrismBook(story);
  const live = usePrismLive(story ? sceneId : null);
  // A snapshot from another book (the shell can keep the previous book's scene
  // selected after a book switch) must not show here: its counts and "Go to"
  // targets belong to that book while these switches write to this one. A
  // snapshot with no book id (legacy/imported scenes leave Scene.storyId
  // unset) counts as this book's only when the scene is one of its scenes.
  const snapshot =
    live &&
    story &&
    (live.storyId === story.id || (live.storyId == null && storyHasScene(story, live.sceneId)))
      ? live
      : null;
  const baseId = useId();

  return (
    <div className="prism-checklist" data-testid="prism-checklist">
      <div className="prism-cl-head">
        <h3 className="prism-cl-title">Prism</h3>
        <p className="prism-cl-helper">Rule checks · works with AI off</p>
      </div>
      {story ? (
        <PrismBookChecks baseId={baseId} settings={settings} update={update} snapshot={snapshot} />
      ) : (
        <p className="prism-cl-empty">Open a book to use Prism.</p>
      )}
    </div>
  );
}

function PrismBookChecks({
  baseId,
  settings,
  update,
  snapshot,
}: {
  baseId: string;
  settings: PrismSettings;
  update: (patch: PrismSettingsPatch) => void;
  snapshot: PrismLiveSnapshot | null;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<PrismCheckId>>(() => new Set());
  const byCheck = groupByCheck(snapshot?.findings ?? []);
  const flaggedCount = FLAG_CHECKS.reduce(
    (n, c) => n + (settings.checks[c.id] ? (byCheck.get(c.id)?.length ?? 0) : 0),
    0
  );

  const toggleExpanded = (id: PrismCheckId) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowProps = (def: PrismCheckDef) => ({
    def,
    idBase: `${baseId}-${def.id}`,
    enabled: settings.checks[def.id],
    findings: snapshot ? (byCheck.get(def.id) ?? []) : null,
    onToggle: (on: boolean) => update({ checks: { [def.id]: on } }),
  });

  return (
    <>
      <div className="prism-cl-masters">
        <label className="prism-cl-switch">
          <input
            type="checkbox"
            role="switch"
            data-testid="prism-master-flags"
            checked={settings.flags}
            onChange={(e) => update({ flags: e.target.checked })}
          />
          <span className="prism-cl-switch-label">Flags</span>
        </label>
        <label className="prism-cl-switch">
          <input
            type="checkbox"
            role="switch"
            data-testid="prism-master-prose-colors"
            checked={settings.proseColors}
            onChange={(e) => update({ proseColors: e.target.checked })}
          />
          <span className="prism-cl-switch-label">Prose colors</span>
        </label>
      </div>
      {!settings.flags && <p className="prism-cl-hint">Underlines hidden</p>}

      {snapshot ? (
        <p className="prism-cl-stats" data-testid="prism-stats">
          {formatStats(snapshot.stats)}
        </p>
      ) : (
        <p className="prism-cl-empty">Open a scene to see Prism checks.</p>
      )}

      <fieldset className="prism-cl-group">
        <legend className="prism-cl-legend">Flags</legend>
        <ul className="prism-cl-rows">
          {FLAG_CHECKS.map((def) => (
            <PrismCheckRow
              key={def.id}
              {...rowProps(def)}
              expanded={expanded.has(def.id)}
              onToggleExpanded={() => toggleExpanded(def.id)}
              reveal={snapshot?.reveal}
            />
          ))}
        </ul>
        {snapshot && flaggedCount === 0 && (
          <p className="prism-cl-empty">Nothing flagged in this scene.</p>
        )}
      </fieldset>

      <fieldset className="prism-cl-group">
        <legend className="prism-cl-legend">Voice colors</legend>
        <ul className="prism-cl-rows">
          {TINT_CHECKS.map((def) => (
            <PrismCheckRow key={def.id} {...rowProps(def)} />
          ))}
        </ul>
      </fieldset>
    </>
  );
}

function PrismCheckRow({
  def,
  idBase,
  enabled,
  findings,
  onToggle,
  expanded = false,
  onToggleExpanded,
  reveal,
}: {
  def: PrismCheckDef;
  /** Unique prefix for this row's list / count / description ids. */
  idBase: string;
  enabled: boolean;
  /** null while no scene snapshot exists. */
  findings: PrismLiveFinding[] | null;
  onToggle: (on: boolean) => void;
  expanded?: boolean;
  /** Present only for flag checks, which carry an item list. */
  onToggleExpanded?: () => void;
  reveal?: PrismLiveSnapshot['reveal'];
}) {
  const count = findings?.length ?? 0;
  const listable = Boolean(onToggleExpanded && reveal && enabled && count > 0);
  const open = listable && expanded;
  const visible = open && findings ? findings.slice(0, MAX_VISIBLE_ITEMS) : [];
  const hidden = count - MAX_VISIBLE_ITEMS;
  const listId = `${idBase}-list`;
  const countId = `${idBase}-count`;
  const descId = `${idBase}-desc`;
  // The count badge exists once a check is off or a scene snapshot exists.
  const hasCount = !enabled || findings !== null;
  const checkDescribedBy = hasCount ? `${countId} ${descId}` : descId;

  return (
    <li className="prism-cl-row">
      <div className="prism-cl-row-main">
        <label className="prism-cl-check" title={def.description}>
          <input
            type="checkbox"
            data-testid={`prism-check-toggle-${def.id}`}
            checked={enabled}
            aria-describedby={checkDescribedBy}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="prism-cl-check-label">{def.label}</span>
        </label>
        {/* Outside the label so it describes the checkbox without renaming it. */}
        <span id={descId} className="sr-only">
          {def.description}
        </span>
        {!enabled ? (
          <span
            id={countId}
            className="prism-cl-count prism-cl-count--off"
            data-testid={`prism-count-${def.id}`}
          >
            Off
          </span>
        ) : (
          findings && (
            <span
              id={countId}
              className={`prism-cl-count${count > 0 && def.kind === 'flag' ? ' prism-cl-count--hot' : ''}`}
              data-testid={`prism-count-${def.id}`}
            >
              {count}
              <span className="sr-only"> found</span>
            </span>
          )
        )}
        {listable ? (
          <button
            type="button"
            className="prism-cl-expand"
            data-testid={`prism-expand-${def.id}`}
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`${def.label} findings`}
            aria-describedby={countId}
            title={open ? 'Hide findings' : 'Show findings'}
            onClick={onToggleExpanded}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
        ) : (
          // Same width as the disclosure button so every count badge lines up.
          <span className="prism-cl-expand-slot" />
        )}
      </div>
      {listable && (
        <ul id={listId} className="prism-cl-items" hidden={!open}>
          {visible.map((f) => (
            <li key={`${f.paragraph}:${f.from}:${f.to}`} className="prism-cl-item">
              <button
                type="button"
                className="prism-cl-item-btn"
                data-testid={`prism-item-${def.id}`}
                onClick={() => reveal?.(f.docFrom, f.docTo)}
              >
                <span className="sr-only">Go to: </span>
                <span className="prism-cl-snippet">{f.snippet}</span>
              </button>
              <span className="prism-cl-item-msg">{f.message}</span>
            </li>
          ))}
          {open && hidden > 0 && <li className="prism-cl-more">+{hidden} more</li>}
        </ul>
      )}
    </li>
  );
}
