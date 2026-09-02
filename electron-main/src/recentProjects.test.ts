// SKY-11238: unit coverage for the stable-order recent-projects registry.
// The defect was purely positional (the rail reordered on switch), so these
// tests assert FULL order arrays before and after each operation — never just
// membership or which entry is active.

import { describe, it, expect } from 'vitest';
import type { ProjectEntry } from './ipc.js';
import { MAX_RECENT_PROJECTS, upsertRecentProject } from './recentProjects.js';

function entry(root: string, overrides?: Partial<ProjectEntry>): ProjectEntry {
  return {
    name: root.split('/').filter(Boolean).pop() ?? root,
    vaultRoot: root,
    notesVaultRoot: `${root}-notes`,
    openedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function order(list: ProjectEntry[]): string[] {
  return list.map((p) => p.vaultRoot);
}

describe('upsertRecentProject — position stability (the SKY-11238 defect)', () => {
  it('re-opening an existing vault does not move any entry', () => {
    const registry = [entry('/a'), entry('/b'), entry('/c')];
    const next = upsertRecentProject(registry, entry('/b', { openedAt: '2026-09-01T12:00:00.000Z' }));
    expect(order(next)).toEqual(['/a', '/b', '/c']);
  });

  it('a full switch tour leaves the order untouched at every step', () => {
    // The owner's exact scenario: keep switching — the rail must never move.
    let registry = [entry('/a'), entry('/b'), entry('/c')];
    for (const root of ['/c', '/a', '/b', '/a', '/c']) {
      registry = upsertRecentProject(registry, entry(root, { openedAt: '2026-09-01T13:00:00.000Z' }));
      expect(order(registry)).toEqual(['/a', '/b', '/c']);
    }
  });

  it('a never-seen vault appends at the end (registration order)', () => {
    const next = upsertRecentProject([entry('/a'), entry('/b')], entry('/c'));
    expect(order(next)).toEqual(['/a', '/b', '/c']);
  });

  it('does not mutate the input registry', () => {
    const registry = [entry('/a'), entry('/b')];
    const snapshot = registry.map((p) => ({ ...p }));
    upsertRecentProject(registry, entry('/a', { openedAt: '2026-09-01T12:00:00.000Z' }));
    upsertRecentProject(registry, entry('/z'));
    expect(registry).toEqual(snapshot);
  });
});

describe('upsertRecentProject — in-place refresh semantics', () => {
  it('refreshes openedAt, name, and notes pairing without moving the entry', () => {
    const registry = [entry('/a'), entry('/b', { name: 'old-name' }), entry('/c')];
    const next = upsertRecentProject(
      registry,
      entry('/b', { name: 'new-name', notesVaultRoot: '/b-new-notes', openedAt: '2026-09-01T12:00:00.000Z' }),
    );
    expect(order(next)).toEqual(['/a', '/b', '/c']);
    expect(next[1]).toEqual(entry('/b', {
      name: 'new-name',
      notesVaultRoot: '/b-new-notes',
      openedAt: '2026-09-01T12:00:00.000Z',
    }));
  });

  it('keeps the existing notes pairing when the caller passes none', () => {
    // The single-arg move call sites (main.ts vault-move callbacks) supply no
    // notes root — the pairing must survive, not collapse to undefined.
    const registry = [entry('/a')];
    const next = upsertRecentProject(registry, entry('/a', { notesVaultRoot: undefined }));
    expect(next[0].notesVaultRoot).toBe('/a-notes');
  });
});

describe('upsertRecentProject — previousRoot (vault moved on disk)', () => {
  it('rewrites the moved entry in place: same slot, new root, pairing kept', () => {
    const registry = [entry('/a'), entry('/b'), entry('/c')];
    const next = upsertRecentProject(
      registry,
      entry('/b-moved', { notesVaultRoot: undefined }),
      { previousRoot: '/b' },
    );
    expect(order(next)).toEqual(['/a', '/b-moved', '/c']);
    expect(next[1].notesVaultRoot).toBe('/b-notes');
  });

  it('leaves no ghost entry for the old path behind', () => {
    const next = upsertRecentProject([entry('/a'), entry('/b')], entry('/b-moved'), { previousRoot: '/b' });
    expect(order(next)).toEqual(['/a', '/b-moved']);
  });

  it('heals a stale leftover entry at the move target — the moved vault keeps ITS slot and pairing', () => {
    // A vault moved onto a path some dead registration still claims: the
    // previous-root entry is the vault being moved, so it wins; the stale
    // new-root entry's pairing belongs to a different vault and must not
    // leak onto the moved one.
    const registry = [entry('/a'), entry('/b'), entry('/b-moved', { notesVaultRoot: '/stale-notes' })];
    const next = upsertRecentProject(
      registry,
      entry('/b-moved', { notesVaultRoot: undefined }),
      { previousRoot: '/b' },
    );
    expect(order(next)).toEqual(['/a', '/b-moved']);
    expect(next[1].notesVaultRoot).toBe('/b-notes');
  });

  it('falls back to the new-root entry when previousRoot matches nothing', () => {
    // e.g. a re-fired move callback after the first already rewrote the root.
    const registry = [entry('/a'), entry('/b-moved')];
    const next = upsertRecentProject(registry, entry('/b-moved'), { previousRoot: '/gone' });
    expect(order(next)).toEqual(['/a', '/b-moved']);
  });

  it('appends when neither previousRoot nor the new root matches', () => {
    const next = upsertRecentProject([entry('/a')], entry('/b-moved'), { previousRoot: '/gone' });
    expect(order(next)).toEqual(['/a', '/b-moved']);
  });
});

describe('upsertRecentProject — corrupt-registry healing', () => {
  // loadVaultSettings does no sanitization, so a hand-edited or mangled
  // settings file can carry duplicates and over-cap lists; the old MRU code
  // self-healed the opened root and this must too.
  it('collapses duplicate entries for the upserted root to the one updated entry', () => {
    const registry = [entry('/x'), entry('/a'), entry('/x'), entry('/x')];
    const next = upsertRecentProject(registry, entry('/x', { openedAt: '2026-09-01T12:00:00.000Z' }));
    expect(order(next)).toEqual(['/x', '/a']);
    expect(next[0].openedAt).toBe('2026-09-01T12:00:00.000Z');
  });

  it('enforces the cap on an already-over-cap list, evicting oldest-first', () => {
    const registry = Array.from({ length: 20 }, (_, i) =>
      entry(`/v${i}`, { openedAt: `2026-09-01T00:${String(i).padStart(2, '0')}:00.000Z` }));
    const next = upsertRecentProject(registry, entry('/v10', { openedAt: '2026-09-01T12:00:00.000Z' }));
    expect(next).toHaveLength(MAX_RECENT_PROJECTS);
    // /v0../v3 were oldest (the upserted /v10 is immune).
    expect(order(next)).toEqual(
      Array.from({ length: 16 }, (_, i) => `/v${i + 4}`),
    );
  });
});

describe('upsertRecentProject — eviction over max', () => {
  it('evicts the least-recently-opened entry, not a positional one', () => {
    const registry = [
      entry('/a', { openedAt: '2026-09-01T03:00:00.000Z' }),
      entry('/b', { openedAt: '2026-09-01T01:00:00.000Z' }), // least recent
      entry('/c', { openedAt: '2026-09-01T02:00:00.000Z' }),
    ];
    const next = upsertRecentProject(registry, entry('/d', { openedAt: '2026-09-01T04:00:00.000Z' }), { max: 3 });
    expect(order(next)).toEqual(['/a', '/c', '/d']);
  });

  it('never evicts the entry being upserted, even when it is the oldest', () => {
    const registry = [
      entry('/a', { openedAt: '2026-09-01T02:00:00.000Z' }),
      entry('/b', { openedAt: '2026-09-01T03:00:00.000Z' }),
    ];
    const next = upsertRecentProject(registry, entry('/c', { openedAt: '2026-09-01T01:00:00.000Z' }), { max: 2 });
    expect(order(next)).toEqual(['/b', '/c']);
  });

  it('treats an unparsable openedAt as oldest', () => {
    const registry = [
      entry('/a', { openedAt: '2026-09-01T01:00:00.000Z' }),
      entry('/b', { openedAt: 'not-a-date' }),
    ];
    const next = upsertRecentProject(registry, entry('/c'), { max: 2 });
    expect(order(next)).toEqual(['/a', '/c']);
  });

  it('in-place updates never trigger eviction on a full registry', () => {
    const registry = Array.from({ length: MAX_RECENT_PROJECTS }, (_, i) => entry(`/v${i}`));
    const next = upsertRecentProject(registry, entry('/v5', { openedAt: '2026-09-01T12:00:00.000Z' }));
    expect(order(next)).toEqual(order(registry));
  });

  it('caps a fully-registered list by evicting once per overflow', () => {
    const registry = Array.from({ length: MAX_RECENT_PROJECTS }, (_, i) =>
      entry(`/v${i}`, { openedAt: `2026-09-01T00:${String(i).padStart(2, '0')}:00.000Z` }));
    const next = upsertRecentProject(registry, entry('/new', { openedAt: '2026-09-01T12:00:00.000Z' }));
    expect(next).toHaveLength(MAX_RECENT_PROJECTS);
    expect(order(next)).not.toContain('/v0'); // oldest evicted
    expect(order(next)).toContain('/new');
    // Everyone else kept their relative order.
    expect(order(next)).toEqual([
      ...Array.from({ length: MAX_RECENT_PROJECTS - 1 }, (_, i) => `/v${i + 1}`),
      '/new',
    ]);
  });
});
