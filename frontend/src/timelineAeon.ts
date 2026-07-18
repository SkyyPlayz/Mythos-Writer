// Beta 3 M20 — Timeline v2 (Aeon-class) pure helpers.
//
// Everything the five timeline surfaces share lives here, side-effect free:
//   - the five-mode view model (Plan vs Progress / Structure / Spreadsheet /
//     Relationships / Subway) + legacy Beta-2 mode migration,
//   - derivation of the Aeon lane-stack data (eras, book band, arcs, chapter
//     cells, key events, character journeys, world, themes, presence lines)
//     from the app's real timeline data (scenes / chapters / arcs / entities),
//   - the Subway polyline math (exact port of the prototype's `subLines`,
//     "Mythos Writer - Liquid Neon.dc.html" 4703–4709),
//   - the minimap scrubber scroll math,
//   - the Plan-vs-Progress grey filter constants (prototype 4259).

// ─── View modes ───

/** Beta 4 M23 — the prototype's seven timeline modes (`tlModeSeg`, 6559):
 *  Progress · Structure · Plotlines · Spreadsheet · Tension · Relationships ·
 *  Subway. Progress/Structure render the §8.3/§8.4 axis lane rows; Plotlines
 *  and Tension land with M24. */
export type TimelineMode =
  | 'progress' | 'structure' | 'plot' | 'spreadsheet' | 'tension' | 'relations' | 'subway';

export const VALID_TIMELINE_MODES: readonly TimelineMode[] = [
  'progress', 'structure', 'plot', 'spreadsheet', 'tension', 'relations', 'subway',
];

/** Legacy stored view modes map onto their successors: Beta-2 AEON lanes →
 *  Progress, AEON Track → Subway; the interim M22 'axis' surface folded into
 *  the Progress/Structure lanes (§8.4). */
export const LEGACY_TIMELINE_MODE_MAP: Readonly<Record<string, TimelineMode>> = {
  aeon: 'progress',
  track: 'subway',
  axis: 'progress',
};

/** Resolve a persisted view-mode string to a valid TimelineMode (or null). */
export function resolveTimelineMode(stored: string | null): TimelineMode | null {
  if (!stored) return null;
  if ((VALID_TIMELINE_MODES as readonly string[]).includes(stored)) return stored as TimelineMode;
  return LEGACY_TIMELINE_MODE_MAP[stored] ?? null;
}

// ─── Zoom ───

/** Prototype `tlZoomOpts` (4258): Year / Quarter / Month / Week / Scene. */
export type TimelineZoom = 'year' | 'quarter' | 'month' | 'week' | 'scene';

export const VALID_TIMELINE_ZOOMS: readonly TimelineZoom[] = ['year', 'quarter', 'month', 'week', 'scene'];

export const TIMELINE_ZOOM_LABELS: Readonly<Record<TimelineZoom, string>> = {
  year: 'Year', quarter: 'Quarter', month: 'Month', week: 'Week', scene: 'Scene',
};

/** Lane-canvas width multiplier per zoom level: 'year' fits the viewport,
 *  denser levels widen the canvas so the minimap scrubber has room to scrub. */
export const TIMELINE_ZOOM_FACTORS: Readonly<Record<TimelineZoom, number>> = {
  year: 1, quarter: 1.4, month: 2, week: 3, scene: 4.5,
};

// ─── Plan vs Progress grey filter (prototype 4259, exact values) ───

export const PROGRESS_GREY_FILTER = 'grayscale(.92) brightness(.82)';
export const PROGRESS_GREY_OPACITY = 0.55;

// ─── Colors ───

/** Prototype default slot hexes c1–c6 (winter set): cyan, purple, magenta,
 *  amber, teal, blue. Used as fallbacks behind the --n1..--n6 theme vars. */
export const SLOT_HEX: readonly string[] = [
  '#00f0ff', '#9b5fff', '#ff4dff', '#ff9a3d', '#2fe6c8', '#3d9bff',
];

/** Character line slot order — the prototype colors its four lines c1, c6,
 *  c5, c3 (4578/4704); continue with c2, c4 for lines five and six. */
