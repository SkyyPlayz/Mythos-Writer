// Vault-root gate (MYT-789) — proves that vault:setPaths and project:switch
// cannot accept renderer-supplied paths that did not come from a user gesture.
//
// Threat model: a compromised renderer calling vault:setPaths or project:switch
// with `/`, `$HOME`, or any other writable path turns the rest of the vault:*
// IPC surface into an arbitrary-file read/write primitive, because each
// individual handler only sandboxes to whatever vault root is configured.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkSetPathsGate,
  checkProjectSwitchGate,
  checkLoadSampleGate,
  checkSinglePathGate,
  looksLikeObsidianVault,
  checkScaffoldGate,
} from './vaultGate.js';
import {
  generateRegistrationToken,
  validateRegistrationToken,
  __clearRegistrationTokens,
  TOKEN_TTL_MS,
} from './registrationToken.js';

beforeEach(() => {
  __clearRegistrationTokens();
});

describe('checkProjectSwitchGate', () => {
  it('accepts a path that is in the recent-projects allowlist', () => {
    const result = checkProjectSwitchGate('/home/alice/Stories', ['/home/alice/Stories', '/home/alice/Old']);
    expect(result).toEqual({ ok: true, vaultRoot: '/home/alice/Stories' });
  });

  it('rejects a path that is NOT in the recent-projects allowlist (the core MYT-789 hole)', () => {
    const result = checkProjectSwitchGate('/home/alice', ['/home/alice/Stories']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/recent-projects allowlist/);
    }
  });

  it('rejects "/" and "$HOME"-style roots when allowlist does not include them', () => {
    expect(checkProjectSwitchGate('/', ['/home/alice/Stories']).ok).toBe(false);
    expect(checkProjectSwitchGate('/home/alice', ['/home/alice/Stories']).ok).toBe(false);
    expect(checkProjectSwitchGate('/etc', ['/home/alice/Stories']).ok).toBe(false);
  });

  it('rejects empty / non-string vault roots without throwing', () => {
    expect(checkProjectSwitchGate('', ['/home/alice/Stories']).ok).toBe(false);
    expect(checkProjectSwitchGate(undefined, ['/home/alice/Stories']).ok).toBe(false);
    expect(checkProjectSwitchGate(null, ['/home/alice/Stories']).ok).toBe(false);
    expect(checkProjectSwitchGate(123 as unknown, ['/home/alice/Stories']).ok).toBe(false);
    expect(checkProjectSwitchGate({} as unknown, ['/home/alice/Stories']).ok).toBe(false);
  });

  it('rejects everything when the allowlist is empty', () => {
    expect(checkProjectSwitchGate('/home/alice/Stories', []).ok).toBe(false);
  });
});

