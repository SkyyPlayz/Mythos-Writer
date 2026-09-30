// Beta 4 M12 — Coach conversation message model (§5.2).
//
// The Coach page feed and the right-panel Coach chat render ONE conversation:
// the shared `coach` agent-session store (vault files, M5 format). A session
// turn's text is either plain prose (user / coach bubbles) or a structured
// card — lesson cards (§5.2) and analysis cards (§5.4, M13) — encoded as a
// marker line + JSON payload so the card survives the markdown session file
// round-trip losslessly.
//
// The marker is an HTML comment: invisible when the session file is read in
// Obsidian, and safely distinct from the turn fence markers used by
// electron-main/src/mythosFormat/agentSessions.ts (`mythos:turn` open /
// `/mythos:turn` close).

export const COACH_CARD_MARKER = '<!-- mythos:coach-card v1 -->';

/** Leading HTML-comment prefix used by coach-card markers (with or without `v1`). */
const COACH_CARD_MARKER_PREFIX = '<!-- mythos:coach-card';

export interface CoachLessonCard {
  kind: 'lesson';
  /** e.g. `Lesson — Show, don't tell (using YOUR scene)` */
  title: string;
  /** Paragraph quoting the user's own prose. */
  text: string;
  /** `→` bullet points. */
  points: string[];
  /** Yellow clock-icon drill footer, e.g. `Drill: … 5 minutes.` */
  drill?: string;
}

export interface CoachAnalysisCard {
  kind: 'analysis';
  /** e.g. `Full Scene Analysis — Sc. 2 · Into the Undercity` */
  title: string;
  /** COMPUTED · LOCAL · FREE rows — [label, value] pairs. */
  computed: Array<[string, string]>;
  /** COACH'S READ · AI rows — [label, teaching clause] pairs. */
  read: Array<[string, string]>;
  /**
   * M13: honest state note for the AI section — set when the coach's read is
   * unavailable (AI disabled/unconfigured/errored) so the computed section can
   * still render alone (§5.4 split).
   */
  readNote?: string;
  takeaway: string;
  drill?: string;
}

export type CoachCard = CoachLessonCard | CoachAnalysisCard;

/**
 * `trusted` — structural `cardKind` from a trusted writer (Full Analysis).
 * Only trusted analysis cards may show COMPUTED · LOCAL · FREE chrome.
 * Legacy main-format decode (coach sessions, no cardKind) stays untrusted.
 */
export type CoachMessage =
  | { kind: 'user'; text: string; at: string }
  | { kind: 'coach'; text: string; at: string }
  | (CoachLessonCard & { at: string; trusted: boolean })
  | (CoachAnalysisCard & { at: string; trusted: boolean });

export interface DecodeCoachTurnOpts {
  /**
   * Session agent that owns the turn. Main-format (no `cardKind`) coach-card
   * decode is allowed **only** for legacy `coach` sessions whose payload kind
   * is `analysis` (what main `3ec964a1` wrote). Never brainstorm; never lesson
   * without structural cardKind; never `cardKind: 'action'`.
   */
  sessionAgent?: string;
}

/** Encode a structured card as session-turn text. */
export function encodeCoachCard(card: CoachCard): string {
  return `${COACH_CARD_MARKER}\n${JSON.stringify(card)}`;
}

/**
 * HARD 1(c)(i) — neutralize a leading coach-card marker in model/agent text
 * before persist and before render so it cannot decode as a card.
 * Breaks the HTML-comment open (`<!--` → `<!-`), matching Shield fence style.
 */