export const CHARACTER_SLOT_ORDER: readonly number[] = [1, 6, 5, 3, 2, 4];

/** Theme pill hexes (prototype `tlThemes`, 4271). */
export const THEME_HEX: readonly string[] = ['#9b5fff', '#3d9bff', '#2fe6c8', '#ff4dff'];

/** Key-event icons (prototype `tlEvents`, 3018–3025). */
export const EVENT_ICONS: readonly string[] = ['✦', '◈', '✹', '◉', '✷', '✶'];

/** Exact port of the prototype's `hexA(hex, a)` (3305–3309): '#rrggbb' + alpha
 *  → 'rgba(r,g,b,a)' with the alpha clamped to [0,1] and fixed to 3 decimals. */
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
}

// ─── Derivation input types (renderer-side mirrors of the IPC payloads) ───

export interface AeonSceneInput {
  id: string;
  title: string;
  chapterId: string;
  /** ISO date string from chronologicalTime, '' when undated. */
  date: string;
  wordCount: number | null;
  pov: string;
  mood: string;
  arcIds: string[];
  characterIds: string[];
}

export interface AeonChapterInput {
  id: string;
  title: string;
}

export interface AeonArcInput {
  id: string;
  title: string;
  color: string;
}

/** A vault entity rendered on a lane (character / world event / theme). */
export interface AeonEntityInput {
  id: string;
  name: string;
  detail?: string;
}

export interface AeonDeriveInput {
  storyTitle: string;
  scenes: AeonSceneInput[];
  chapters: AeonChapterInput[];
  arcs: AeonArcInput[];
  characters: AeonEntityInput[];
  /** Entities of type 'event' — the WORLD lane. */
  worldEvents: AeonEntityInput[];
  /** Entities of type 'concept' — the THEMES lane. */
  concepts: AeonEntityInput[];
}

// ─── Derived data ───

export interface AeonEvent {
  sceneId: string;
  title: string;
  /** 'Ch. 3' when the scene lives in a chapter, else the date or '—'. */
  ch: string;
  chapterIndex: number;
  icon: string;
  description: string;
  written: boolean;
}

export interface AeonChapterCell {
  id: string;
  index: number;
  label: string;
  color: string;
  written: boolean;
  isHere: boolean;
}

export interface AeonEra {
  label: string;
  flex: number;
}

export interface AeonBand {
  title: string;
  sub: string;
  color: string;
  /** True when the whole band is still unwritten (greyed in progress mode). */
  unwritten: boolean;
}

export interface AeonArcSegment {
  id: string;
  title: string;
  color: string;
  flex: number;
  written: boolean;
}

export interface AeonJourney {
  id: string;
  name: string;
  sub: string;
  slot: number;
  color: string;
  written: boolean;
}

export interface AeonWorldCard {
  id: string;
  name: string;
  day: string;
  description: string;
  color: string;
}

export interface AeonThemePill {
  id: string;
  name: string;
  color: string;
}

/** One character's presence across the key events — feeds both the
 *  Relationships dots and the Subway polylines. */
export interface AeonCharacterLine {
  id: string;
  name: string;
  /** 1-based theme slot (--n{slot} CSS var). */
  slot: number;
  /** Fallback hex behind the slot var. */
  color: string;
  /** Indices into `events` where the character is present. */
  presentAt: number[];
}

export interface AeonTimelineData {
  events: AeonEvent[];
  chapters: AeonChapterCell[];
  /** Index of the last chapter containing a written scene; -1 = nothing written. */
  hereIndex: number;
  /** 'Ch 17'-style label for the "you are here" legend chip; '' when hereIndex < 0. */
  hereLabel: string;
  eras: AeonEra[];
  bands: AeonBand[];
  arcs: AeonArcSegment[];
  journeys: AeonJourney[];
  world: AeonWorldCard[];
  themes: AeonThemePill[];
  lines: AeonCharacterLine[];
}

