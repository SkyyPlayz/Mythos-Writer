/**
 * SKY-11186 — boardFollowsChange: an open board reloads only for vault
 * changes it can actually see.
 */
import { describe, it, expect } from 'vitest';
import { boardFollowsChange } from './boardVaultChange';

describe('boardFollowsChange', () => {
  it('always follows an untargeted update', () => {
    expect(boardFollowsChange('Characters', undefined, [])).toBe(true);
    expect(boardFollowsChange('', '', [])).toBe(true);
  });

  it('follows its immediate children and grandchildren (tile counts), not deeper descendants', () => {
    expect(boardFollowsChange('Characters', 'Characters/Mira.md', [])).toBe(true);
    expect(boardFollowsChange('Characters', 'Characters/Court', [])).toBe(true);
    expect(boardFollowsChange('Characters', 'Characters/Court/Queen.md', [])).toBe(true);
    expect(boardFollowsChange('Characters', 'Characters/Court/Advisors/Sage.md', [])).toBe(false);
  });

  it('ignores changes on other boards, including look-alike prefixes', () => {
    expect(boardFollowsChange('Characters', 'Locations/Gate.md', [])).toBe(false);
    expect(boardFollowsChange('Characters', 'Characters-old/Mira.md', [])).toBe(false);
    expect(boardFollowsChange('Characters', 'Mira.md', [])).toBe(false);
  });

  it('follows its own folder being renamed or removed', () => {
    expect(boardFollowsChange('Characters', 'Characters', [])).toBe(true);
  });

  it('at Home, follows root notes, top-level folders and their direct children only', () => {
    expect(boardFollowsChange('', 'Readme.md', [])).toBe(true);
    expect(boardFollowsChange('', 'Characters/Mira.md', [])).toBe(true);
    expect(boardFollowsChange('', 'Characters/Court/Queen.md', [])).toBe(false);
  });

  it('follows an image one of its cards is showing, wherever it lives', () => {
    const shown = ['attachments/veynn-skyline.png', null, undefined];
    expect(boardFollowsChange('Locations', 'attachments/veynn-skyline.png', shown)).toBe(true);
    expect(boardFollowsChange('Locations', 'attachments/other.png', shown)).toBe(false);
  });
});
