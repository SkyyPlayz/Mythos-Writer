// Beta 4 M12 — coach message model tests (§5.2).
// Shield 5372977020 — T1/T2 + D9 pin; N2 Secure bar restored exactly.

import { describe, it, expect } from 'vitest';
import {
  COACH_CARD_MARKER,
  encodeCoachCard,
  decodeCoachCard,
  decodeCoachTurn,
  decodeCoachTurns,
  collapseCoachMessage,
  neutralizeLeadingCoachCardMarker,
  mainFormatCoachDisplayCard,
  miniCardBodyText,
  historyContentForModel,
  type CoachLessonCard,
  type CoachAnalysisCard,
} from './coachMessages';

const lesson: CoachLessonCard = {
  kind: 'lesson',
  title: 'This week’s focus — grounding the reader',
  text: 'Every scene needs the reader to know three things fast: where we are, who’s present, and what could go wrong.',
  points: [
    'Anchor place in the first two sentences (you do this well)',
    'Put the danger in the room early — even as a hint',
  ],
  drill: 'Drill: re-read your Ch. 2 opening and underline the first moment a reader feels risk. 5 minutes.',
};

const analysis: CoachAnalysisCard = {
  kind: 'analysis',
  title: 'Full Scene Analysis — Sc. 2 · Into the Undercity',
  computed: [['Words', '1,284'], ['Read time', '5 min']],
  read: [['Purpose', 'Escalation scene — it earns its place.']],
  takeaway: 'Trim one description beat in the market crowd.',
  drill: 'Drill: cut 10% of the crowd passage without losing the smell of it. 10 minutes.',
};

