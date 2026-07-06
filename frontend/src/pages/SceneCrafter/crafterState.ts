// Beta 3 / M18 — Scene Crafter setup state + draft-board composition.
// Pure functions only — no DOM, no IPC. Values are ported from the Liquid
// Neon prototype (design-handoff/prototype):
//   crafter state shape { pov, len, status, beats, tones } . . line 3287
//   tone chips / length segment  . . . . . . . . . . . . . . . lines 4418–4419
//   beat add / remove . . . . . . . . . . . . . . . . . . . .  lines 4420, 4905
//   suggested-card search filter + grouping  . . . . . . . . . lines 4527–4529
//   draftBoard() card layout + busy delay  . . . . . . . . . . lines 3403–3423

import type { CanvasBoardData, CanvasCard, CanvasLink } from '../../canvas/canvasTypes';
import { avatarForTitle } from '../../canvas/canvasTypes';

// ─── Setup state ─────────────────────────────────────────────────────────────

/** Tone chips, exactly the prototype list (line 4418). */
export const CRAFTER_TONES = ['Tense', 'Quiet', 'Action', 'Mystery', 'Dread', 'Wonder'] as const;

/** Length segment options (line 4419). */
export const CRAFTER_LENGTHS = ['Short', 'Medium', 'Long'] as const;
export type CrafterLength = (typeof CRAFTER_LENGTHS)[number];

/** Draft-board lifecycle, mirroring the prototype's `crafter.status`. */
export type CrafterStatus = 'idle' | 'busy' | 'done';

/**
 * Scene setup — the prototype's `crafter` state (line 3287) plus the
 * title / goal / conflict inputs from the setup form (lines 487–496).
 */
export interface CrafterSetup {
  title: string;
  pov: string;
  goal: string;
  conflict: string;
  len: CrafterLength;
  status: CrafterStatus;
  beats: string[];
  tones: Record<string, boolean>;
}

export function defaultCrafterSetup(): CrafterSetup {
  return {
    title: '',
    pov: '',
    goal: '',
    conflict: '',
    len: 'Medium',
    status: 'idle',
    beats: [],
    tones: {},
  };
}

/** Append a trimmed beat; blank input is a no-op (prototype `addBeat`, line 4905). */
export function addBeat(setup: CrafterSetup, beat: string): CrafterSetup {
  const trimmed = beat.trim();
  if (!trimmed) return setup;
  return { ...setup, beats: [...setup.beats, trimmed] };
}

/** Remove the beat at `index` (prototype `crafterBeats[i].remove`, line 4420). */
export function removeBeat(setup: CrafterSetup, index: number): CrafterSetup {
  return { ...setup, beats: setup.beats.filter((_, i) => i !== index) };
}

/** Toggle a tone chip on/off (prototype `crafterTones[t].pick`, line 4418). */
export function toggleTone(setup: CrafterSetup, tone: string): CrafterSetup {
  return { ...setup, tones: { ...setup.tones, [tone]: !setup.tones[tone] } };
}

// ─── Suggested cards (left panel, prototype lines 355–371) ───────────────────

/** One row from the notes-vault `listNotesVault` IPC. */
export interface VaultListItem {
  path: string;
  name: string;
  isDirectory: boolean;
  modifiedAt: string;
}

export interface SuggestedCard {
  /** Card title — note basename with dashes/underscores as spaces. */
  t: string;
  /** One-line description — the vault folder the note lives in. */
  d: string;
  /** Avatar initials shown in the leading chip. */
  av: string;
  /** Group heading — top-level vault folder, uppercased. */
  group: string;
  /** Vault note path without `.md` — wikilink for the kanban, `nid` on canvas. */
  nid: string;
}

export interface SuggestedGroup {
  title: string;
  cards: SuggestedCard[];
}

/** Folders that hold Scene Crafter internals rather than suggestible notes. */
const EXCLUDED_TOP_FOLDERS = new Set(['boards', 'scenes']);

/** Normalize IPC-relative paths (Windows lists join with `\`). */
export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Turn a notes-vault listing into suggested cards. In the prototype the list
 * is stocked by the Brainstorm Agent; here every vault markdown note becomes
 * a card, grouped by its top-level folder (`CHARACTERS`, `LOCATIONS`, …).
 */
export function suggestedFromVault(items: VaultListItem[]): SuggestedCard[] {
  const cards: SuggestedCard[] = [];
  for (const item of items) {
    if (item.isDirectory) continue;
    const path = normalizeVaultPath(item.path);
    if (!/\.md$/i.test(path)) continue;
    const segments = path.split('/').filter(Boolean);
    if (segments.some((segment) => segment.startsWith('.'))) continue;
    const top = segments.length > 1 ? segments[0] : '';
    if (EXCLUDED_TOP_FOLDERS.has(top.toLowerCase())) continue;
    const base = segments[segments.length - 1].replace(/\.md$/i, '');
    const title = base.replace(/[-_]+/g, ' ');
    cards.push({
      t: title,
      d: segments.slice(0, -1).join(' / ') || 'Vault root',
      av: avatarForTitle(title),
      group: top ? top.replace(/[-_]+/g, ' ').toUpperCase() : 'NOTES',
      nid: path.replace(/\.md$/i, ''),
    });
  }
  return cards;
}

/** Prototype search filter (line 4527): substring over `"<title> <description>"`. */
export function filterSuggested(cards: SuggestedCard[], query: string): SuggestedCard[] {
  const q = query.trim().toLowerCase();
  if (!q) return cards;
  return cards.filter((card) => (card.t + ' ' + card.d).toLowerCase().includes(q));
}