describe('checkSetPathsGate', () => {
  it('rejects empty or missing path fields without throwing', () => {
    const r1 = checkSetPathsGate({ storyVaultPath: '', notesVaultPath: '/n' }, []);
    expect(r1.ok).toBe(false);
    const r2 = checkSetPathsGate({ storyVaultPath: '/s', notesVaultPath: undefined }, []);
    expect(r2.ok).toBe(false);
    const r3 = checkSetPathsGate({ storyVaultPath: 123 as unknown, notesVaultPath: '/n' }, []);
    expect(r3.ok).toBe(false);
  });

  it('rejects when no token is supplied and the paths are not in the allowlist', () => {
    const result = checkSetPathsGate(
      { storyVaultPath: '/home/alice', notesVaultPath: '/home/alice/Notes' },
      ['/home/alice/Old'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/storyVaultPath/);
    }
  });

  it('accepts paths that are both in the recent-projects allowlist', () => {
    const result = checkSetPathsGate(
      { storyVaultPath: '/home/alice/Story', notesVaultPath: '/home/alice/Notes' },
      ['/home/alice/Story', '/home/alice/Notes'],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.storyVaultPath).toBe('/home/alice/Story');
      expect(result.notesVaultPath).toBe('/home/alice/Notes');
    }
  });

  it('accepts paths backed by a path-bound registration token', () => {
    const storyToken = generateRegistrationToken('/home/alice/NewStory');
    const notesToken = generateRegistrationToken('/home/alice/NewNotes');
    const result = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/NewStory',
        notesVaultPath: '/home/alice/NewNotes',
        storyVaultToken: storyToken,
        notesVaultToken: notesToken,
      },
      [],
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a token bound to a different path (renderer-tampered path)', () => {
    const storyToken = generateRegistrationToken('/home/alice/PickedStory');
    const notesToken = generateRegistrationToken('/home/alice/PickedNotes');
    const result = checkSetPathsGate(
      {
        // Renderer tampers with the path while reusing a legitimate token.
        storyVaultPath: '/home/alice',
        notesVaultPath: '/home/alice/PickedNotes',
        storyVaultToken: storyToken,
        notesVaultToken: notesToken,
      },
      [],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/storyVaultPath/);
    // Neither token should have been consumed — the path mismatch failed
    // before consume, and the second token check never ran.
    expect(validateRegistrationToken(storyToken, { consume: false })).not.toBeNull();
    expect(validateRegistrationToken(notesToken, { consume: false })).not.toBeNull();
  });

  it('consumes both tokens on success so they cannot be replayed', () => {
    const storyToken = generateRegistrationToken('/home/alice/NewStory');
    const notesToken = generateRegistrationToken('/home/alice/NewNotes');
    const first = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/NewStory',
        notesVaultPath: '/home/alice/NewNotes',
        storyVaultToken: storyToken,
        notesVaultToken: notesToken,
      },
      [],
    );
    expect(first.ok).toBe(true);
    // Replay attempt fails — both tokens are gone.
    const replay = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/NewStory',
        notesVaultPath: '/home/alice/NewNotes',
        storyVaultToken: storyToken,
        notesVaultToken: notesToken,
      },
      [],
    );
    expect(replay.ok).toBe(false);
  });

  it('does not consume the first token when the second fails', () => {
    const storyToken = generateRegistrationToken('/home/alice/Story');
    const result = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/Story',
        notesVaultPath: '/home/alice/NoToken',
        storyVaultToken: storyToken,
        // no notes token, and the notes path is not in the allowlist
      },
      [],
    );
    expect(result.ok).toBe(false);
    // First token must still be usable.
    expect(validateRegistrationToken(storyToken)).toEqual({ vaultRoot: '/home/alice/Story' });
  });

  it('rejects expired tokens', () => {
    const now = Date.now();
    const storyToken = generateRegistrationToken('/home/alice/Story', now);
    const notesToken = generateRegistrationToken('/home/alice/Notes', now);
    const result = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/Story',
        notesVaultPath: '/home/alice/Notes',
        storyVaultToken: storyToken,
        notesVaultToken: notesToken,
      },
      [],
      now + TOKEN_TTL_MS + 1,
    );
    expect(result.ok).toBe(false);
  });

  it('mixed source: one path via token, the other via allowlist', () => {
    const storyToken = generateRegistrationToken('/home/alice/NewStory');
    const result = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/NewStory',
        notesVaultPath: '/home/alice/ExistingNotes',
        storyVaultToken: storyToken,
      },
      ['/home/alice/ExistingNotes'],
    );
    expect(result.ok).toBe(true);
  });

  it('rejects renderer-supplied $HOME-style escape when neither token nor allowlist accepts it', () => {
    // The MYT-789 attack: re-root the vault at $HOME so subsequent
    // vault:read({path: ".ssh/id_rsa"}) escapes the sandbox.
    const result = checkSetPathsGate(
      { storyVaultPath: '/home/alice', notesVaultPath: '/home/alice' },
      ['/home/alice/MythosWriter/StoryVault'],
    );
    expect(result.ok).toBe(false);
  });

  // SKY-270 / MYT-789: parent-bound token authorises direct-child vault dirs
  // so a single pickFolder() on the parent suffices for both Story Vault and
  // Notes Vault sub-directories.

  it('accepts vault sub-dirs when the token is bound to their parent (onboarding create flow)', () => {
    const parentToken = generateRegistrationToken('/home/alice/Mythos');
    // Same token passed for both — gate peeks both with consume:false, then
    // consumes once; second consume is a harmless no-op.
    const result = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/Mythos/Story Vault',
        notesVaultPath: '/home/alice/Mythos/Notes Vault',
        storyVaultToken: parentToken,
        notesVaultToken: parentToken,
      },
      [],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.storyVaultPath).toBe('/home/alice/Mythos/Story Vault');
      expect(result.notesVaultPath).toBe('/home/alice/Mythos/Notes Vault');
    }
  });

  it('rejects when the token is bound to the grandparent (two levels up — no traversal)', () => {
    const grandparentToken = generateRegistrationToken('/home/alice');
    const result = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/Mythos/Story Vault',
        notesVaultPath: '/home/alice/Mythos/Notes Vault',
        storyVaultToken: grandparentToken,
        notesVaultToken: grandparentToken,
      },
      [],
    );
    expect(result.ok).toBe(false);
  });

  it('rejects path-traversal attempt using a parent token (../escape)', () => {
    const parentToken = generateRegistrationToken('/home/alice/Mythos');
    const result = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/Mythos/../../../etc',
        notesVaultPath: '/home/alice/Mythos/Notes Vault',
        storyVaultToken: parentToken,
        notesVaultToken: parentToken,
      },
      [],
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a sibling dir (not a direct child of the picked parent)', () => {
    // Token for /home/alice/Mythos must NOT authorise /home/alice/OtherProject
    // even though both share the /home/alice parent.
    const parentToken = generateRegistrationToken('/home/alice/Mythos');
    const result = checkSetPathsGate(
      {
        storyVaultPath: '/home/alice/OtherProject/Story Vault',
        notesVaultPath: '/home/alice/OtherProject/Notes Vault',
        storyVaultToken: parentToken,
        notesVaultToken: parentToken,
      },
      [],
    );
    expect(result.ok).toBe(false);
  });
});

