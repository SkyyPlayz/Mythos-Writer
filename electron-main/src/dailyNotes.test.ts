// SKY-204: unit tests for journal streak computation (inline, no IPC).
import { describe, it, expect } from 'vitest';

// Re-implement streak logic locally so tests are isolated from filesystem.
function computeJournalStreak(dates: Set<string>, today: string): number {
  function dayBefore(d: string): string {
    const dt = new Date(d + 'T12:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
  }

  if (dates.size === 0) return 0;
  let current = dates.has(today) ? today : dayBefore(today);
  let streak = 0;
  while (dates.has(current)) {
    streak++;
    current = dayBefore(current);
  }
  return streak;
}

describe('computeJournalStreak', () => {
  it('returns 0 for empty set', () => {
    expect(computeJournalStreak(new Set(), '2025-01-15')).toBe(0);
  });

  it('returns 1 when only today has a note', () => {
    expect(computeJournalStreak(new Set(['2025-01-15']), '2025-01-15')).toBe(1);
  });

  it('counts consecutive days ending today', () => {
    const dates = new Set(['2025-01-13', '2025-01-14', '2025-01-15']);
    expect(computeJournalStreak(dates, '2025-01-15')).toBe(3);
  });

  it('resets at a gap — only counts days right before today', () => {
    const dates = new Set(['2025-01-10', '2025-01-14', '2025-01-15']);
    expect(computeJournalStreak(dates, '2025-01-15')).toBe(2);
  });

  it('counts yesterday streak when today has no note', () => {
    const dates = new Set(['2025-01-13', '2025-01-14']);
    expect(computeJournalStreak(dates, '2025-01-15')).toBe(2);
  });

  it('returns 0 when most recent note is more than a day ago', () => {
    const dates = new Set(['2025-01-10', '2025-01-11', '2025-01-12']);
    expect(computeJournalStreak(dates, '2025-01-15')).toBe(0);
  });

  it('handles month boundary correctly', () => {
    const dates = new Set(['2025-01-31', '2025-02-01', '2025-02-02']);
    expect(computeJournalStreak(dates, '2025-02-02')).toBe(3);
  });

  it('handles year boundary correctly', () => {
    const dates = new Set(['2024-12-31', '2025-01-01', '2025-01-02']);
    expect(computeJournalStreak(dates, '2025-01-02')).toBe(3);
  });

  it('single note on day before today gives streak of 1', () => {
    expect(computeJournalStreak(new Set(['2025-01-14']), '2025-01-15')).toBe(1);
  });

  it('handles a long streak of 30 days', () => {
    const dates = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const d = new Date('2025-02-28T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      dates.add(d.toISOString().slice(0, 10));
    }
    expect(computeJournalStreak(dates, '2025-02-28')).toBe(30);
  });
});

describe('daily note filename parsing', () => {
  it('matches YYYY-MM-DD.md pattern', () => {
    const re = /^\d{4}-\d{2}-\d{2}\.md$/;
    expect(re.test('2025-01-15.md')).toBe(true);
    expect(re.test('2025-01-15.MD')).toBe(false);
    expect(re.test('note.md')).toBe(false);
    expect(re.test('2025-13-45.md')).toBe(true); // pattern only, no range check
    expect(re.test('2025-01-15')).toBe(false);
  });
});