export const EMPTY_AEON_DATA: AeonTimelineData = {
  events: [],
  chapters: [],
  hereIndex: -1,
  hereLabel: '',
  eras: [],
  bands: [],
  arcs: [],
  journeys: [],
  world: [],
  themes: [],
  lines: [],
};

const MAX_EVENTS = 6;
const MAX_JOURNEYS = 4;
const MAX_WORLD = 5;
const MAX_THEMES = 4;
const MAX_LINES = 6;

/** A scene counts as written once it has prose (same rule as the AEON lane
 *  view's written/planned card split). */
function isWritten(scene: AeonSceneInput): boolean {
  return (scene.wordCount ?? 0) > 0;
}

/** Chapter-cell fallback color: the prototype splits its 45 cells at 12/23/34
 *  into slots c2/c6/c5/c3 (4263) — the same fractions applied to any count. */
export function chapterFallbackSlot(index: number, total: number): number {
  if (total <= 0) return 2;
  const f = index / total;
  if (f < 12 / 45) return 2;
  if (f < 23 / 45) return 6;
  if (f < 34 / 45) return 5;
  return 3;
}

/** Evenly sample up to `max` indices across [0, n). */
export function sampleIndices(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (n - 1)) / (max - 1));
    if (out[out.length - 1] !== idx) out.push(idx);
  }
  return out;
}

/**
 * Derive the shared Aeon timeline data from the app's real timeline sources.
 * All five views render from the same `events` (acceptance: "all five views
 * render the same event data"); missing data degrades to empty lanes.
 */
