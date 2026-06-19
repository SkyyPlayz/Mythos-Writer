import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  STORY_VAULT_GUARD_ERROR,
  buildFrontmatter,
  dismissPendingBrainstormProposals,
  findNotesVaultNoteByName,
  renderProposalMarkdown,
  resolveProposalDestination,
  writeNoteProposal,
} from './brainstormNoteWriter.js';
import { closeDb, getSuggestion, openDb, upsertSuggestion, type DbSuggestion } from './db.js';
import type { NoteProposal } from './brainstormAgent.js';

const NOW = '2026-06-15T12:00:00.000Z';

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeProposal(overrides: Partial<NoteProposal> = {}): NoteProposal {
  return {
    id: 'proposal-1',
    kind: 'character',
    title: 'Lyra Storm',
    destinationPath: 'Universes/Argent/Characters/Lyra Storm.md',
    body: 'A healer who refuses the throne.',
    frontmatter: {
      aliases: ['Stormlight'],
      role: 'healer',
      first_appearance_scene: '',
      ignored_empty: '',
    },
    sourceConversationTurnId: 'turn-7',
    extractionConfidence: 0.91,
    status: 'pending',
    ...overrides,
  };
}

describe('resolveProposalDestination', () => {
  it('routes faction proposals through the active universe', () => {
    const result = resolveProposalDestination({
      kind: 'faction',
      title: 'Red Conclave',
      notesVaultRoot: '/notes',
      activeUniverse: 'Argent',
    });

    expect(result).toEqual({
      status: 'resolved',
      destinationPath: 'Universes/Argent/Factions/Red Conclave.md',
    });
  });

  it('routes scene cards through the active story', () => {
    const result = resolveProposalDestination({
      kind: 'scene_card',
      title: 'Refuse the Mission',
      notesVaultRoot: '/notes',
      activeStory: 'Glass Library',
    });

    expect(result).toEqual({
      status: 'resolved',
      destinationPath: 'Stories/Glass Library/Refuse the Mission.md',
    });
  });

  it('auto-resolves a single universe folder when no universe is selected', () => {
    const notesRoot = makeTmp('mythos-notes-route-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Universes', 'Argent', 'Characters'), { recursive: true });

      const result = resolveProposalDestination({
        kind: 'character',
        title: 'Lyra Storm',
        notesVaultRoot: notesRoot,
      });

      expect(result).toEqual({
        status: 'resolved',
        destinationPath: 'Universes/Argent/Characters/Lyra Storm.md',
      });
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('routes location proposals through the active universe (AC-BST-10)', () => {
    const result = resolveProposalDestination({
      kind: 'location',
      title: 'The Iron Gate',
      notesVaultRoot: '/notes',
      activeUniverse: 'Argent',
    });

    expect(result).toEqual({
      status: 'resolved',
      destinationPath: 'Universes/Argent/Locations/The Iron Gate.md',
    });
  });

  it('routes item proposals through the active universe (AC-BST-10)', () => {
    const result = resolveProposalDestination({
      kind: 'item',
      title: 'Moonblade',
      notesVaultRoot: '/notes',
      activeUniverse: 'Argent',
    });

    expect(result).toEqual({
      status: 'resolved',
      destinationPath: 'Universes/Argent/Items/Moonblade.md',
    });
  });

  it('falls back to Inbox with suggested_destination when universe is ambiguous (AC-BST-11)', () => {
    const notesRoot = makeTmp('mythos-notes-route-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Universes', 'Argent'), { recursive: true });
      fs.mkdirSync(path.join(notesRoot, 'Universes', 'Umber'), { recursive: true });

      const result = resolveProposalDestination({
        kind: 'character',
        title: 'Lyra Storm',
        notesVaultRoot: notesRoot,
      });

      expect(result).toEqual({
        status: 'resolved',
        destinationPath: 'Inbox/Lyra Storm.md',
        suggestedDestination: 'Universes/<active-universe>/Characters/Lyra Storm.md',
      });
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('Inbox fallback covers all four world kinds when universe is ambiguous (AC-BST-11)', () => {
    const notesRoot = makeTmp('mythos-notes-route-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Universes', 'A'), { recursive: true });
      fs.mkdirSync(path.join(notesRoot, 'Universes', 'B'), { recursive: true });

      for (const [kind, dir] of [
        ['character', 'Characters'],
        ['location', 'Locations'],
        ['item', 'Items'],
        ['faction', 'Factions'],
      ] as const) {
        const result = resolveProposalDestination({ kind, title: 'X', notesVaultRoot: notesRoot });
        expect(result.status).toBe('resolved');
        if (result.status !== 'resolved') throw new Error('unreachable');
        expect(result.destinationPath).toBe('Inbox/X.md');
        expect(result.suggestedDestination).toBe(`Universes/<active-universe>/${dir}/X.md`);
      }
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('routes ambiguous scene cards to Inbox with suggested_destination when multiple stories exist', () => {
    const notesRoot = makeTmp('mythos-notes-route-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Stories', 'Glass Library'), { recursive: true });
      fs.mkdirSync(path.join(notesRoot, 'Stories', 'Starfall'), { recursive: true });

      const result = resolveProposalDestination({
        kind: 'scene_card',
        title: 'Refuse the Mission',
        notesVaultRoot: notesRoot,
      });

      expect(result).toEqual({
        status: 'resolved',
        destinationPath: 'Inbox/Refuse the Mission.md',
        suggestedDestination: 'Stories/<active-story>/Refuse the Mission.md',
      });
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('returns existing_note_match when a note with the same name already exists (AC-BST-06)', () => {
    const notesRoot = makeTmp('mythos-notes-route-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Universes', 'Argent', 'Characters'), { recursive: true });
      fs.writeFileSync(path.join(notesRoot, 'Universes', 'Argent', 'Characters', 'Lyra Storm.md'), '# Lyra Storm\n', 'utf-8');

      const result = resolveProposalDestination({
        kind: 'character',
        title: 'Lyra Storm',
        notesVaultRoot: notesRoot,
        activeUniverse: 'Argent',
      });

      expect(result).toEqual({
        status: 'existing_note_match',
        existingPath: 'Universes/Argent/Characters/Lyra Storm.md',
      });
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('existing-note detection is case-insensitive (AC-BST-06)', () => {
    const notesRoot = makeTmp('mythos-notes-route-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Characters'), { recursive: true });
      fs.writeFileSync(path.join(notesRoot, 'Characters', 'lyra storm.md'), '# lyra storm\n', 'utf-8');

      const result = resolveProposalDestination({
        kind: 'character',
        title: 'Lyra Storm',
        notesVaultRoot: notesRoot,
        activeUniverse: 'Argent',
      });

      expect(result).toEqual({
        status: 'existing_note_match',
        existingPath: 'Characters/lyra storm.md',
      });
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('no existing-note match when vault is empty — proceeds to normal routing (AC-BST-06)', () => {
    const notesRoot = makeTmp('mythos-notes-route-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Universes', 'Argent', 'Characters'), { recursive: true });

      const result = resolveProposalDestination({
        kind: 'character',
        title: 'New Character',
        notesVaultRoot: notesRoot,
        activeUniverse: 'Argent',
      });

      expect(result).toEqual({
        status: 'resolved',
        destinationPath: 'Universes/Argent/Characters/New Character.md',
      });
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });
});

describe('findNotesVaultNoteByName', () => {
  it('returns null when the vault is empty', () => {
    const notesRoot = makeTmp('mythos-notes-find-');
    try {
      expect(findNotesVaultNoteByName(notesRoot, 'Aria Voss')).toBeNull();
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('returns null when the vault does not exist', () => {
    expect(findNotesVaultNoteByName('/non-existent-vault-path', 'Aria')).toBeNull();
  });

  it('finds a note by exact name match', () => {
    const notesRoot = makeTmp('mythos-notes-find-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Characters'), { recursive: true });
      fs.writeFileSync(path.join(notesRoot, 'Characters', 'Aria Voss.md'), '', 'utf-8');

      expect(findNotesVaultNoteByName(notesRoot, 'Aria Voss')).toBe('Characters/Aria Voss.md');
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('matches case-insensitively', () => {
    const notesRoot = makeTmp('mythos-notes-find-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Chars'), { recursive: true });
      fs.writeFileSync(path.join(notesRoot, 'Chars', 'aria voss.md'), '', 'utf-8');

      expect(findNotesVaultNoteByName(notesRoot, 'Aria Voss')).toBe('Chars/aria voss.md');
      expect(findNotesVaultNoteByName(notesRoot, 'aria voss')).toBe('Chars/aria voss.md');
      expect(findNotesVaultNoteByName(notesRoot, 'ARIA VOSS')).toBe('Chars/aria voss.md');
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('returns null for partial name matches', () => {
    const notesRoot = makeTmp('mythos-notes-find-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Chars'), { recursive: true });
      fs.writeFileSync(path.join(notesRoot, 'Chars', 'Aria Voss the Elder.md'), '', 'utf-8');

      expect(findNotesVaultNoteByName(notesRoot, 'Aria Voss')).toBeNull();
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('skips hidden directories during the walk', () => {
    const notesRoot = makeTmp('mythos-notes-find-');
    try {
      fs.mkdirSync(path.join(notesRoot, '.brainstorm-staging'), { recursive: true });
      fs.writeFileSync(path.join(notesRoot, '.brainstorm-staging', 'Aria Voss.md'), '', 'utf-8');

      expect(findNotesVaultNoteByName(notesRoot, 'Aria Voss')).toBeNull();
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });

  it('finds a note nested multiple levels deep', () => {
    const notesRoot = makeTmp('mythos-notes-find-');
    try {
      fs.mkdirSync(path.join(notesRoot, 'Universes', 'Argent', 'Characters'), { recursive: true });
      fs.writeFileSync(path.join(notesRoot, 'Universes', 'Argent', 'Characters', 'Lyra Storm.md'), '', 'utf-8');

      expect(findNotesVaultNoteByName(notesRoot, 'Lyra Storm')).toBe('Universes/Argent/Characters/Lyra Storm.md');
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
    }
  });
});

describe('buildFrontmatter', () => {
  it('adds universal provenance and omits empty proposal fields', () => {
    expect(buildFrontmatter(makeProposal(), NOW)).toEqual({
      aliases: ['Stormlight'],
      role: 'healer',
      created_by: 'brainstorm_agent',
      created_at: NOW,
      source_turn_id: 'turn-7',
    });
  });

  it('adds scene-card suggested destination when routed to inbox', () => {
    const fm = buildFrontmatter(
      makeProposal({ kind: 'scene_card', frontmatter: { story: '', beat_type: 'turning_point', related_characters: [] } }),
      NOW,
      'Stories/<active-story>/Refuse the Mission.md',
    );

    expect(fm).toEqual({
      beat_type: 'turning_point',
      suggested_destination: 'Stories/<active-story>/Refuse the Mission.md',
      created_by: 'brainstorm_agent',
      created_at: NOW,
      source_turn_id: 'turn-7',
    });
  });
});

describe('writeNoteProposal', () => {
  it('writes frontmatter plus body to the resolved Notes Vault path', () => {
    const notesRoot = makeTmp('mythos-notes-write-');
    const storyRoot = makeTmp('mythos-story-write-');
    try {
      const result = writeNoteProposal({
        proposal: makeProposal(),
        notesVaultRoot: notesRoot,
        storyVaultRoot: storyRoot,
        now: NOW,
      });

      expect(result).toEqual({ status: 'written', path: 'Universes/Argent/Characters/Lyra Storm.md' });
      const written = fs.readFileSync(path.join(notesRoot, result.path), 'utf-8');
      expect(written).toContain('created_by: brainstorm_agent');
      expect(written).toContain('source_turn_id: turn-7');
      expect(written).toContain('# Lyra Storm');
      expect(written).toContain('A healer who refuses the throne.');
      expect(written).not.toContain('ignored_empty:');
    } finally {
      fs.rmSync(notesRoot, { recursive: true, force: true });
      fs.rmSync(storyRoot, { recursive: true, force: true });
    }
  });

  it('throws STORY_VAULT_GUARD_ERROR and creates no file when destination escapes into Story Vault', () => {
    const root = makeTmp('mythos-root-');
    const notesRoot = path.join(root, 'Notes Vault');
    const storyRoot = path.join(root, 'Story Vault');
    fs.mkdirSync(notesRoot, { recursive: true });
    fs.mkdirSync(storyRoot, { recursive: true });
    try {
      expect(() => writeNoteProposal({
        proposal: makeProposal({ destinationPath: '../Story Vault/Manuscript/Lyra.md' }),
        notesVaultRoot: notesRoot,
        storyVaultRoot: storyRoot,
        now: NOW,
      })).toThrow(STORY_VAULT_GUARD_ERROR);
      expect(fs.existsSync(path.join(storyRoot, 'Manuscript', 'Lyra.md'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('dismissPendingBrainstormProposals', () => {
  it('rejects only pending brainstorm proposal rows', () => {
    const vault = makeTmp('mythos-proposals-db-');
    openDb(vault);
    try {
      const base: DbSuggestion = {
        id: 'pending-proposal',
        source_agent: 'brainstorm',
        confidence: 0.9,
        rationale: 'proposal',
        target_kind: 'vault',
        target_path: 'Inbox/A.md',
        target_anchor: null,
        payload_json: '{}',
        status: 'proposed',
        created_at: NOW,
        applied_at: null,
        applied_run_id: null,
        budget_exceeded: 0,
        category: 'other',
        note_kind: 'character',
        destination_path: 'Inbox/A.md',
      };
      upsertSuggestion(base);
      upsertSuggestion({ ...base, id: 'already-rejected', status: 'rejected' });
      upsertSuggestion({ ...base, id: 'non-proposal', note_kind: null, status: 'proposed' });

      expect(dismissPendingBrainstormProposals(NOW)).toEqual({ rejectedCount: 1 });

      expect(getSuggestion('pending-proposal')?.status).toBe('rejected');
      expect(getSuggestion('pending-proposal')?.applied_at).toBe(NOW);
      expect(getSuggestion('already-rejected')?.status).toBe('rejected');
      expect(getSuggestion('non-proposal')?.status).toBe('proposed');
    } finally {
      closeDb();
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe('renderProposalMarkdown', () => {
  it('serializes arrays and strings in a YAML-safe frontmatter block', () => {
    const markdown = renderProposalMarkdown(makeProposal(), NOW);

    expect(markdown).toContain('aliases:');
    expect(markdown).toContain('  - Stormlight');
    expect(markdown).toContain('role: healer');
    expect(markdown).toContain('---\n# Lyra Storm');
  });
});
