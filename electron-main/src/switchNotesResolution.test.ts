// SKY-11375 [DATA INTEGRITY] — proves a project:switch never repoints a vault
// at ANOTHER vault's notes directory (cross-vault content bleed). These assert
// the resolved notes root at the IPC-resolution level, not the UI.

import { describe, it, expect } from 'vitest';
import { resolveSwitchNotesRoot } from './switchNotesResolution.js';

const A_STORY_NOTES = '/vaults/A/Notes Vault';
const B_STORY_NOTES = '/vaults/B/Notes Vault';

describe('resolveSwitchNotesRoot — SKY-11375 cross-vault bleed', () => {
  it('THE bug: v2 vault B with no supplied/paired root resolves to B, never the outgoing A', () => {
    // Owner repro: active vault A, switching to a freshly-created vault B whose
    // recents entry has no paired notes root. The old code fell back to the
    // active (A) notes root — the bleed. Structural resolution must win.
    const res = resolveSwitchNotesRoot({
      suppliedNotesRoot: null,
      structuralNotesRoot: B_STORY_NOTES,
      pairedNotesRoot: null,
      activeNotesRoot: A_STORY_NOTES, // outgoing — must NOT be chosen
    });
    expect(res).toEqual({ ok: true, notesVaultRoot: B_STORY_NOTES, source: 'registry' });
  });

  it('two distinct v2 vaults resolve to distinct notes roots (roots differ per vault)', () => {
    const a = resolveSwitchNotesRoot({
      suppliedNotesRoot: null, structuralNotesRoot: A_STORY_NOTES, pairedNotesRoot: null, activeNotesRoot: B_STORY_NOTES,
    });
    const b = resolveSwitchNotesRoot({
      suppliedNotesRoot: null, structuralNotesRoot: B_STORY_NOTES, pairedNotesRoot: null, activeNotesRoot: A_STORY_NOTES,
    });
    expect(a.ok && b.ok && a.notesVaultRoot !== b.notesVaultRoot).toBe(true);
  });

  it('structural registry outranks a stale recents pairing', () => {
    const res = resolveSwitchNotesRoot({
      suppliedNotesRoot: null,
      structuralNotesRoot: B_STORY_NOTES,
      pairedNotesRoot: '/vaults/B/Old Notes Vault', // stale recents entry
      activeNotesRoot: A_STORY_NOTES,
    });
    expect(res).toEqual({ ok: true, notesVaultRoot: B_STORY_NOTES, source: 'registry' });
  });

  it('IGNORES a disagreeing supplied root on a v2 vault — structural wins, switch still succeeds', () => {
    // A stale/compromised renderer passing the outgoing (A) notes root must
    // neither bleed nor block: the registry's structural root (B) is used.
    const res = resolveSwitchNotesRoot({
      suppliedNotesRoot: A_STORY_NOTES,
      structuralNotesRoot: B_STORY_NOTES,
      pairedNotesRoot: null,
      activeNotesRoot: A_STORY_NOTES,
    });
    expect(res).toEqual({ ok: true, notesVaultRoot: B_STORY_NOTES, source: 'registry-overrode-supplied' });
  });

  it('accepts a supplied root that matches the v2 vault structure', () => {
    const res = resolveSwitchNotesRoot({
      suppliedNotesRoot: B_STORY_NOTES,
      structuralNotesRoot: B_STORY_NOTES,
      pairedNotesRoot: null,
      activeNotesRoot: A_STORY_NOTES,
    });
    expect(res).toEqual({ ok: true, notesVaultRoot: B_STORY_NOTES, source: 'registry' });
  });

  describe('legacy twin-root vaults (no structural registry)', () => {
    it('uses the recents pairing when present', () => {
      const res = resolveSwitchNotesRoot({
        suppliedNotesRoot: null, structuralNotesRoot: null, pairedNotesRoot: B_STORY_NOTES, activeNotesRoot: A_STORY_NOTES,
      });
      expect(res).toEqual({ ok: true, notesVaultRoot: B_STORY_NOTES, source: 'recents-pair' });
    });

    it('rejects cross-pairing (SKY-320): supplied root that disagrees with the recents pairing', () => {
      const res = resolveSwitchNotesRoot({
        suppliedNotesRoot: A_STORY_NOTES, structuralNotesRoot: null, pairedNotesRoot: B_STORY_NOTES, activeNotesRoot: A_STORY_NOTES,
      });
      expect(res.ok).toBe(false);
    });

    it('only a legacy vault with nothing known reaches the active-fallback', () => {
      const res = resolveSwitchNotesRoot({
        suppliedNotesRoot: null, structuralNotesRoot: null, pairedNotesRoot: null, activeNotesRoot: A_STORY_NOTES,
      });
      expect(res).toEqual({ ok: true, notesVaultRoot: A_STORY_NOTES, source: 'active-fallback' });
    });
  });

  it('rejects an empty supplied root', () => {
    const res = resolveSwitchNotesRoot({
      suppliedNotesRoot: '', structuralNotesRoot: B_STORY_NOTES, pairedNotesRoot: null, activeNotesRoot: A_STORY_NOTES,
    });
    expect(res.ok).toBe(false);
  });
});
