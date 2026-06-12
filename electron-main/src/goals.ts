// Writing Goals & Progress Dashboard (SKY-154)
// Tracks daily word counts, configurable goals, and streaks in SQLite.
import { getDb, getProjectSetting, setProjectSetting } from './db.js';

const DEFAULT_DAILY_GOAL = 500;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Returns the date string N days before dateStr (YYYY-MM-DD), using UTC noon
// to avoid DST boundary issues.
export function daysBefore(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

export function getDailyGoal(): number {
  const raw = getProjectSetting('goals:daily_goal');
  if (!raw) return DEFAULT_DAILY_GOAL;
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 1 ? DEFAULT_DAILY_GOAL : n;
}

export function setDailyGoal(goal: number): void {
  setProjectSetting('goals:daily_goal', String(Math.max(1, Math.round(goal))));
}

// Accumulates words for a given date. Only positive deltas are stored.
export function logWords(date: string, wordsAdded: number): void {
  if (wordsAdded <= 0) return;
  getDb()
    .prepare(
      `INSERT INTO writing_log (log_date, words_added)
       VALUES (?, ?)
       ON CONFLICT (log_date) DO UPDATE SET words_added = words_added + excluded.words_added`
    )
    .run(date, wordsAdded);
}

// Sets the streak reset boundary: streak counts only days >= fromDate.
export function resetStreak(fromDate: string): void {
  setProjectSetting('goals:streak_reset_date', fromDate);
}

// Returns the number of consecutive writing days ending today (or yesterday if
// no words have been written today yet). Stops at the streak reset date if set.
export function computeStreak(today: string): number {
  const resetDate = getProjectSetting('goals:streak_reset_date');

  const rows = getDb()
    .prepare(
      `SELECT log_date FROM writing_log WHERE words_added >= 1 ORDER BY log_date DESC`
    )
    .all() as { log_date: string }[];

  if (rows.length === 0) return 0;

  const dates = new Set(rows.map((r) => r.log_date));

  // If today has no words yet, start counting from yesterday.
  let current = dates.has(today) ? today : daysBefore(today, 1);

  let streak = 0;
  while (true) {
    if (resetDate && current < resetDate) break;
    if (!dates.has(current)) break;
    streak++;
    current = daysBefore(current, 1);
  }

  return streak;
}

export interface HeatmapEntry {
  date: string;
  words: number;
}

export interface WritingStats {
  todayWords: number;
  weekWords: number;
  dailyGoal: number;
  streakDays: number;
  heatmap: HeatmapEntry[];
}

// Returns all stats needed by the Progress Dashboard for a given today string.
export function getWritingStats(today: string): WritingStats {
  const thirtyDaysAgo = daysBefore(today, 29);

  const rows = getDb()
    .prepare(
      `SELECT log_date, words_added
         FROM writing_log
        WHERE log_date >= ?
        ORDER BY log_date ASC`
    )
    .all(thirtyDaysAgo) as { log_date: string; words_added: number }[];

  const dayMap = new Map<string, number>();
  for (const row of rows) {
    dayMap.set(row.log_date, row.words_added);
  }

  const todayWords = dayMap.get(today) ?? 0;

  let weekWords = 0;
  for (let i = 0; i < 7; i++) {
    weekWords += dayMap.get(daysBefore(today, i)) ?? 0;
  }

  const heatmap: HeatmapEntry[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = daysBefore(today, i);
    heatmap.push({ date: d, words: dayMap.get(d) ?? 0 });
  }

  return {
    todayWords,
    weekWords,
    dailyGoal: getDailyGoal(),
    streakDays: computeStreak(today),
    heatmap,
  };
}
