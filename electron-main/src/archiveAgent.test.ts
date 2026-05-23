// Tests for the explicit time-cue extractor (Phase 5, MYT-217).
import { describe, it, expect } from 'vitest';
import { extractTimeCues } from './archiveAgent.js';

describe('extractTimeCues — frontmatter date', () => {
  it('extracts a plain date string from frontmatter', () => {
    const content = `---\ntitle: Chapter One\ndate: January 15, 2024\n---\n\nShe walked in.`;
    const entries = extractTimeCues(content, 'scenes/ch1.md');
    const fm = entries.find((e) => {
      const n = JSON.parse(e.notes_json ?? '{}');
      return n.origin === 'frontmatter_date';
    });
    expect(fm).toBeDefined();
    expect(fm!.inferred_time).toBe('January 15, 2024');
    expect(fm!.confidence).toBe(0.95);
    expect(fm!.source).toBe('explicit_marker');
    expect(fm!.scene_path).toBe('scenes/ch1.md');
  });

  it('strips surrounding quotes from frontmatter date', () => {
    const content = `---\ndate: "2024-03-10"\n---\n\nProse.`;
    const entries = extractTimeCues(content, 'scenes/ch2.md');
    const fm = entries.find((e) => JSON.parse(e.notes_json ?? '{}').origin === 'frontmatter_date');
    expect(fm!.inferred_time).toBe('2024-03-10');
  });

  it('returns no frontmatter entry when date key is absent', () => {
    const content = `---\ntitle: No date here\n---\n\nProse.`;
    const entries = extractTimeCues(content, 'scenes/ch3.md');
    const fm = entries.find((e) => JSON.parse(e.notes_json ?? '{}').origin === 'frontmatter_date');
    expect(fm).toBeUndefined();
  });
});

describe('extractTimeCues — scene marker patterns', () => {
  it('detects "Three days later"', () => {
    const content = `Three days later, the storm had passed.`;
    const entries = extractTimeCues(content, 'scenes/s1.md');
    expect(entries.some((e) => e.inferred_time.toLowerCase().includes('three days later'))).toBe(true);
  });

  it('detects "The next morning"', () => {
    const content = `The next morning she opened the window.`;
    const entries = extractTimeCues(content, 'scenes/s2.md');
    expect(entries.some((e) => /the next morning/i.test(e.inferred_time))).toBe(true);
  });

  it('detects "Later that evening"', () => {
    const content = `Later that evening the fire had gone cold.`;
    const entries = extractTimeCues(content, 'scenes/s3.md');
    expect(entries.some((e) => /later that evening/i.test(e.inferred_time))).toBe(true);
  });

  it('detects an ISO date in prose', () => {
    const content = `The date was 2024-07-04 when it all began.`;
    const entries = extractTimeCues(content, 'scenes/s4.md');
    expect(entries.some((e) => e.inferred_time === '2024-07-04')).toBe(true);
  });

  it('deduplicates repeated identical markers', () => {
    const content = `Three days later they arrived. Three days later the gate opened.`;
    const entries = extractTimeCues(content, 'scenes/s5.md');
    const count = entries.filter((e) =>
      e.inferred_time.toLowerCase() === 'three days later',
    ).length;
    expect(count).toBe(1);
  });

  it('assigns correct confidence to relative elapsed markers', () => {
    const content = `Two weeks later the letter arrived.`;
    const entries = extractTimeCues(content, 'scenes/s6.md');
    const e = entries.find((en) => /two weeks later/i.test(en.inferred_time));
    expect(e).toBeDefined();
    expect(e!.confidence).toBe(0.75);
  });

  it('assigns higher confidence to "the next morning" pattern', () => {
    const content = `The next morning they set out.`;
    const entries = extractTimeCues(content, 'scenes/s7.md');
    const e = entries.find((en) => /the next morning/i.test(en.inferred_time));
    expect(e).toBeDefined();
    expect(e!.confidence).toBe(0.8);
  });

  it('returns all entries with required fields', () => {
    const content = `---\ndate: Spring 1842\n---\nThe next day she left.`;
    const entries = extractTimeCues(content, 'scenes/full.md');
    for (const e of entries) {
      expect(e.id).toBeTruthy();
      expect(e.scene_path).toBe('scenes/full.md');
      expect(e.source).toBe('explicit_marker');
      expect(typeof e.confidence).toBe('number');
      expect(e.created_at).toMatch(/^\d{4}-/);
    }
  });

  it('returns empty array for content with no cues', () => {
    const content = `She sat down and thought for a while.`;
    const entries = extractTimeCues(content, 'scenes/empty.md');
    expect(entries).toHaveLength(0);
  });
});