export function neutralizeLeadingCoachCardMarker(text: string): string {
  const lead = text.match(/^\s*/)?.[0] ?? '';
  const rest = text.slice(lead.length);
  if (!rest.startsWith(COACH_CARD_MARKER_PREFIX)) return text;
  return `${lead}${rest.replace('<!--', '<!-')}`;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isPairArray(v: unknown): v is Array<[string, string]> {
  return (
    Array.isArray(v) &&
    v.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string')
  );
}

/**
 * Parse card payload JSON (guarded). Returns null on malformed / unexpected
 * shapes — callers must render as plain text when null.
 */
export function decodeCoachCard(text: string): CoachCard | null {
  if (!text.startsWith(COACH_CARD_MARKER)) return null;
  const payload = text.slice(COACH_CARD_MARKER.length).trim();
  try {
    const raw: unknown = JSON.parse(payload);
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (obj.kind === 'lesson' && typeof obj.title === 'string' && typeof obj.text === 'string') {
      return {
        kind: 'lesson',
        title: obj.title,
        text: obj.text,
        points: isStringArray(obj.points) ? obj.points : [],
        ...(typeof obj.drill === 'string' && obj.drill ? { drill: obj.drill } : {}),
      };
    }
    if (obj.kind === 'analysis' && typeof obj.title === 'string' && typeof obj.takeaway === 'string') {
      return {
        kind: 'analysis',
        title: obj.title,
        computed: isPairArray(obj.computed) ? obj.computed : [],
        read: isPairArray(obj.read) ? obj.read : [],
        ...(typeof obj.readNote === 'string' && obj.readNote ? { readNote: obj.readNote } : {}),
        takeaway: obj.takeaway,
        ...(typeof obj.drill === 'string' && obj.drill ? { drill: obj.drill } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decode one stored session turn into a renderable coach message.
 *
 * - Structural `cardKind` (lesson/analysis) from a trusted writer → full card
 *   with `trusted: true` (COMPUTED · LOCAL · FREE chrome allowed).
 * - `cardKind: 'action'` (incl. Beta Read feedback with a marker) → plain coach.
 * - Main-format turns (no `cardKind`): decode **only** when `sessionAgent` is
 *   legacy `coach` AND payload kind is `analysis` → read-only, `trusted: false`.
 * - User turns (incl. pasted/forged markers) stay user bubbles.
 * - Forged model markers in brainstorm / partner sessions stay plain text.
 */
export function decodeCoachTurn(turn: AgentSessionTurn, opts?: DecodeCoachTurnOpts): CoachMessage {
  if (turn.role === 'user') return { kind: 'user', text: turn.text, at: turn.at };
  // Shield fix 2 — action turns never decode marker+JSON as analysis/lesson cards.
  if (turn.cardKind === 'action') {
    return { kind: 'coach', text: turn.text, at: turn.at };
  }
  if (turn.cardKind === 'analysis' || turn.cardKind === 'lesson') {
    const card = decodeCoachCard(turn.text);
    // D9 — cardKind / payload kind mismatch → plain text (pinned by unit test).
    if (card && card.kind === turn.cardKind) return { ...card, at: turn.at, trusted: true };
    return { kind: 'coach', text: turn.text, at: turn.at };
  }
  // Shield fix 2 — no-cardKind decode: legacy coach + analysis payload only.
  if (opts?.sessionAgent === 'coach' && turn.cardKind === undefined) {
    const mainFormat = decodeCoachCard(turn.text);
    if (mainFormat?.kind === 'analysis') {
      return { ...mainFormat, at: turn.at, trusted: false };
    }
  }
  return { kind: 'coach', text: turn.text, at: turn.at };
}

/** Decode a whole session into the feed's message list. */
export function decodeCoachTurns(
  turns: readonly AgentSessionTurn[],
  opts?: DecodeCoachTurnOpts,
): CoachMessage[] {
  return turns.map((t) => decodeCoachTurn(t, opts));
}

/**
 * §5.6 mini-view collapse: in the right-panel chat, lesson (and analysis)
 * card messages collapse to a compact `title — text` line.
 */
export function collapseCoachMessage(msg: CoachMessage): string {
  if (msg.kind === 'lesson') return `${msg.title} — ${msg.text}`;
  if (msg.kind === 'analysis') {
    const tail = msg.takeaway || msg.readNote;
    return tail ? `${msg.title} — ${tail}` : msg.title;
  }
  return msg.text;
}

/**
 * Body text under a display-card title — never re-prints the title.
 */
export function displayCardBodyText(card: CoachCard): string {
  if (card.kind === 'lesson') return card.text;
  return card.takeaway || card.readNote || '';
}

/**
 * Critic N2 — text sent to the model / shown in mini-card bodies.
 * Never forward raw `<!-- mythos:coach-card … -->` JSON payloads.
 */
export function historyContentForModel(turn: AgentSessionTurn, opts?: DecodeCoachTurnOpts): string {
  if (turn.role === 'user') return turn.text;
  if (turn.cardKind === 'analysis' || turn.cardKind === 'lesson') {
    return collapseCoachMessage(decodeCoachTurn(turn, opts));
  }
  if (turn.cardKind === 'action' && turn.cardTitle) {
    const foot = turn.cardFoot ? `\n${turn.cardFoot}` : '';
    return `${turn.cardTitle} — ${turn.text}${foot}`;
  }
  // Legacy coach + analysis only — never collapse lesson / action / brainstorm.
  if (opts?.sessionAgent === 'coach' && turn.cardKind === undefined) {
    const card = decodeCoachCard(turn.text);
    if (card?.kind === 'analysis') {
      return collapseCoachMessage({ ...card, at: turn.at, trusted: false });
    }
  }
  return turn.text;
}

/** Mini-chat card body: human summary, never raw encoded JSON. */
export function miniCardBodyText(turn: AgentSessionTurn, opts?: DecodeCoachTurnOpts): string {
  // Shield fix 2 — action turns always plain (Beta Read feedback with marker stays text).
  if (turn.cardKind === 'action') return turn.text;
  if (turn.cardKind === 'analysis' || turn.cardKind === 'lesson') {
    return collapseCoachMessage(decodeCoachTurn(turn, opts));
  }
  // Main-format: legacy coach + analysis payload only.
  if (opts?.sessionAgent === 'coach' && turn.cardKind === undefined) {
    const mainFormat = decodeCoachCard(turn.text);
    if (mainFormat?.kind === 'analysis') return displayCardBodyText(mainFormat);
  }
  return turn.text;
}

/**
 * Main-format coach-card body with no structural `cardKind`.
 * Read-only display — legacy `coach` + analysis payload only (Shield fix 2).
 */
export function mainFormatCoachDisplayCard(
  turn: AgentSessionTurn,
  sessionAgent?: string,
): CoachCard | null {
  if (sessionAgent !== 'coach') return null;
  if (turn.role === 'user') return null;
  if (turn.cardKind !== undefined) return null;
  const card = decodeCoachCard(turn.text);
  if (card?.kind !== 'analysis') return null;
  return card;
}
