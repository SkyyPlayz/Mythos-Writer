// Beta 3 / M18 — Scene Crafter setup state + draft-board composition.
// Pure functions only — no DOM, no IPC. Values are ported from the Liquid
// Neon prototype (design-handoff/prototype):
//   crafter state shape { pov, len, status, beats, tones } . . line 3287
//   tone chips / length segment  . . . . . . . . . . . . . . . lines 4418–4419
//   beat add / remove . . . . . . . . . . . . . . . . . . . .  lines 4420, 4905
//   suggested-card search filter + grouping  . . . . . . . . . lines 4527–4529
//   draftBoard() card layout + busy delay  . . . . . . . . . . lines 3403–3423

import type { CanvasBoardData, CanvasCard, CanvasCardSeed, CanvasLink } from '../../canvas/canvasTypes';
import { avatarForTitle } from '../../canvas/canvasTypes';

// ─── Setup state ─────────────────────────────────────────────────────────────

/** Tone chips, exactly the prototype list (line 4418). */
export const CRAFTER_TONES = ['Tense', 'Quiet', 'Action', 'Mystery', 'Dread', 'Wonder'] as const;

/** Length segment options (line 4419). `Custom` is a Beta 4/M19 addition (§7.1, AC1). */
export const CRAFTER_LENGTHS = ['Short', 'Medium', 'Long', 'Custom'] as const;
export type CrafterLength = (typeof CRAFTER_LENGTHS)[number];

/**
 * Scene setup — the prototype's `crafter` state (line 3287) plus the
 * title / goal / conflict inputs from the setup form (lines 487–496).
 *
 * The prototype's `crafter.status` busy/done lifecycle is gone as of Beta
 * 4/M19: the real AI generation lifecycle lives in SceneCrafterPage's
 * `draftStreamId` / `useIpcStream` state instead (§7.1).
 */
export interface CrafterSetup {
  title: string;
  pov: string;
  goal: string;
  conflict: string;
  len: CrafterLength;
  /** Free-text length when `len === 'Custom'` (Beta 4/M19, AC1). Ignored otherwise. */
  customLen: string;
  beats: string[];
  tones: Record<string, boolean>;
  /**
   * Vault-reference columns (SKY-11072 owner ruling): note nids the writer
   * removed from a column for THIS scene. Removal never touches the note —
   * it only hides the reference here, per column so the same note can stay
   * referenced in another column.
   */
  removedRefs: Partial<Record<VaultRefColumnKey, string[]>>;
  /** Note nids added to a column via its `+` picker, beyond the vault-derived set. */
  addedRefs: Partial<Record<VaultRefColumnKey, string[]>>;
}