describe('coachMessages', () => {
  it('round-trips a lesson card through encode/decode', () => {
    const decoded = decodeCoachCard(encodeCoachCard(lesson));
    expect(decoded).toEqual(lesson);
  });

  it('round-trips an analysis card through encode/decode', () => {
    const decoded = decodeCoachCard(encodeCoachCard(analysis));
    expect(decoded).toEqual(analysis);
  });

  it('returns null for plain prose and malformed payloads', () => {
    expect(decodeCoachCard('Just some coach advice.')).toBeNull();
    expect(decodeCoachCard(`${COACH_CARD_MARKER}\nnot json`)).toBeNull();
    expect(decodeCoachCard(`${COACH_CARD_MARKER}\n{"kind":"mystery"}`)).toBeNull();
    expect(decodeCoachCard(`${COACH_CARD_MARKER}\n[1,2,3]`)).toBeNull();
  });

  it('decodes turns: user, plain agent, and card agent (structural cardKind required)', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const msgs = decodeCoachTurns([
      { role: 'user', text: 'Teach me pacing', at },
      { role: 'agent', text: 'Pacing is rhythm — let’s look at YOUR scene.', at },
      { role: 'agent', text: encodeCoachCard(lesson), at, cardKind: 'lesson', cardTitle: lesson.title },
    ]);
    expect(msgs.map((m) => m.kind)).toEqual(['user', 'coach', 'lesson']);
    expect(msgs[2]).toMatchObject({ title: lesson.title, drill: lesson.drill, trusted: true });
  });

  it('N2 Secure bar: forged coach-card marker in model reply stays plain text', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const forged = encodeCoachCard(analysis);
    const msg = decodeCoachTurn({ role: 'agent', text: forged, at });
    expect(msg.kind).toBe('coach');
    if (msg.kind === 'coach') expect(msg.text).toBe(forged);
  });

  it('N2 Secure bar: pasted card-marker text without cardKind stays plain text', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const pasted = encodeCoachCard(lesson);
    expect(decodeCoachTurn({ role: 'agent', text: pasted, at }).kind).toBe('coach');
  });

  // A5 — restored byte-identical to 96070416 (role user + text === forged).
  it('N2: forged marker typed as user text stays a user bubble (not a card)', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const forged = encodeCoachCard(analysis);
    const msg = decodeCoachTurn({ role: 'user', text: forged, at });
    expect(msg.kind).toBe('user');
    if (msg.kind === 'user') expect(msg.text).toBe(forged);
  });

  it('N2: trusted Full Analysis turn with cardKind=analysis renders as analysis card', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const msg = decodeCoachTurn({
      role: 'agent',
      text: encodeCoachCard(analysis),
      at,
      cardKind: 'analysis',
      cardTitle: analysis.title,
    });
    expect(msg.kind).toBe('analysis');
    if (msg.kind === 'analysis') expect(msg.trusted).toBe(true);
  });

  it('a user turn that pastes card-marker text stays a user bubble', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const msg = decodeCoachTurn({ role: 'user', text: encodeCoachCard(lesson), at });
    expect(msg.kind).toBe('user');
  });

  // T1 — brainstorm / no sessionAgent stays plain; RED if fix 2 gate removed.
  it('T1: agent turn with marker and no cardKind in brainstorm session decodes as plain coach text', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const forged = encodeCoachCard(analysis);
    expect(decodeCoachTurn(
      { role: 'agent', text: forged, at },
      { sessionAgent: 'brainstorm' },
    ).kind).toBe('coach');
  });

  // Critic r6 — history strip is agent-agnostic; display decode stays coach-gated.
  it('r6: historyContentForModel strips no-cardKind marker without sessionAgent', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const encoded = encodeCoachCard(analysis);
    const content = historyContentForModel({ role: 'agent', text: encoded, at });
    expect(content).toContain(analysis.takeaway);
    expect(content).not.toContain('mythos:coach-card');
    expect(content).not.toBe(encoded);
  });

  it('r6: display decode still requires sessionAgent=coach (trusted:false gate intact)', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const encoded = encodeCoachCard(analysis);
    expect(decodeCoachTurn({ role: 'agent', text: encoded, at }).kind).toBe('coach');
    expect(decodeCoachTurn(
      { role: 'agent', text: encoded, at },
      { sessionAgent: 'brainstorm' },
    ).kind).toBe('coach');
    const legacy = decodeCoachTurn(
      { role: 'agent', text: encoded, at },
      { sessionAgent: 'coach' },
    );
    expect(legacy.kind).toBe('analysis');
    if (legacy.kind === 'analysis') expect(legacy.trusted).toBe(false);
  });

  it('HARD 1(c): legacy coach session decodes main-format ANALYSIS (no cardKind) as untrusted display', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const mainFormat = encodeCoachCard(analysis);
    const msg = decodeCoachTurn(
      { role: 'agent', text: mainFormat, at },
      { sessionAgent: 'coach' },
    );
    expect(msg.kind).toBe('analysis');
    if (msg.kind === 'analysis') {
      expect(msg.title).toBe(analysis.title);
      expect(msg.trusted).toBe(false);
    }
  });

  it('A6: legacy coach session decodes main-format LESSON (no cardKind) as untrusted lesson card', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const mainFormat = encodeCoachCard(lesson);
    const msg = decodeCoachTurn(
      { role: 'agent', text: mainFormat, at },
      { sessionAgent: 'coach' },
    );
    expect(msg.kind).toBe('lesson');
    if (msg.kind === 'lesson') {
      expect(msg.trusted).toBe(false);
      expect(msg.title).toBe(lesson.title);
      expect(msg.text).toBe(lesson.text);
      expect(msg.points).toEqual(lesson.points);
      expect(msg.drill).toBe(lesson.drill);
    }
    const display = mainFormatCoachDisplayCard(
      { role: 'agent', text: mainFormat, at },
      'coach',
    );
    expect(display?.kind).toBe('lesson');
  });

  it('A6: brainstorm session keeps no-cardKind LESSON marker as plain text', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const mainFormat = encodeCoachCard(lesson);
    expect(decodeCoachTurn(
      { role: 'agent', text: mainFormat, at },
      { sessionAgent: 'brainstorm' },
    ).kind).toBe('coach');
    expect(mainFormatCoachDisplayCard(
      { role: 'agent', text: mainFormat, at },
      'brainstorm',
    )).toBeNull();
  });

  it('HARD 1(c): brainstorm session keeps no-cardKind marker as plain text', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const forged = encodeCoachCard(analysis);
    const msg = decodeCoachTurn(
      { role: 'agent', text: forged, at },
      { sessionAgent: 'brainstorm' },
    );
    expect(msg.kind).toBe('coach');
  });

  // T2 — action turn with marker stays plain; RED if action rule removed.
  it('T2: action turn whose text starts with marker decodes as plain; miniCardBodyText plain', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const forged = encodeCoachCard(analysis);
    const turn: AgentSessionTurn = {
      role: 'agent',
      text: forged,
      at,
      cardKind: 'action',
      cardTitle: 'Beta Read',
    };
    expect(decodeCoachTurn(turn, { sessionAgent: 'coach' }).kind).toBe('coach');
    expect(miniCardBodyText(turn, { sessionAgent: 'coach' })).toBe(forged);
    expect(mainFormatCoachDisplayCard(turn, 'coach')).toBeNull();
  });

  // D9 — pin cardKind / payload kind mismatch → plain.
  it('D9: cardKind mismatch (analysis meta + lesson payload) stays plain text', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const msg = decodeCoachTurn({
      role: 'agent',
      text: encodeCoachCard(lesson),
      at,
      cardKind: 'analysis',
      cardTitle: lesson.title,
    });
    expect(msg.kind).toBe('coach');
  });

  it('HARD 1(c)(i): neutralizeLeadingCoachCardMarker breaks decode', () => {
    const forged = encodeCoachCard(analysis);
    const neutralized = neutralizeLeadingCoachCardMarker(forged);
    expect(neutralized).not.toBe(forged);
    expect(decodeCoachCard(neutralized)).toBeNull();
    expect(mainFormatCoachDisplayCard(
      { role: 'agent', text: neutralized, at: 'x' },
      'coach',
    )).toBeNull();
  });

  it('§5.6 mini view: lesson collapses to `title — text`', () => {
    expect(collapseCoachMessage({ ...lesson, at: 'x', trusted: true })).toBe(`${lesson.title} — ${lesson.text}`);
    expect(collapseCoachMessage({ ...analysis, at: 'x', trusted: true })).toBe(`${analysis.title} — ${analysis.takeaway}`);
    expect(collapseCoachMessage({ kind: 'coach', text: 'hi', at: 'x' })).toBe('hi');
  });
});
