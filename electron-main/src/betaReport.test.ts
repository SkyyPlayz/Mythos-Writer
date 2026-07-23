import { describe, it, expect } from 'vitest';
import {
  verdictForScore,
  parseBetaReportResponse,
  buildBetaReportUserContent,
  dbRowToBetaReport,
  dbRowToBetaReportSummary,
  BETA_REPORT_CATEGORIES,
} from './betaReport.js';
import type { DbBetaReport } from './db.js';

describe('verdictForScore', () => {
  it('scores >= 75 are strong', () => {
    expect(verdictForScore(75)).toBe('strong');
    expect(verdictForScore(100)).toBe('strong');
  });

  it('scores 50-74 are mixed', () => {
    expect(verdictForScore(50)).toBe('mixed');
    expect(verdictForScore(74)).toBe('mixed');
  });

  it('scores below 50 are weak', () => {
    expect(verdictForScore(49)).toBe('weak');
    expect(verdictForScore(0)).toBe('weak');
  });
});

describe('parseBetaReportResponse', () => {
  it('parses a well-formed summary line and reaction lines', () => {
    const text = [
      '{"type":"summary","overall":82,"categories":{"hook":90,"pacing":70,"clarity":85,"emotion":80},"feedback":"Strong opener."}',
      '{"type":"reaction","kind":"loved","sceneId":"scene-1","quote":"the lantern flickered","where":"Ch. 1 - Scene 1","note":"Great imagery."}',
      '{"type":"reaction","kind":"confused","sceneId":"scene-2","quote":"who is Mara again","where":"Ch. 2 - Scene 1","note":"Lost track of this character."}',
    ].join('\n');

    const parsed = parseBetaReportResponse(text);

    expect(parsed.summary.overallScore).toBe(82);
    expect(parsed.summary.overallVerdict).toBe('strong');
    expect(parsed.summary.feedback).toBe('Strong opener.');
    expect(parsed.summary.categories).toEqual([
      { key: 'hook', label: 'Hook', score: 90, verdict: 'strong' },
      { key: 'pacing', label: 'Pacing', score: 70, verdict: 'mixed' },
      { key: 'clarity', label: 'Clarity', score: 85, verdict: 'strong' },
      { key: 'emotion', label: 'Emotion', score: 80, verdict: 'strong' },
    ]);
    expect(parsed.reactions).toHaveLength(2);
    expect(parsed.reactions[0]).toMatchObject({ kind: 'loved', sceneId: 'scene-1', quote: 'the lantern flickered' });
    expect(parsed.reactions[1].kind).toBe('confused');
  });

  it('skips malformed JSON lines without throwing', () => {
    const text = [
      '{"type":"summary","overall":60,"categories":{},"feedback":"ok"}',
      'not json at all',
      '{"type":"reaction","kind":"loved"', // truncated / invalid JSON
      '{"type":"reaction","kind":"stumbled","sceneId":"scene-1","quote":"valid one","where":"","note":""}',
    ].join('\n');

    const parsed = parseBetaReportResponse(text);
    expect(parsed.summary.overallScore).toBe(60);
    expect(parsed.reactions).toHaveLength(1);
    expect(parsed.reactions[0].kind).toBe('stumbled');
  });

  it('drops reactions with an unknown kind', () => {
    const text = '{"type":"reaction","kind":"neutral","sceneId":"scene-1","quote":"x","where":"","note":""}';
    expect(parseBetaReportResponse(text).reactions).toHaveLength(0);
  });

  it('drops reactions missing sceneId or quote', () => {
    const text = [
      '{"type":"reaction","kind":"loved","quote":"has no scene id","where":"","note":""}',
      '{"type":"reaction","kind":"loved","sceneId":"scene-1","quote":"","where":"","note":""}',
    ].join('\n');
    expect(parseBetaReportResponse(text).reactions).toHaveLength(0);
  });

  it('clamps out-of-range and non-numeric scores to 0-100', () => {
    const text = '{"type":"summary","overall":150,"categories":{"hook":-10,"pacing":"nope","clarity":50.6,"emotion":null},"feedback":""}';
    const parsed = parseBetaReportResponse(text);
    expect(parsed.summary.overallScore).toBe(100);
    const byKey = Object.fromEntries(parsed.summary.categories.map((c) => [c.key, c.score]));
    expect(byKey.hook).toBe(0);
    expect(byKey.pacing).toBe(0);
    expect(byKey.clarity).toBe(51);
    expect(byKey.emotion).toBe(0);
  });

  it('truncates an overlong quote to 219 chars (MAX_ANCHOR_LENGTH)', () => {
    const longQuote = 'x'.repeat(400);
    const text = `{"type":"reaction","kind":"loved","sceneId":"scene-1","quote":"${longQuote}","where":"","note":""}`;
    const [reaction] = parseBetaReportResponse(text).reactions;
    expect(reaction.quote).toHaveLength(219);
  });

  it('falls back to a default report shape when no summary line is present', () => {
    const parsed = parseBetaReportResponse('garbage\nmore garbage');
    expect(parsed.summary.overallScore).toBe(0);
    expect(parsed.summary.overallVerdict).toBe('weak');
    expect(parsed.summary.categories).toHaveLength(BETA_REPORT_CATEGORIES.length);
    expect(parsed.summary.feedback).toMatch(/could not produce a structured report/i);
    expect(parsed.reactions).toEqual([]);
  });

  it('handles empty input', () => {
    const parsed = parseBetaReportResponse('');
    expect(parsed.summary.overallScore).toBe(0);
    expect(parsed.reactions).toEqual([]);
  });
});