// ─── looksLikeObsidianVault (SEC-12) ──────────────────────────────────────────

describe('looksLikeObsidianVault', () => {
  it('returns true when .obsidian subdirectory exists (real Obsidian vault)', () => {
    // Simulate an Obsidian vault directory structure.
    const existsSync = (p: string) => p === '/home/alice/MyVault/.obsidian';
    expect(looksLikeObsidianVault('/home/alice/MyVault', existsSync)).toBe(true);
  });

  it('returns false when .obsidian subdirectory is absent (arbitrary directory)', () => {
    // /home/alice has no .obsidian — the SEC-12 attack path.
    const existsSync = (_p: string) => false;
    expect(looksLikeObsidianVault('/home/alice', existsSync)).toBe(false);
  });

  it('returns false for /home/user (SEC-12 canonical attack path)', () => {
    const existsSync = (p: string) => !p.includes('.obsidian');
    expect(looksLikeObsidianVault('/home/alice', existsSync)).toBe(false);
  });

  it('returns false for /etc (sensitive system directory)', () => {
    const existsSync = (_p: string) => false;
    expect(looksLikeObsidianVault('/etc', existsSync)).toBe(false);
  });

  it('checks exactly <path>/.obsidian, not the root path itself', () => {
    // Verify the function checks the .obsidian child, not the root dir.
    const checked: string[] = [];
    const existsSync = (p: string) => { checked.push(p); return false; };
    looksLikeObsidianVault('/some/dir', existsSync);
    expect(checked).toHaveLength(1);
    expect(checked[0]).toMatch(/\.obsidian$/);
    expect(checked[0]).not.toBe('/some/dir');
  });
});

// ─── checkLoadSampleGate (SEC-11) ─────────────────────────────────────────────

describe('checkLoadSampleGate', () => {
  it('accepts when targetPath is absent (undefined)', () => {
    expect(checkLoadSampleGate(undefined)).toEqual({ ok: true });
  });

  it('accepts when targetPath is null', () => {
    expect(checkLoadSampleGate(null)).toEqual({ ok: true });
  });

  it('accepts when targetPath is an empty string', () => {
    // Empty string is equivalent to "not supplied".
    expect(checkLoadSampleGate('')).toEqual({ ok: true });
  });

  it('rejects any non-empty string targetPath (SEC-11 attack: arbitrary mkdir)', () => {
    expect(checkLoadSampleGate('/home/alice').ok).toBe(false);
    expect(checkLoadSampleGate('/etc/passwd').ok).toBe(false);
    expect(checkLoadSampleGate('~/evil').ok).toBe(false);
  });

  it('returns UNAUTHORIZED_PATH error code on rejection', () => {
    const result = checkLoadSampleGate('/home/alice');
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED_PATH');
  });

  it('rejects non-string values that are not null/undefined', () => {
    expect(checkLoadSampleGate(123 as unknown).ok).toBe(false);
    expect(checkLoadSampleGate({} as unknown).ok).toBe(false);
    expect(checkLoadSampleGate(true as unknown).ok).toBe(false);
  });
});

// ─── checkSinglePathGate (SEC-11) ─────────────────────────────────────────────