export function deriveAeonTimeline(input: AeonDeriveInput): AeonTimelineData {
  const { storyTitle, scenes, chapters, arcs, characters, worldEvents, concepts } = input;

  const chapterIndexById = new Map<string, number>(chapters.map((c, i) => [c.id, i]));

  // Story-order sort: chapter position, then chronological date (undated last),
  // then title, so event sampling is deterministic.
  const ordered = [...scenes].sort((a, b) => {
    const ai = chapterIndexById.get(a.chapterId) ?? chapters.length;
    const bi = chapterIndexById.get(b.chapterId) ?? chapters.length;
    if (ai !== bi) return ai - bi;
    const ad = a.date || '￿';
    const bd = b.date || '￿';
    if (ad !== bd) return ad.localeCompare(bd);
    return a.title.localeCompare(b.title);
  });

  // ── "you are here": the last chapter with a written scene ──
  let hereIndex = -1;
  for (const scene of scenes) {
    if (!isWritten(scene)) continue;
    const idx = chapterIndexById.get(scene.chapterId);
    if (idx !== undefined && idx > hereIndex) hereIndex = idx;
  }
  const hereLabel = hereIndex >= 0 ? `Ch ${hereIndex + 1}` : '';

  // ── Chapter cells ──
  const writtenByChapter = new Set<string>();
  const arcCountByChapter = new Map<string, Map<string, number>>();
  for (const scene of scenes) {
    if (isWritten(scene)) writtenByChapter.add(scene.chapterId);
    for (const arcId of scene.arcIds) {
      const counts = arcCountByChapter.get(scene.chapterId) ?? new Map<string, number>();
      counts.set(arcId, (counts.get(arcId) ?? 0) + 1);
      arcCountByChapter.set(scene.chapterId, counts);
    }
  }
  const arcColorById = new Map(arcs.map(a => [a.id, a.color]));
  const chapterCells: AeonChapterCell[] = chapters.map((ch, i) => {
    let color: string | undefined;
    const counts = arcCountByChapter.get(ch.id);
    if (counts) {
      let best = -1;
      for (const [arcId, n] of counts) {
        const hex = arcColorById.get(arcId);
        if (hex && n > best) { best = n; color = hex; }
      }
    }
    return {
      id: ch.id,
      index: i,
      label: ch.title || `Chapter ${i + 1}`,
      color: color ?? SLOT_HEX[chapterFallbackSlot(i, chapters.length) - 1],
      written: writtenByChapter.has(ch.id),
      isHere: hereIndex >= 0 && i === hereIndex,
    };
  });

  // ── Key events: up to six scenes evenly sampled across story order ──
  const eventIdx = sampleIndices(ordered.length, MAX_EVENTS);
  const events: AeonEvent[] = eventIdx.map((sceneIdx, i) => {
    const scene = ordered[sceneIdx];
    const chapterIndex = chapterIndexById.get(scene.chapterId) ?? -1;
    const description = [
      scene.date,
      scene.pov ? `POV ${scene.pov}` : '',
      scene.mood,
    ].filter(Boolean).join(' · ');
    return {
      sceneId: scene.id,
      title: scene.title,
      ch: chapterIndex >= 0 ? `Ch. ${chapterIndex + 1}` : (scene.date || '—'),
      chapterIndex,
      icon: EVENT_ICONS[i % EVENT_ICONS.length],
      description,
      written: isWritten(scene),
    };
  });

  // ── Eras: dated scenes bucketed by year, flex ∝ scene count ──
  const yearCounts = new Map<string, number>();
  for (const scene of scenes) {
    if (!scene.date) continue;
    const year = scene.date.slice(0, 4);
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
  }
  const eras: AeonEra[] = [...yearCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, n]) => ({ label: year, flex: n }));

  // ── Book band: one per story (real data has no book split yet) ──
  const bands: AeonBand[] = chapters.length > 0
    ? [{
        title: (storyTitle || 'Untitled Story').toUpperCase(),
        sub: `Ch. 1–${chapters.length} · ${scenes.length} scene${scenes.length === 1 ? '' : 's'}`,
        color: SLOT_HEX[0],
        unwritten: hereIndex < 0,
      }]
    : [];

  // ── Arcs: flex ∝ scene count ──
  const arcSceneCounts = new Map<string, { total: number; written: number }>();
  for (const scene of scenes) {
    for (const arcId of scene.arcIds) {
      const entry = arcSceneCounts.get(arcId) ?? { total: 0, written: 0 };
      entry.total += 1;
      if (isWritten(scene)) entry.written += 1;
      arcSceneCounts.set(arcId, entry);
    }
  }
  const arcSegments: AeonArcSegment[] = arcs.map(a => {
    const counts = arcSceneCounts.get(a.id);
    return {
      id: a.id,
      title: a.title,
      color: a.color,
      flex: Math.max(1, counts?.total ?? 0),
      written: (counts?.written ?? 0) > 0,
    };
  });

  // ── Character presence (journeys + relationship/subway lines) ──
  const presenceCount = new Map<string, number>();
  const writtenCharacters = new Set<string>();
  for (const scene of scenes) {
    for (const charId of scene.characterIds) {
      presenceCount.set(charId, (presenceCount.get(charId) ?? 0) + 1);
      if (isWritten(scene)) writtenCharacters.add(charId);
    }
  }
  const rankedCharacters = characters
    .filter(c => (presenceCount.get(c.id) ?? 0) > 0)
    .sort((a, b) => {
      const diff = (presenceCount.get(b.id) ?? 0) - (presenceCount.get(a.id) ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });

  const journeys: AeonJourney[] = rankedCharacters.slice(0, MAX_JOURNEYS).map((c, i) => {
    const n = presenceCount.get(c.id) ?? 0;
    const slot = CHARACTER_SLOT_ORDER[i % CHARACTER_SLOT_ORDER.length];
    return {
      id: c.id,
      name: c.name,
      sub: c.detail || `${n} scene${n === 1 ? '' : 's'}`,
      slot,
      color: SLOT_HEX[slot - 1],
      written: writtenCharacters.has(c.id),
    };
  });

  const sceneById = new Map(scenes.map(s => [s.id, s]));
  const lines: AeonCharacterLine[] = rankedCharacters.slice(0, MAX_LINES)
    .map((c, i) => {
      const slot = CHARACTER_SLOT_ORDER[i % CHARACTER_SLOT_ORDER.length];
      const presentAt = events
        .map((e, idx) => (sceneById.get(e.sceneId)?.characterIds.includes(c.id) ? idx : -1))
        .filter(idx => idx >= 0);
      return { id: c.id, name: c.name, slot, color: SLOT_HEX[slot - 1], presentAt };
    })
    .filter(line => line.presentAt.length > 0);

  // ── World events + themes from vault entities ──
  const world: AeonWorldCard[] = worldEvents.slice(0, MAX_WORLD).map((e, i) => ({
    id: e.id,
    name: e.name,
    day: `Event ${i + 1}`,
    description: e.detail ?? '',
    color: SLOT_HEX[[3, 4, 2, 1, 5][i % 5] - 1],
  }));

  const themes: AeonThemePill[] = concepts.slice(0, MAX_THEMES).map((c, i) => ({
    id: c.id,
    name: c.name,
    color: THEME_HEX[i % THEME_HEX.length],
  }));

  return {
    events,
    chapters: chapterCells,
    hereIndex,
    hereLabel,
    eras,
    bands,
    arcs: arcSegments,
    journeys,
    world,
    themes,
    lines,
  };
}