describe('buildBetaReportUserContent', () => {
  it('lists only the enabled focus areas', () => {
    const content = buildBetaReportUserContent('Chapter 2', { pacing: true, clarity: false, character: true, plot: false }, 'text');
    expect(content).toContain('Focus on: pacing, character.');
  });

  it('falls back to "overall impression" when no focus is selected', () => {
    const content = buildBetaReportUserContent('Chapter 2', { pacing: false, clarity: false, character: false, plot: false }, 'text');
    expect(content).toContain('Focus on: overall impression.');
  });

  it('wraps the source text in <manuscript> delimiters', () => {
    const content = buildBetaReportUserContent('Scene: Arrival', { pacing: true, clarity: true, character: true, plot: true }, '<<SCENE id="s1">>Once upon a time.<</SCENE>>');
    expect(content).toContain('<manuscript>\n<<SCENE id="s1">>Once upon a time.<</SCENE>>\n</manuscript>');
  });

  it('instructs the model to never rewrite the manuscript', () => {
    const content = buildBetaReportUserContent('Full story', { pacing: true, clarity: true, character: true, plot: true }, 'text');
    expect(content).toMatch(/never rewrite/i);
  });
});

describe('dbRowToBetaReport / dbRowToBetaReportSummary', () => {
  const row: DbBetaReport = {
    id: 'report-1',
    story_id: 'story-1',
    scope_kind: 'chapter',
    scope_id: 'chapter-1',
    scope_label: 'Chapter 2: The Descent',
    focus_json: JSON.stringify({ pacing: true, clarity: true, character: false, plot: false }),
    overall_score: 82,
    overall_verdict: 'strong',
    categories_json: JSON.stringify([{ key: 'hook', label: 'Hook', score: 90, verdict: 'strong' }]),
    feedback: 'Solid chapter.',
    reactions_json: JSON.stringify([{ id: 'r1', kind: 'loved', sceneId: 'scene-1', quote: 'q', where: 'w', note: 'n' }]),
    created_at: '2026-07-15T00:00:00.000Z',
  };

  it('deserializes the full report, including JSON-blob fields', () => {
    const report = dbRowToBetaReport(row);
    expect(report.id).toBe('report-1');
    expect(report.scope).toEqual({ kind: 'chapter', id: 'chapter-1', label: 'Chapter 2: The Descent' });
    expect(report.focus).toEqual({ pacing: true, clarity: true, character: false, plot: false });
    expect(report.overall).toEqual({ score: 82, verdict: 'strong' });
    expect(report.categories).toHaveLength(1);
    expect(report.reactions).toHaveLength(1);
  });

  it('produces a lightweight summary without needing to parse reactions', () => {
    const summary = dbRowToBetaReportSummary(row);
    expect(summary).toEqual({
      id: 'report-1',
      storyId: 'story-1',
      scope: { kind: 'chapter', id: 'chapter-1', label: 'Chapter 2: The Descent' },
      overall: { score: 82, verdict: 'strong' },
      createdAt: '2026-07-15T00:00:00.000Z',
    });
  });
});