export function defaultCrafterSetup(): CrafterSetup {
  return {
    title: '',
    pov: '',
    goal: '',
    conflict: '',
    len: 'Medium',
    customLen: '',
    beats: [],
    tones: {},
    removedRefs: {},
    addedRefs: {},
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

/**
 * Reorder the beat at `index` by `direction` (-1 left/up, +1 right/down).
 * Out-of-range moves are a no-op (Beta 4/M19, AC1: BEATS add/drag/delete).
 */
export function moveBeat(setup: CrafterSetup, index: number, direction: -1 | 1): CrafterSetup {
  const to = index + direction;
  if (to < 0 || to >= setup.beats.length) return setup;
  const beats = setup.beats.slice();
  const [beat] = beats.splice(index, 1);
  beats.splice(to, 0, beat);
  return { ...setup, beats };
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
  /** SKY-10511: the note's hook line, computed main-side during the listing. */
  excerpt?: string;
  /** SKY-11049: vault-wide character signal (frontmatter/tag), main-side. */
  characterTag?: boolean;
  /** SKY-11212: vault-wide location signal (frontmatter/tag), main-side. */
  locationTag?: boolean;
  /** SKY-11212: vault-wide item/system signal (frontmatter/tag), main-side. */
  itemTag?: boolean;
}

export interface SuggestedCard {
  /** Card title — note basename with dashes/underscores as spaces. */
  t: string;
  /** One-line description — the note's hook line, or its vault folder when the note has no body yet. */
  d: string;
  /** Avatar initials shown in the leading chip. */
  av: string;
  /** Group heading — top-level vault folder, uppercased. */
  group: string;
  /** Vault note path without `.md` — wikilink for the kanban, `nid` on canvas. */
  nid: string;
  /** SKY-11049: vault-wide character signal, independent of `group`. */
  characterTag: boolean;
  /** SKY-11212: vault-wide location signal, independent of `group`. */
  locationTag: boolean;
  /** SKY-11212: vault-wide item/system signal, independent of `group`. */
  itemTag: boolean;
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
 * Capitalize the first letter of each word without touching the rest —
 * `chaper 1` → `Chaper 1`, `Liora Ashen` stays `Liora Ashen`, `McMillan`
 * stays `McMillan`. This is the conservative half of GAP P2 #13 (filename
 * casing); the frontmatter `title:` override half is UXDesigner-gated (see
 * SKY-6979 "Engineering dependencies to resolve") and out of scope here.
 */
function titleCaseWords(text: string): string {
  return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

/**
 * SKY-11212 (owner ruling): a note's category is its tag signal
 * (character/location/item) when it has one, regardless of which folder it
 * lives in — folder only decides the category for a note with no relevant
 * tag. A note with more than one signal resolves in this priority order;
 * that's an edge case (contradictory tags), not the common path.
 */
function tagCategory(item: VaultListItem): string | null {
  if (item.characterTag) return 'CHARACTERS';
  if (item.locationTag) return 'LOCATIONS';
  if (item.itemTag) return 'ITEMS & SYSTEMS';
  return null;
}

/**
 * Turn a notes-vault listing into suggested cards. In the prototype the list
 * is stocked by the Brainstorm Agent; here every vault markdown note becomes
 * a card. A card's group (`CHARACTERS`, `LOCATIONS`, …) is its tag signal
 * when it has one (SKY-11212), falling back to its top-level folder for
 * notes with no relevant tag — so folder-organized vaults keep working, and
 * a tagged note is never miscategorized just because of where it lives.
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
    const title = titleCaseWords(base.replace(/[-_]+/g, ' '));
    const folderGroup = top ? top.replace(/[-_]+/g, ' ').toUpperCase() : 'NOTES';
    cards.push({
      t: title,
      // SKY-10511: the hook line is the card body; folder path only for notes
      // with no usable body yet (empty note) — preserves the old look there.
      d: item.excerpt || (segments.slice(0, -1).join(' / ') || 'Vault root'),
      av: avatarForTitle(title),
      group: tagCategory(item) ?? folderGroup,
      nid: path.replace(/\.md$/i, ''),
      characterTag: item.characterTag ?? false,
      locationTag: item.locationTag ?? false,
      itemTag: item.itemTag ?? false,
    });
  }
  return cards;
}

/**
 * Cards for the CHARACTERS vault-reference column and the POV picker
 * (SKY-11072 / SKY-11049 item 7 / SKY-11212): `group` already resolved the
 * tag-priority-then-folder-fallback category in `suggestedFromVault`, so this
 * is a straight filter.
 */
export function castCardsFromSuggested(cards: SuggestedCard[]): SuggestedCard[] {
  return cards.filter((card) => card.group === 'CHARACTERS');
}

/** Cards for the LOCATIONS vault-reference column (SKY-11072 / SKY-11212). */
export function placesFromSuggested(cards: SuggestedCard[]): SuggestedCard[] {
  return cards.filter((card) => card.group === 'LOCATIONS');
}

/** Cards for the ITEMS & SYSTEMS vault-reference column (SKY-11072 / SKY-11212). */
export function itemsFromSuggested(cards: SuggestedCard[]): SuggestedCard[] {
  return cards.filter((card) => card.group === 'ITEMS & SYSTEMS');
}

// ─── Vault-reference columns (right side — SKY-11072 owner ruling) ────────────
// The prototype's `crafterVaultCols` (line 4374): three columns of removable
// per-scene references to vault notes, replacing the BEATS/CAST/PLACES kanban.
// Beats stay in the Setup form; a column's base stock is the vault itself
// (live, like the suggested rail), with per-scene add/remove layered on top.

export const VAULT_REF_COLUMN_KEYS = ['characters', 'locations', 'items'] as const;
export type VaultRefColumnKey = (typeof VAULT_REF_COLUMN_KEYS)[number];

export interface VaultRefColumn {
  key: VaultRefColumnKey;
  title: string;
  /** Sentence-case name for empty-state copy ("No Characters notes …"). */
  noun: string;
  /** Canvas color slot (canvas spec §5) — same mapping as `slotForSuggestedGroup`. */
  slot: number;
}

/** Column order, titles and slot colors exactly as the prototype's `crafterVaultCols`. */
export const VAULT_REF_COLUMNS: readonly VaultRefColumn[] = [
  { key: 'characters', title: 'CHARACTERS', noun: 'Characters', slot: 0 },
  { key: 'locations', title: 'LOCATIONS', noun: 'Locations', slot: 1 },
  { key: 'items', title: 'ITEMS & SYSTEMS', noun: 'Items & Systems', slot: 3 },
];

/** What the vault itself files under a column, before per-scene add/remove. */
function baseRefCards(key: VaultRefColumnKey, cards: SuggestedCard[]): SuggestedCard[] {
  switch (key) {
    case 'characters':
      return castCardsFromSuggested(cards);
    case 'locations':
      return placesFromSuggested(cards);
    case 'items':
      return itemsFromSuggested(cards);
  }
}

/**
 * The cards a column shows for this scene: the vault-derived base, plus notes
 * added via the column's `+` picker (in pick order, deduped against the base),
 * minus notes removed from this scene. A stale `addedRefs` nid (note renamed
 * or deleted since) silently drops out rather than rendering a dead card.
 */
export function refCardsForColumn(
  key: VaultRefColumnKey,
  cards: SuggestedCard[],
  setup: CrafterSetup,
): SuggestedCard[] {
  const base = baseRefCards(key, cards);
  const inBase = new Set(base.map((card) => card.nid));
  const byNid = new Map(cards.map((card) => [card.nid, card]));
  const added = (setup.addedRefs[key] ?? [])
    .filter((nid) => !inBase.has(nid))
    .map((nid) => byNid.get(nid))
    .filter((card): card is SuggestedCard => card !== undefined);
  const removed = new Set(setup.removedRefs[key] ?? []);
  return [...base, ...added].filter((card) => !removed.has(card.nid));
}

/**
 * Candidates for a column's `+` picker: every vault note **in that column's
 * category** (SKY-11212 — the picker must never offer notes from other
 * categories, e.g. characters in the LOCATIONS picker) not already visible in
 * the column, run through the same substring filter the suggested rail uses.
 * Removed notes ARE offered — picking one is the un-remove path.
 */
export function refPickerCards(
  key: VaultRefColumnKey,
  cards: SuggestedCard[],
  setup: CrafterSetup,
  query: string,
): SuggestedCard[] {
  const candidates = baseRefCards(key, cards);
  const visible = new Set(refCardsForColumn(key, cards, setup).map((card) => card.nid));
  return filterSuggested(candidates, query).filter((card) => !visible.has(card.nid));
}

/** Remove a note from THIS scene's column — never deletes or edits the note. */
export function removeRef(setup: CrafterSetup, key: VaultRefColumnKey, nid: string): CrafterSetup {
  const removed = setup.removedRefs[key] ?? [];
  if (removed.includes(nid)) return setup;
  return { ...setup, removedRefs: { ...setup.removedRefs, [key]: [...removed, nid] } };
}

/** Add a note to a column (also the un-remove path — clears any prior removal). */
export function addRef(setup: CrafterSetup, key: VaultRefColumnKey, nid: string): CrafterSetup {
  const removed = setup.removedRefs[key] ?? [];
  const added = setup.addedRefs[key] ?? [];
  const nextRemoved = removed.filter((value) => value !== nid);
  const nextAdded = added.includes(nid) ? added : [...added, nid];
  if (nextRemoved.length === removed.length && nextAdded === added) return setup;
  return {
    ...setup,
    removedRefs: { ...setup.removedRefs, [key]: nextRemoved },
    addedRefs: { ...setup.addedRefs, [key]: nextAdded },
  };
}

/** The lane fields the beat migration reads — matches the page's `SceneCrafterLane`. */
interface LegacyLaneLike {
  name: string;
  cards: Array<{ title: string }>;
}

/**
 * SKY-11072 instruction 3: a saved board from the retired lanes-kanban era may
 * hold beats in a lane literally named "Beats". Surface those card titles into
 * the Setup beats list so no beat data is lost; the board file on disk stays
 * untouched (B4-3 — no destructive migration).
 */
export function legacyBeatsFromLanes(lanes: LegacyLaneLike[]): string[] {
  const seen = new Set<string>();
  const beats: string[] = [];
  for (const lane of lanes) {
    if (!/^beats?$/i.test(lane.name.trim())) continue;
    for (const card of lane.cards) {
      const title = card.title.trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      beats.push(title);
    }
  }
  return beats;
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

/**
 * Canvas color slot for a suggested-card group (SKY-9878, canvas spec §5):
 * Characters = A(0), Locations = B(1), Items & Systems = D(3) — matching the
 * "Characters card and a Locations card ... carry different slot colors (A
 * and B respectively)" sample-data mapping, with Items & Systems on the
 * slot the spec's table names for that vault column. Any other/future vault
 * folder falls back to slot 4, the same default `onAddCard` uses for a blank
 * canvas card.
 */
export function slotForSuggestedGroup(group: string): number {
  switch (group) {
    case 'CHARACTERS':
      return 0;
    case 'LOCATIONS':
      return 1;
    case 'ITEMS & SYSTEMS':
      return 3;
    default:
      return 4;
  }
}

/** Canvas-card seed for a suggested card placed on the board (SKY-9878). */
export function cardSeedFromSuggested(card: SuggestedCard): CanvasCardSeed {
  return { t: card.t, d: card.d, av: card.av, c: slotForSuggestedGroup(card.group), nid: card.nid };
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
  draftCard: CanvasCard | null = null,
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
  if (draftCard) cards.push(draftCard);
  const hubId = cards[0].id;
  const links: CanvasLink[] = cards.slice(1).map((card) => [hubId, card.id]);
  return { id, name: `${title} — board ${boardNumber}`, cards, links };
}

// ─── AI first-pass draft card (Beta 4/M19, §7.1) ──────────────────────────────

/** Draft-pass card body length before truncating into the board preview. */
const DRAFT_PASS_PREVIEW_CHARS = 320;

/** Count words the same way a writer would — whitespace-delimited tokens. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Build the "— first pass" draft card placed under the hub when the writer
 * clicks **Add to scene board** (B4-9). This card carries only a preview of
 * the generated scaffold — never the manuscript itself; the writer copies
 * from here by hand (AC6, decisions log B4-9).
 */
export function composeDraftPassCard(setup: CrafterSetup, draftText: string, id: string): CanvasCard {
  const title = setup.title.trim() || 'Untitled scene';
  const trimmed = draftText.trim();
  const preview = trimmed.length > DRAFT_PASS_PREVIEW_CHARS
    ? `${trimmed.slice(0, DRAFT_PASS_PREVIEW_CHARS).trimEnd()}…`
    : trimmed;
  const words = wordCount(trimmed);
  return {
    id,
    t: `${title} — first pass`,
    d: `${preview}\n\n— ${words} word${words === 1 ? '' : 's'}`,
    av: '✎',
    c: 5,
    x: 440,
    y: 220,
    w: 320,
    h: 220,
    nid: null,
  };
}

// ─── Coach-framed generation prompt (Beta 4/M19, §7.1) ────────────────────────

/**
 * Coach-persona system prompt for the first-pass generation. Per the
 * decisions log (B4-9) the output is a planning scaffold for the scene
 * board — it never reaches the manuscript automatically, so the prompt
 * enforces that framing on the model as well as the UI enforcing it in code.
 */
export const CRAFTER_COACH_SYSTEM_PROMPT =
  "You are the Writing Coach inside Mythos Writer's Scene Crafter. Draft a " +
  "first-pass prose scaffold from the writer's beats — a rough pass they can " +
  'rewrite from, not a finished scene. After the scaffold, add a short ' +
  '"Why these choices" note explaining the choices you made (POV framing, ' +
  'pacing, what each beat is doing) so the rewrite teaches the writer ' +
  'something. Never claim this text belongs in the manuscript — it is only a ' +
  'planning aid the writer may lift from by hand.';

/** Coach-framed copy shown above the Generate button, verbatim from §7.1. */
export const CRAFTER_GENERATE_COPY =
  'Set the shape — the Writing Coach drafts a first-pass scaffold from YOUR ' +
  'beats, then annotates why it made each choice, so the rewrite teaches you.';

/** Build the user-turn message sent alongside CRAFTER_COACH_SYSTEM_PROMPT. */
export function buildDraftPrompt(setup: CrafterSetup, chosen: ChosenCard[], summary: string): string {
  const tones = CRAFTER_TONES.filter((tone) => setup.tones[tone]);
  const length = setup.len === 'Custom' ? (setup.customLen.trim() || 'Custom') : setup.len;
  const lines = [
    `Title: ${setup.title.trim() || 'Untitled scene'}`,
    setup.pov.trim() ? `POV: ${setup.pov.trim()}` : '',
    setup.goal.trim() ? `Goal: ${setup.goal.trim()}` : '',
    setup.conflict.trim() ? `Conflict: ${setup.conflict.trim()}` : '',
    setup.beats.length > 0 ? `Beats:\n${setup.beats.map((beat, i) => `${i + 1}. ${beat}`).join('\n')}` : '',
    tones.length > 0 ? `Tone: ${tones.join(', ')}` : '',
    `Length: ${length}`,
    summary.trim() ? `Quick summary: ${summary.trim()}` : '',
    chosen.length > 0
      ? `Relevant cards:\n${chosen.map((c) => `- ${c.title}${c.desc ? `: ${c.desc}` : ''}`).join('\n')}`
      : '',
  ].filter(Boolean);
  return lines.join('\n\n');
}
