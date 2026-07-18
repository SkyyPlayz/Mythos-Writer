// Beta 4 M12 — coach message model tests (§5.2).

import { describe, it, expect } from 'vitest';
import {
  COACH_CARD_MARKER,
  encodeCoachCard,
  decodeCoachCard,
  decodeCoachTurn,
  decodeCoachTurns,
  collapseCoachMessage,
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

  it('decodes turns: user, plain agent, and card agent', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const msgs = decodeCoachTurns([
      { role: 'user', text: 'Teach me pacing', at },
      { role: 'agent', text: 'Pacing is rhythm — let’s look at YOUR scene.', at },
      { role: 'agent', text: encodeCoachCard(lesson), at },
    ]);
    expect(msgs.map((m) => m.kind)).toEqual(['user', 'coach', 'lesson']);
    expect(msgs[2]).toMatchObject({ title: lesson.title, drill: lesson.drill });
  });

  it('a user turn that pastes card-marker text stays a user bubble', () => {
    const at = '2026-07-01T00:00:00.000Z';
    const msg = decodeCoachTurn({ role: 'user', text: encodeCoachCard(lesson), at });
    expect(msg.kind).toBe('user');
  });

  it('§5.6 mini view: lesson collapses to `title — text`', () => {
    expect(collapseCoachMessage({ ...lesson, at: 'x' })).toBe(`${lesson.title} — ${lesson.text}`);
    expect(collapseCoachMessage({ ...analysis, at: 'x' })).toBe(`${analysis.title} — ${analysis.takeaway}`);
    expect(collapseCoachMessage({ kind: 'coach', text: 'hi', at: 'x' })).toBe('hi');
  });
});