describe('checkSinglePathGate', () => {
  it('rejects when targetPath is absent or empty', () => {
    expect(checkSinglePathGate({ targetPath: undefined }, []).ok).toBe(false);
    expect(checkSinglePathGate({ targetPath: '' }, []).ok).toBe(false);
    expect(checkSinglePathGate({ targetPath: null }, []).ok).toBe(false);
  });

  it('rejects when no token supplied and path not in allowlist (SEC-11 core)', () => {
    const result = checkSinglePathGate(
      { targetPath: '/home/alice/NewVault' },
      ['/home/alice/OtherVault'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED_PATH');
  });

  it('rejects / and $HOME-style roots when allowlist does not include them', () => {
    expect(checkSinglePathGate({ targetPath: '/' }, ['/home/alice/Vault']).ok).toBe(false);
    expect(checkSinglePathGate({ targetPath: '/home/alice' }, ['/home/alice/Vault']).ok).toBe(false);
    expect(checkSinglePathGate({ targetPath: '/etc' }, ['/home/alice/Vault']).ok).toBe(false);
  });

  it('accepts a path that is in the recent-projects allowlist', () => {
    const result = checkSinglePathGate(
      { targetPath: '/home/alice/Vault' },
      ['/home/alice/Vault', '/home/alice/Other'],
    );
    expect(result).toEqual({ ok: true, targetPath: '/home/alice/Vault' });
  });

  it('accepts a path accompanied by a valid registration token bound to it', () => {
    const token = generateRegistrationToken('/home/alice/NewVault');
    const result = checkSinglePathGate(
      { targetPath: '/home/alice/NewVault', registrationToken: token },
      [],
    );
    expect(result).toEqual({ ok: true, targetPath: '/home/alice/NewVault' });
  });

  it('rejects a token bound to a different path (renderer-tampered targetPath)', () => {
    const token = generateRegistrationToken('/home/alice/PickedVault');
    const result = checkSinglePathGate(
      { targetPath: '/home/alice', registrationToken: token },
      [],
    );
    expect(result.ok).toBe(false);
    // Token must NOT have been consumed.
    expect(validateRegistrationToken(token, { consume: false })).not.toBeNull();
  });

  it('consumes the token on success so it cannot be replayed', () => {
    const token = generateRegistrationToken('/home/alice/NewVault');
    const first = checkSinglePathGate(
      { targetPath: '/home/alice/NewVault', registrationToken: token },
      [],
    );
    expect(first.ok).toBe(true);
    // Replay must fail — token is gone.
    const replay = checkSinglePathGate(
      { targetPath: '/home/alice/NewVault', registrationToken: token },
      [],
    );
    expect(replay.ok).toBe(false);
  });

  it('rejects expired tokens', () => {
    const now = Date.now();
    const token = generateRegistrationToken('/home/alice/Vault', now);
    const result = checkSinglePathGate(
      { targetPath: '/home/alice/Vault', registrationToken: token },
      [],
      now + TOKEN_TTL_MS + 1,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects empty allowlist with no token', () => {
    expect(checkSinglePathGate({ targetPath: '/home/alice/Vault' }, []).ok).toBe(false);
  });
});

// ─── §3 checkScaffoldGate (SKY-780) ───────────────────────────────────────────

describe('checkScaffoldGate', () => {
  it('rejects missing or empty templateId', () => {
    const token = generateRegistrationToken('/home/alice/projects');
    expect(checkScaffoldGate({ templateId: '', parentToken: token }).ok).toBe(false);
    expect(checkScaffoldGate({ templateId: undefined, parentToken: token }).ok).toBe(false);
    expect(checkScaffoldGate({ templateId: 123 as unknown, parentToken: token }).ok).toBe(false);
  });

  it('rejects missing or empty parentToken', () => {
    const r1 = checkScaffoldGate({ templateId: 'bundled:novel-3act', parentToken: '' });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/parentToken/);

    const r2 = checkScaffoldGate({ templateId: 'bundled:novel-3act', parentToken: undefined });
    expect(r2.ok).toBe(false);
  });

  it('rejects an invalid parentToken (SKY-780 attack: arbitrary path without dialog)', () => {
    // Core attack: renderer sends an attacker-controlled path string instead of
    // a real token. The gate must reject it.
    const r = checkScaffoldGate({ templateId: 'bundled:novel-3act', parentToken: '/home/alice/arbitrary-dir' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid or expired/);
  });

  it('rejects an expired parentToken', () => {
    const now = Date.now();
    const token = generateRegistrationToken('/home/alice/projects', now);
    const r = checkScaffoldGate({ templateId: 'bundled:novel-3act', parentToken: token }, now + TOKEN_TTL_MS + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid or expired/);
  });

  it('accepts a valid parentToken and returns the parent path', () => {
    const token = generateRegistrationToken('/home/alice/projects');
    const r = checkScaffoldGate({ templateId: 'bundled:novel-3act', parentToken: token });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.parentPath).toBe('/home/alice/projects');
  });

  it('consumes the token on success — replay is rejected', () => {
    const token = generateRegistrationToken('/home/alice/projects');
    const first = checkScaffoldGate({ templateId: 'bundled:novel-3act', parentToken: token });
    expect(first.ok).toBe(true);
    const replay = checkScaffoldGate({ templateId: 'bundled:novel-3act', parentToken: token });
    expect(replay.ok).toBe(false);
  });
});