/** Group cards under their headings; empty groups drop out (line 4529). */
export function groupSuggested(cards: SuggestedCard[]): SuggestedGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, SuggestedCard[]>();
  for (const card of cards) {
    let bucket = byGroup.get(card.group);
    if (!bucket) {
      bucket = [];
      byGroup.set(card.group, bucket);
      order.push(card.group);
    }
    bucket.push(card);
  }
  return order.map((title) => ({ title, cards: byGroup.get(title) as SuggestedCard[] }));
}

// ─── Plan cards (prototype `planNotes`, lines 4717–4720) ─────────────────────

export interface PlanNote {
  /** Vault note path without `.md` — doubles as the selection key and `nid`. */
  id: string;
  t: string;
  d: string;
}

/** Vault "Story Plan" notes: anything under a `Plans/` folder or named `Plan…`. */
export function planNotesFromVault(items: VaultListItem[]): PlanNote[] {
  const plans: PlanNote[] = [];
  for (const item of items) {
    if (item.isDirectory) continue;
    const path = normalizeVaultPath(item.path);
    if (!/\.md$/i.test(path)) continue;
    const segments = path.split('/').filter(Boolean);
    if (segments.some((segment) => segment.startsWith('.'))) continue;
    const base = segments[segments.length - 1].replace(/\.md$/i, '');
    const inPlansFolder = segments.length > 1 && segments[0].toLowerCase() === 'plans';
    if (!inPlansFolder && !/^plan\b/i.test(base)) continue;
    const updated = new Date(item.modifiedAt);
    plans.push({
      id: path.replace(/\.md$/i, ''),
      t: base.replace(/[-_]+/g, ' '),
      d: Number.isNaN(updated.getTime())
        ? 'Vault plan note'
        : `Updated ${updated.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    });
  }
  return plans;
}

// ─── Draft-board composition (prototype draftBoard(), lines 3403–3423) ───────

/** Busy → done delay before the board lands (`this.later(…, 1200)`, line 3423). */
export const DRAFT_BOARD_DELAY_MS = 1200;

/** `mk()` card-size defaults (line 3408). */
export const DRAFT_CARD_W = 200;
export const DRAFT_CARD_H = 86;

/** The positions draftBoard() gives its non-hub cards (lines 3410–3416). */
const CHOSEN_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [130, 80],
  [100, 260],
  [450, 280],
  [790, 80],
  [810, 260],
  [1090, 170],
];

/** Overflow layout once the prototype's six slots are used: a 3-wide grid below. */
function positionForSlot(slot: number): readonly [number, number] {
  if (slot < CHOSEN_POSITIONS.length) return CHOSEN_POSITIONS[slot];
  const overflow = slot - CHOSEN_POSITIONS.length;
  return [130 + (overflow % 3) * 330, 440 + Math.floor(overflow / 3) * 180];
}

/** A card picked for the draft board (plan note or kanban board card). */
export interface ChosenCard {
  title: string;
  desc: string;
  /** Attached vault note path, or null for free-standing text. */
  nid: string | null;
}

/** The hub card's body: beats first (as in the prototype), then setup facts. */
function setupSummary(setup: CrafterSetup): string {
  const tones = CRAFTER_TONES.filter((tone) => setup.tones[tone]);
  const goal = setup.goal.trim();
  const conflict = setup.conflict.trim();
  const lines = [
    setup.beats.join(' · '),
    goal ? `Goal: ${goal}` : '',
    conflict ? `Conflict: ${conflict}` : '',
    tones.length > 0 ? `Tone: ${tones.join(', ')} · ${setup.len}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Compose the scene setup + chosen cards into a canvas board.
 *
 * Layout mirrors the prototype's draftBoard(): a `<title> — beats` hub card at
 * (440, 40) sized 280×120 in slot 1 with the ✦ avatar (`mk(0, …)`, line 3409),
 * a POV card at the first satellite position when a POV is set (`mk(1, …)`,
 * line 3410), and the chosen cards on the remaining satellite positions. The
 * prototype's demo links are semantic; the generic composition links the hub
 * to every satellite.
 */
export function composeDraftBoard(
  setup: CrafterSetup,
  chosen: ChosenCard[],
  boardNumber: number,
  id: string = 'b' + Date.now(),
): CanvasBoardData {
  const title = setup.title.trim() || 'Untitled scene';
  const cards: CanvasCard[] = [
    {
      id: `${id}-0`,
      t: `${title} — beats`,
      d: setupSummary(setup),
      av: '✦',
      c: 1,
      x: 440,
      y: 40,
      w: 280,
      h: 120,
      nid: null,
    },
  ];
  let slot = 0;
  const pov = setup.pov.trim();
  if (pov) {
    const [x, y] = positionForSlot(slot++);
    cards.push({
      id: `${id}-pov`,
      t: pov,
      d: 'POV.',
      av: avatarForTitle(pov),
      c: 0,
      x,
      y,
      w: DRAFT_CARD_W,
      h: DRAFT_CARD_H,
      nid: null,
    });
  }
  chosen.forEach((card, i) => {
    const [x, y] = positionForSlot(slot++);
    cards.push({
      id: `${id}-c${i}`,
      t: card.title,
      d: card.desc,
      av: avatarForTitle(card.title),
      c: i % 4,
      x,
      y,
      w: DRAFT_CARD_W,
      h: DRAFT_CARD_H,
      nid: card.nid,
    });
  });
  const hubId = cards[0].id;
  const links: CanvasLink[] = cards.slice(1).map((card) => [hubId, card.id]);
  return { id, name: `${title} — board ${boardNumber}`, cards, links };
}
