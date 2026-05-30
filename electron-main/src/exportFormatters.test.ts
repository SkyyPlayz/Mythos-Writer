import { describe, it, expect } from 'vitest';
import {
  sceneToMarkdown, chapterToMarkdown, storyToMarkdown, vaultToMarkdown,
  sceneToPlaintext, chapterToPlaintext, storyToPlaintext, vaultToPlaintext,
  type ExportableScene, type ExportableChapter, type ExportableStory,
} from './exportFormatters.js';

const sc1: ExportableScene = { title: 'The Storm', prose: 'Rain fell hard.' };
const sc2: ExportableScene = { title: 'Calm After', prose: 'Silence returned.' };
const empty: ExportableScene = { title: 'Placeholder', prose: '' };
const ch1: ExportableChapter = { title: 'Chapter One', scenes: [sc1, sc2] };
const story: ExportableStory = { title: 'My Novel', chapters: [ch1, { title: 'Ch2', scenes: [empty] }] };

describe('sceneToMarkdown', () => {
  it('H1 + prose', () => { expect(sceneToMarkdown(sc1)).toContain('# The Storm'); expect(sceneToMarkdown(sc1)).toContain('Rain fell hard.'); });
  it('no undefined', () => { expect(sceneToMarkdown(empty)).not.toContain('undefined'); });
});
describe('chapterToMarkdown', () => {
  it('H1/H2', () => { const r = chapterToMarkdown('Ch', [sc1]); expect(r).toContain('# Ch'); expect(r).toContain('## The Storm'); });
});
describe('storyToMarkdown', () => {
  it('H1/H2/H3', () => { const r = storyToMarkdown(story); expect(r).toContain('# My Novel'); expect(r).toContain('## Chapter One'); expect(r).toContain('### The Storm'); });
});
describe('vaultToMarkdown', () => {
  it('joins', () => { expect((vaultToMarkdown([story, story]).match(/# My Novel/g) ?? []).length).toBe(2); });
  it('empty', () => { expect(vaultToMarkdown([])).toBe(''); });
});
describe('sceneToPlaintext', () => {
  it('no # marker', () => { const r = sceneToPlaintext(sc1); expect(r.startsWith('The Storm\n')).toBe(true); expect(r).not.toContain('#'); });
});
describe('chapterToPlaintext', () => { it('strips #', () => { expect(chapterToPlaintext('Ch', [sc1])).not.toMatch(/^#/m); }); });
describe('storyToPlaintext', () => { it('strips all #', () => { expect(storyToPlaintext(story)).not.toMatch(/^#+\s/m); }); });
describe('vaultToPlaintext', () => { it('empty', () => { expect(vaultToPlaintext([])).toBe(''); }); });
