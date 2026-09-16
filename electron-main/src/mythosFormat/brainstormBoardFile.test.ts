// SKY-11360 — brainstorm/idea board persistence in the Agent Vault, and the
// one-shot migration off the Notes Vault (where the JSON blob used to leak into
// the user's notes tree).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BRAINSTORM_BOARD_RELPATH,
  readBrainstormBoard,
  writeBrainstormBoard,
  migrateBrainstormBoardToAgentVault,
} from './brainstormBoardFile.js';
import {
  agentVaultRootFor,
  notesVaultRootFor,
  NOTES_VAULT_DIRNAME,
  AGENT_VAULT_DIRNAME,
} from './mythosJson.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bsboard-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const POPULATED_BOARD = JSON.stringify({
  version: 1,
  draftMigrated: true,
  cards: [
    { id: 'bsc-mtlxtpiv-1-ez1m2', cat: 'beats', text: 'The gate opens', x: 10, y: 20 },
    { id: 'bsc-mtlxtpiv-2-abc', cat: 'character', text: 'Mira', x: 300, y: 90 },
  ],
  links: [{ from: 'bsc-mtlxtpiv-1-ez1m2', to: 'bsc-mtlxtpiv-2-abc' }],
});

const legacyBoardPath = (mythosRoot: string) =>
  path.join(notesVaultRootFor(mythosRoot), 'Boards', 'brainstorm.board.json');
const agentBoardPath = (mythosRoot: string) =>
  path.join(agentVaultRootFor(mythosRoot), BRAINSTORM_BOARD_RELPATH);

describe('brainstormBoardFile read/write', () => {
  it('is stored under Boards/ in the Agent Vault', () => {
    expect(BRAINSTORM_BOARD_RELPATH).toBe('Boards/brainstorm.board.json');
  });

  it('round-trips a populated board through the Agent Vault', () => {
    const agentRoot = path.join(tmp, AGENT_VAULT_DIRNAME);
    fs.mkdirSync(agentRoot, { recursive: true });

    const wrote = writeBrainstormBoard(agentRoot, POPULATED_BOARD);
    expect('bytes' in wrote).toBe(true);

    const read = readBrainstormBoard(agentRoot);
    expect(read).toEqual({ content: POPULATED_BOARD });
  });

  it('returns an error (not a throw) when no board exists yet', () => {
    const agentRoot = path.join(tmp, AGENT_VAULT_DIRNAME);
    fs.mkdirSync(agentRoot, { recursive: true });
    expect('error' in readBrainstormBoard(agentRoot)).toBe(true);
  });
});

describe('migrateBrainstormBoardToAgentVault', () => {
  it('moves a populated notes-vault board into the Agent Vault with cards intact', () => {
    fs.mkdirSync(path.dirname(legacyBoardPath(tmp)), { recursive: true });
    fs.writeFileSync(legacyBoardPath(tmp), POPULATED_BOARD);

    const res = migrateBrainstormBoardToAgentVault(tmp);
    expect(res.migrated).toBe(true);

    // Gone from the notes vault; the leaked Boards/ folder is removed too.
    expect(fs.existsSync(legacyBoardPath(tmp))).toBe(false);
    expect(fs.existsSync(path.join(tmp, NOTES_VAULT_DIRNAME, 'Boards'))).toBe(false);

    // Present in the Agent Vault with every card preserved.
    expect(fs.existsSync(agentBoardPath(tmp))).toBe(true);
    const moved = JSON.parse(fs.readFileSync(agentBoardPath(tmp), 'utf-8'));
    expect(moved.cards).toHaveLength(2);
    expect(moved.cards[0].id).toBe('bsc-mtlxtpiv-1-ez1m2');
    expect(moved).toEqual(JSON.parse(POPULATED_BOARD));
  });

  it('is a no-op when there is no legacy board', () => {
    expect(migrateBrainstormBoardToAgentVault(tmp)).toEqual({ migrated: false });
    expect(fs.existsSync(agentBoardPath(tmp))).toBe(false);
  });

  it('leaves the notes-vault Boards/ folder when Scene Crafter boards live there', () => {
    // A user-created Scene Crafter board shares the Notes Vault Boards/ folder.
    const crafterBoard = path.join(
      notesVaultRootFor(tmp), 'Boards', 'my-story', 'The Gate.canvas.json',
    );
    fs.mkdirSync(path.dirname(crafterBoard), { recursive: true });
    fs.writeFileSync(crafterBoard, '{"nodes":[]}');
    fs.writeFileSync(legacyBoardPath(tmp), POPULATED_BOARD);

    expect(migrateBrainstormBoardToAgentVault(tmp).migrated).toBe(true);

    // Brainstorm board moved out; the user's Scene Crafter board + folder stay.
    expect(fs.existsSync(legacyBoardPath(tmp))).toBe(false);
    expect(fs.existsSync(crafterBoard)).toBe(true);
    expect(fs.existsSync(agentBoardPath(tmp))).toBe(true);
  });

  it('parks the legacy board beside an existing Agent-Vault board without overwriting', () => {
    // Agent Vault already has a board (a newer build wrote first).
    fs.mkdirSync(path.dirname(agentBoardPath(tmp)), { recursive: true });
    const existing = JSON.stringify({ version: 1, draftMigrated: true, cards: [], links: [] });
    fs.writeFileSync(agentBoardPath(tmp), existing);
    fs.mkdirSync(path.dirname(legacyBoardPath(tmp)), { recursive: true });
    fs.writeFileSync(legacyBoardPath(tmp), POPULATED_BOARD);

    expect(migrateBrainstormBoardToAgentVault(tmp).migrated).toBe(true);

    // Existing board untouched; legacy cards parked, not dropped.
    expect(fs.readFileSync(agentBoardPath(tmp), 'utf-8')).toBe(existing);
    const parked = path.join(agentVaultRootFor(tmp), 'Boards', 'brainstorm.board.legacy.json');
    expect(fs.existsSync(parked)).toBe(true);
    expect(fs.readFileSync(parked, 'utf-8')).toBe(POPULATED_BOARD);
    expect(fs.existsSync(legacyBoardPath(tmp))).toBe(false);
  });

  it('is idempotent — a second call after migration does nothing', () => {
    fs.mkdirSync(path.dirname(legacyBoardPath(tmp)), { recursive: true });
    fs.writeFileSync(legacyBoardPath(tmp), POPULATED_BOARD);
    expect(migrateBrainstormBoardToAgentVault(tmp).migrated).toBe(true);
    expect(migrateBrainstormBoardToAgentVault(tmp).migrated).toBe(false);
    expect(fs.readFileSync(agentBoardPath(tmp), 'utf-8')).toBe(POPULATED_BOARD);
  });
});
