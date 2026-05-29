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
});
