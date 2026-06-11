import { describe, expect, it } from 'vitest';
import { detectCloudProvider } from './cloudSync';

describe('detectCloudProvider', () => {
  it.each([
    ['/Users/alex/Dropbox/Mythos/Story Vault', 'dropbox'],
    ['C:\\Users\\alex\\Dropbox\\Mythos\\Story Vault', 'dropbox'],
    ['/Users/alex/Google Drive/My Drive/Mythos', 'google-drive'],
    ['G:\\My Drive\\Mythos', 'google-drive'],
    ['/Users/alex/Library/Mobile Documents/com~apple~CloudDocs/Mythos', 'icloud'],
    ['C:\\Users\\alex\\iCloudDrive\\Mythos', 'icloud'],
    ['C:\\Users\\alex\\OneDrive\\Mythos', 'onedrive'],
    ['/Users/alex/OneDrive - Sky High/Mythos', 'onedrive'],
    ['/Users/alex/Documents/Mythos', null],
  ] as const)('detects %s as %s', (input, expected) => {
    expect(detectCloudProvider(input)).toBe(expected);
  });

  it('returns null for empty and missing paths', () => {
    expect(detectCloudProvider('')).toBeNull();
    expect(detectCloudProvider(null)).toBeNull();
    expect(detectCloudProvider(undefined)).toBeNull();
  });
});
