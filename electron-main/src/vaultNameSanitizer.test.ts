// SKY-9027: unit coverage for the shared NOTES-vault name sanitizer.
import { describe, it, expect } from 'vitest';
import { sanitizeVaultName } from '@mythos-writer/shared/vaultNameSanitizer';

describe('sanitizeVaultName', () => {
  it('preserves full Unicode and emoji untouched', () => {
    expect(sanitizeVaultName('🌊 Folder')).toBe('🌊 Folder');
    expect(sanitizeVaultName('🔥 Note')).toBe('🔥 Note');
    expect(sanitizeVaultName('日本語のノート')).toBe('日本語のノート');
    expect(sanitizeVaultName("L'Arrivée")).toBe("L'Arrivée");
  });

  it('preserves case and whitespace (not a slug)', () => {
    expect(sanitizeVaultName('My Great Note')).toBe('My Great Note');
  });

  it('replaces only the OS-reserved character set', () => {
    expect(sanitizeVaultName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('strips control characters', () => {
    expect(sanitizeVaultName('foo\x00bar\x1fbaz')).toBe('foobarbaz');
  });

  it('strips trailing dots and spaces', () => {
    expect(sanitizeVaultName('Note.')).toBe('Note');
    expect(sanitizeVaultName('Note...')).toBe('Note');
    expect(sanitizeVaultName('Note   ')).toBe('Note');
    expect(sanitizeVaultName('Note. . ')).toBe('Note');
  });

  it('leaves interior dots and spaces alone', () => {
    expect(sanitizeVaultName('v1.2.3 release')).toBe('v1.2.3 release');
  });

  it('disambiguates Windows reserved device names', () => {
    for (const reserved of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9']) {
      expect(sanitizeVaultName(reserved)).toBe(`${reserved}_`);
      expect(sanitizeVaultName(reserved.toLowerCase())).toBe(`${reserved.toLowerCase()}_`);
    }
  });

  it('does not flag reserved names as a substring', () => {
    expect(sanitizeVaultName('CONtinuity')).toBe('CONtinuity');
    expect(sanitizeVaultName('Falcon')).toBe('Falcon');
  });

  it('falls back to the given default for an empty or all-forbidden name', () => {
    expect(sanitizeVaultName('')).toBe('untitled');
    expect(sanitizeVaultName('   ')).toBe('untitled');
    expect(sanitizeVaultName('...')).toBe('untitled');
    expect(sanitizeVaultName('', 'note')).toBe('note');
  });
});
