import { describe, expect, it } from 'vitest';
import { truncatePath } from './truncatePath';

describe('truncatePath', () => {
  it('returns short paths unchanged', () => {
    expect(truncatePath('~/Books/Mythos', 40, { sep: '/' })).toBe('~/Books/Mythos');
  });

  it('normalizes a macOS home path before segment truncation', () => {
    const path = '/Users/alex/Library/Mobile Documents/com~apple~CloudDocs/Mythos/Books/Series One/Volume Two';

    expect(truncatePath(path, 45, { homeDir: '/Users/alex', sep: '/' })).toBe('~/Library/…/Series One/Volume Two');
  });

  it('truncates Windows OneDrive paths with drive letter preserved', () => {
    const path = 'C:\\Users\\Alex Writer\\OneDrive\\Documents\\Mythos\\Books\\Series One\\Volume Two';

    expect(truncatePath(path, 44, { sep: '\\' })).toBe('C:\\Users\\…\\Series One\\Volume Two');
  });

  it('normalizes Linux home paths to tilde', () => {
    expect(truncatePath('/home/skyy/Mythos/Books/Series/Volume', 24, { homeDir: '/home/skyy', sep: '/' })).toBe('~/Mythos/…/Series/Volume');
  });

  it('preserves UNC server and share anchors', () => {
    const path = '\\\\NAS-01\\Shared Stories\\Team Vaults\\Mythos\\Books\\Series\\Volume';

    expect(truncatePath(path, 52, { sep: '\\' })).toBe('\\\\NAS-01\\Shared Stories\\…\\Series\\Volume');
  });

  it('falls back to character middle truncation for long individual segments', () => {
    const path = '/Users/alex/Documents/ThisFolderNameIsAbsurdlyLongWithoutUsefulBreaks/Leaf';

    expect(truncatePath(path, 36, { homeDir: '/Users/alex', sep: '/' })).toBe('~/Documents/ThisFolderN…Breaks/Leaf');
  });
});
