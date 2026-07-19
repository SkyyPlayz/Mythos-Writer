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

export type CoachMessage =
  | { kind: 'user'; text: string; at: string }
  | { kind: 'coach'; text: string; at: string }
  | (CoachLessonCard & { at: string })
  | (CoachAnalysisCard & { at: string });

/** Encode a structured card as session-turn text. */
export function encodeCoachCard(card: CoachCard): string {
  return `${COACH_CARD_MARKER}\n${JSON.stringify(card)}`;
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

/** Parse card text back into a structured card; null when not a card / malformed. */
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

/** Decode one stored session turn into a renderable coach message. */
export function decodeCoachTurn(turn: AgentSessionTurn): CoachMessage {
  if (turn.role === 'user') return { kind: 'user', text: turn.text, at: turn.at };
  const card = decodeCoachCard(turn.text);
  if (card) return { ...card, at: turn.at };
  return { kind: 'coach', text: turn.text, at: turn.at };
}

/** Decode a whole session into the feed's message list. */
export function decodeCoachTurns(turns: readonly AgentSessionTurn[]): CoachMessage[] {
  return turns.map(decodeCoachTurn);
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
