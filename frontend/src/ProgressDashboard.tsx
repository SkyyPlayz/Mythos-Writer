import { useState, useEffect, useCallback } from 'react';
import type { Story } from './types';
import './ProgressDashboard.css';

interface HeatmapEntry {
  date: string;
  words: number;
}

interface GoalsStats {
  todayWords: number;
  weekWords: number;
  dailyGoal: number;
  streakDays: number;
  heatmap: HeatmapEntry[];
}

interface Props {
  stories: Story[];
}

function computeTotalWords(stories: Story[]): number {
  let total = 0;
  for (const story of stories) {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
        for (const block of scene.blocks) {
          total += block.content.trim().split(/\s+/).filter(Boolean).length;
        }
      }
    }
  }
  return total;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function heatColor(words: number, dailyGoal: number): string {
  if (words === 0) return 'var(--hm-0)';
  const pct = words / Math.max(1, dailyGoal);
  if (pct < 0.25) return 'var(--hm-1)';
  if (pct < 0.5) return 'var(--hm-2)';
  if (pct < 1.0) return 'var(--hm-3)';
  return 'var(--hm-4)';
}

export default function ProgressDashboard({ stories }: Props) {
  const [stats, setStats] = useState<GoalsStats | null>(null);
  const [goalInput, setGoalInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  const totalWords = computeTotalWords(stories);

  const loadStats = useCallback(async () => {
    try {
      const s = await window.api.goalsGetStats();
      setStats(s);
      setGoalInput(String(s.dailyGoal));
    } catch {
      const fallback: GoalsStats = {
        todayWords: 0,
        weekWords: 0,
        dailyGoal: 500,
        streakDays: 0,
        heatmap: Array.from({ length: 30 }, (_, i) => ({ date: String(i), words: 0 })),
      };
      setStats(fallback);
      setGoalInput('500');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleSaveGoal = useCallback(async () => {
    const n = parseInt(goalInput, 10);
    if (isNaN(n) || n < 1) return;
    setSaving(true);
    try {
      await window.api.goalsSetGoal(n);
      await loadStats();
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  }, [goalInput, loadStats]);

  const handleGoalKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleSaveGoal();
    },
    [handleSaveGoal],
  );

  const handleResetStreak = useCallback(async () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      return;
    }
    try {
      await window.api.goalsResetStreak();
      setResetConfirm(false);
      await loadStats();
    } catch {
      setResetConfirm(false);
    }
  }, [resetConfirm, loadStats]);

  if (loading) {
    return (
      <div className="pd-loading" aria-live="polite">
        Loading…
      </div>
    );
  }

  if (!stats) return null;

  const todayPct = stats.dailyGoal > 0
    ? Math.min(100, Math.round((stats.todayWords / stats.dailyGoal) * 100))
    : 0;
  const goalMet = stats.todayWords >= stats.dailyGoal;

  return (
    <div className="progress-dashboard" aria-label="Writing Progress">

      <section className="pd-section" aria-labelledby="pd-today">
        <h2 className="pd-heading" id="pd-today">Today</h2>
        <div className="pd-today-count" aria-live="polite">
          <span className="pd-big">{fmt(stats.todayWords)}</span>
          <span className="pd-sep">/</span>
          <span className="pd-sub-num">{fmt(stats.dailyGoal)}</span>
          <span className="pd-unit">words</span>
          {goalMet && <span className="pd-check" aria-label="Goal met">✓</span>}
        </div>
        <div
          className="pd-bar-track"
          role="progressbar"
          aria-valuenow={todayPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Daily writing goal: ${todayPct}%`}
        >
          <div
            className={`pd-bar-fill${goalMet ? ' pd-bar-fill--done' : ''}`}
            style={{ width: `${todayPct}%` }}
          />
        </div>
        <div className="pd-pct">{todayPct}%</div>
      </section>

      <section className="pd-section" aria-labelledby="pd-streak">
        <h2 className="pd-heading" id="pd-streak">Streak</h2>
        <div className="pd-streak-row">
          <span className="pd-flame" aria-hidden="true">🔥</span>
          <span className="pd-big">{stats.streakDays}</span>
          <span className="pd-unit">{stats.streakDays === 1 ? 'day' : 'days'}</span>
        </div>
        <div className="pd-streak-actions">
          <button
            className={`pd-reset-btn${resetConfirm ? ' pd-reset-btn--warn' : ''}`}
            onClick={handleResetStreak}
            aria-label={resetConfirm ? 'Confirm: reset writing streak?' : 'Reset writing streak'}
          >
            {resetConfirm ? 'Confirm reset?' : 'Reset Streak'}
          </button>
          {resetConfirm && (
            <button
              className="pd-cancel-btn"
              onClick={() => setResetConfirm(false)}
              aria-label="Cancel streak reset"
            >
              Cancel
            </button>
          )}
        </div>
      </section>

      <section className="pd-section" aria-labelledby="pd-stats">
        <h2 className="pd-heading" id="pd-stats">Stats</h2>
        <dl className="pd-stat-list">
          <div className="pd-stat-row">
            <dt className="pd-stat-label">This week</dt>
            <dd className="pd-stat-val">{fmt(stats.weekWords)}</dd>
          </div>
          <div className="pd-stat-row">
            <dt className="pd-stat-label">Project total</dt>
            <dd className="pd-stat-val">{fmt(totalWords)}</dd>
          </div>
        </dl>
      </section>

      <section className="pd-section" aria-labelledby="pd-heatmap">
        <h2 className="pd-heading" id="pd-heatmap">30-Day Activity</h2>
        <div className="pd-heatmap" role="img" aria-label="30-day writing activity heatmap">
          {stats.heatmap.map((entry, idx) => (
            <div
              key={entry.date || idx}
              className="pd-cell"
              style={{ backgroundColor: heatColor(entry.words, stats.dailyGoal) }}
              title={
                entry.date
                  ? `${entry.date}: ${fmt(entry.words)} word${entry.words !== 1 ? 's' : ''}`
                  : ''
              }
              aria-label={
                entry.date
                  ? `${entry.date}: ${fmt(entry.words)} word${entry.words !== 1 ? 's' : ''}`
                  : ''
              }
            />
          ))}
        </div>
        <div className="pd-legend" aria-hidden="true">
          <span className="pd-legend-cell" style={{ backgroundColor: 'var(--hm-0)' }} />
          <span className="pd-legend-cell" style={{ backgroundColor: 'var(--hm-1)' }} />
          <span className="pd-legend-cell" style={{ backgroundColor: 'var(--hm-2)' }} />
          <span className="pd-legend-cell" style={{ backgroundColor: 'var(--hm-3)' }} />
          <span className="pd-legend-cell" style={{ backgroundColor: 'var(--hm-4)' }} />
          <span className="pd-legend-text">less → more</span>
        </div>
      </section>

      <section className="pd-section pd-section--last" aria-labelledby="pd-goal">
        <h2 className="pd-heading" id="pd-goal">Daily Goal</h2>
        <div className="pd-goal-row">
          <input
            id="pd-goal-input"
            type="number"
            min={1}
            max={100000}
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            onKeyDown={handleGoalKeyDown}
            className="pd-goal-input"
            aria-label="Daily word count goal"
          />
          <label htmlFor="pd-goal-input" className="pd-goal-label">
            words / day
          </label>
          <button
            className="pd-save-btn"
            onClick={handleSaveGoal}
            disabled={saving}
            aria-label="Save daily goal"
          >
            {saving ? '…' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  );
}