// ─── Subway math (exact port of prototype `subLines`, 4703–4709) ───

export const SUBWAY_VIEWBOX_WIDTH = 960;
export const SUBWAY_VIEWBOX_HEIGHT = 240;
/** Vertical drop for events a character sits out. */
export const SUBWAY_DIP = 14;

export interface SubwayStation {
  cx: number;
  cy: number;
}

export interface SubwayLine {
  name: string;
  slot: number;
  color: string;
  path: string;
  y: number;
  stations: SubwayStation[];
}

/** X position of event `i` of `eventCount` in the 960-wide viewBox:
 *  prototype `x = 70 + i * ((900 - 100) / (cols - 1))`. */
export function subwayEventX(i: number, eventCount: number): number {
  return 70 + i * ((900 - 100) / Math.max(1, eventCount - 1));
}

/**
 * Build per-character subway polylines through the event stations. Present
 * events sit on the line's y; absent events dip 14px below (prototype 4706);
 * stations render only where the character is present.
 */
export function buildSubwayLines(
  lines: Pick<AeonCharacterLine, 'name' | 'slot' | 'color' | 'presentAt'>[],
  eventCount: number,
): SubwayLine[] {
  return lines.map((r, ri) => {
    const y = 60 + ri * 44;
    const pts = Array.from({ length: eventCount }, (_, i) => {
      const x = subwayEventX(i, eventCount);
      const on = r.presentAt.indexOf(i) > -1;
      return { x, y: on ? y : y + SUBWAY_DIP, on };
    });
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p.x + ',' + p.y).join(' ');
    return {
      name: r.name,
      slot: r.slot,
      color: r.color,
      path,
      y,
      stations: pts.filter(p => p.on).map(p => ({ cx: p.x, cy: p.y })),
    };
  });
}

// ─── Minimap scrubber math ───

export interface MinimapWindow {
  /** Fraction 0..1 of the minimap track. */
  left: number;
  /** Fraction 0..1 of the minimap track. */
  width: number;
}

/** Map the lane scroll state to the minimap viewport rectangle. When the
 *  content fits the viewport the window spans the full track. */
export function minimapWindow(
  scrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
): MinimapWindow {
  if (contentWidth <= 0 || viewportWidth <= 0 || contentWidth <= viewportWidth) {
    return { left: 0, width: 1 };
  }
  const width = Math.min(1, viewportWidth / contentWidth);
  const maxLeft = 1 - width;
  const left = Math.max(0, Math.min(maxLeft, scrollLeft / contentWidth));
  return { left, width };
}

/** Map a pointer position on the minimap track (fraction 0..1) to the lane
 *  scrollLeft that centers the viewport window under the pointer. */
export function minimapScrollLeft(
  pointerFrac: number,
  viewportWidth: number,
  contentWidth: number,
): number {
  if (contentWidth <= 0 || viewportWidth <= 0 || contentWidth <= viewportWidth) return 0;
  const width = Math.min(1, viewportWidth / contentWidth);
  const left = Math.max(0, Math.min(1 - width, pointerFrac - width / 2));
  return left * contentWidth;
}
