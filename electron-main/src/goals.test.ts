// Unit tests for writing goals: streak calculation and heatmap data aggregation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb, closeDb } from './db.js';
import {
  getDailyGoal,
  setDailyGoal,
  logWords,
  resetStreak,
  computeStreak,
  getWritingStats,
  daysBefore,
} from './goals.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-goals-'));
  openDb(tmpDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('daysBefore', () => {
  it('returns the same date when n=0', () => {
    expect(daysBefore('2026-01-10', 0)).toBe('2026-01-10');
  });

  it('crosses month boundary correctly', () => {
    expect(daysBefore('2026-01-10', 10)).toBe('2025-12-31');
  });

  it('crosses year boundary correctly', () => {
    expect(daysBefore('2026-01-10', 29)).toBe('2025-12-12');
  });

  it('handles leap year February', () => {
    expect(daysBefore('2024-03-01', 1)).toBe('2024-02-29');
  });
});

describe('getDailyGoal / setDailyGoal', () => {
  it('returns default 500 when no goal set', () => {
    expect(getDailyGoal()).toBe(500);
  });

  it('persists custom goal', () => {
    setDailyGoal(750);
    expect(getDailyGoal()).toBe(750);
  });

  it('rounds fractional input', () => {
    setDailyGoal(499.9);
    expect(getDailyGoal()).toBe(500);
  });

  it('clamps goal to minimum 1', () => {
    setDailyGoal(0);
    expect(getDailyGoal()).toBe(1);
  });

  it('clamps negative goal to minimum 1', () => {
    setDailyGoal(-100);
    expect(getDailyGoal()).toBe(1);
  });
});

describe('logWords', () => {
  it('accumulates multiple writes for the same date', () => {
    logWords('2026-01-01', 100);
    logWords('2026-01-01', 200);
    const stats = getWritingStats('2026-01-01');
    expect(stats.todayWords).toBe(300);
  });

  it('ignores zero word counts', () => {
    logWords('2026-01-01', 0);
    const stats = getWritingStats('2026-01-01');
    expect(stats.todayWords).toBe(0);
  });

  it('ignores negative word counts', () => {
    logWords('2026-01-01', -50);
    const stats = getWritingStats('2026-01-01');
    expect(stats.todayWords).toBe(0);
  });
});

describe('computeStreak', () => {
  it('returns 0 with no writing data', () => {
    expect(computeStreak('2026-01-10')).toBe(0);
  });

  it('counts today as streak day 1 when today has words', () => {
    logWords('2026-01-10', 500);
    expect(computeStreak('2026-01-10')).toBe(1);
  });

  it('counts consecutive days including today', () => {
    logWords('2026-01-08', 100);
    logWords('2026-01-09', 200);
    logWords('2026-01-10', 300);
    expect(computeStreak('2026-01-10')).toBe(3);
  });

  it('counts consecutive days from yesterday when today has no words yet', () => {
    logWords('2026-01-07', 100);
    logWords('2026-01-08', 100);
    logWords('2026-01-09', 100);
    expect(computeStreak('2026-01-10')).toBe(3);
  });

  it('breaks on a missing day in the middle', () => {
    logWords('2026-01-07', 100);
    logWords('2026-01-09', 100);
    logWords('2026-01-10', 100);
    expect(computeStreak('2026-01-10')).toBe(2);
  });

  it('returns 0 when most recent written day was more than 1 day ago', () => {
    logWords('2026-01-07', 100);
    expect(computeStreak('2026-01-10')).toBe(0);
  });

  it('resets streak to count only from reset date onwards', () => {
    logWords('2026-01-07', 100);
    logWords('2026-01-08', 100);
    logWords('2026-01-09', 100);
    logWords('2026-01-10', 100);
    resetStreak('2026-01-10');
    expect(computeStreak('2026-01-10')).toBe(1);
  });

  it('returns 0 after reset when no words written since reset date', () => {
    logWords('2026-01-08', 100);
    logWords('2026-01-09', 100);
    resetStreak('2026-01-11');
    expect(computeStreak('2026-01-10')).toBe(0);
  });
});

describe('getWritingStats', () => {
  it('returns zeroes for empty vault', () => {
    const stats = getWritingStats('2026-01-10');
    expect(stats.todayWords).toBe(0);
    expect(stats.weekWords).toBe(0);
    expect(stats.streakDays).toBe(0);
    expect(stats.heatmap).toHaveLength(30);
    expect(stats.heatmap.every((h) => h.words === 0)).toBe(true);
  });

  it('returns todayWords correctly', () => {
    logWords('2026-01-10', 350);
    const stats = getWritingStats('2026-01-10');
    expect(stats.todayWords).toBe(350);
  });

  it('returns weekWords as sum of last 7 days (today + 6 prior)', () => {
    logWords('2026-01-04', 100);
    logWords('2026-01-05', 200);
    logWords('2026-01-08', 150);
    logWords('2026-01-10', 300);
    const stats = getWritingStats('2026-01-10');
    expect(stats.weekWords).toBe(750);
  });

  it('does not include days older than 7 in weekWords', () => {
    logWords('2026-01-03', 999);
    logWords('2026-01-04', 100);
    logWords('2026-01-10', 50);
    const stats = getWritingStats('2026-01-10');
    expect(stats.weekWords).toBe(150);
  });

  it('heatmap has exactly 30 entries in ascending date order', () => {
    const stats = getWritingStats('2026-01-10');
    expect(stats.heatmap).toHaveLength(30);
    expect(stats.heatmap[0].date).toBe('2025-12-12');
    expect(stats.heatmap[29].date).toBe('2026-01-10');
  });

  it('heatmap entries reflect logged words', () => {
    logWords('2026-01-05', 400);
    logWords('2026-01-10', 700);
    const stats = getWritingStats('2026-01-10');
    const jan5 = stats.heatmap.find((h) => h.date === '2026-01-05');
    const jan10 = stats.heatmap.find((h) => h.date === '2026-01-10');
    expect(jan5?.words).toBe(400);
    expect(jan10?.words).toBe(700);
  });

  it('dailyGoal reflects the stored goal', () => {
    setDailyGoal(800);
    const stats = getWritingStats('2026-01-10');
    expect(stats.dailyGoal).toBe(800);
  });

  it('streakDays propagates from computeStreak', () => {
    logWords('2026-01-09', 100);
    logWords('2026-01-10', 100);
    const stats = getWritingStats('2026-01-10');
    expect(stats.streakDays).toBe(2);
  });
});
