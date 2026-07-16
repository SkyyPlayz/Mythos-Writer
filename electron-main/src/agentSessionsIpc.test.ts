// SKY-6228 (M15): Unit tests for the agentSession:* IPC handler logic
// (PR #917 review, B2). These handlers rename/duplicate/delete/overwrite files
// in the user's Notes Vault, so they run here against a real temp-dir vault.
//
// Includes the B1 regression: session lookup must resolve files by the PARSED
// frontmatter `session.id`, never by a substring scan over the raw file body —
// a transcript that merely *mentions* another session's id (e.g. a user or
// agent pasting `id: <uuid>` into chat) must never cause rename/delete to
// touch the wrong file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  handleAgentSessionList,
  handleAgentSessionCreate,
  handleAgentSessionRename,
  handleAgentSessionDuplicate,
  handleAgentSessionDelete,
  handleAgentSessionAppendTurns,
} from './agentSessionsIpc.js';
import {
  createSession,
  readSession,
  sessionsDir,
  SESSIONS_DIRNAME,
} from './mythosFormat/agentSessions.js';
import type { SessionTurn } from './mythosFormat/agentSessions.js';

const A_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const B_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-agent-sessions-ipc-'));
}

function cleanDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function sessionFiles(notesRoot: string): string[] {
  return fs.readdirSync(sessionsDir(notesRoot)).filter((n) => n.endsWith('.md')).sort();
}

function turn(role: 'user' | 'agent', text: string, at = '2026-07-01T10:00:00.000Z'): SessionTurn {
  return { role, text, at };
}

/**
 * B1 regression fixture: two sessions where A's transcript contains the
 * literal text `id: <B's-uuid>` — exactly what a user pasting a session id
 * into chat produces. A is created FIRST so a readdir-order body-text scan
 * encounters the poisoned file before the real one.
 */
function makePoisonedVault(notesRoot: string): { aAbs: string; bAbs: string; aBytes: Buffer } {
  const a = createSession(notesRoot, {
    agent: 'brainstorm',
    title: 'Poisoned transcript',
    id: A_ID,
    startedAt: '2026-07-01T10:00:00.000Z',
    turns: [turn('user', `Earlier you gave me a session with id: ${B_ID} — can you reopen it?`)],
  });
  const b = createSession(notesRoot, {
    agent: 'brainstorm',
    title: 'Target session',
    id: B_ID,
    startedAt: '2026-07-02T10:00:00.000Z',
    turns: [turn('agent', 'Target session body.', '2026-07-02T10:00:00.000Z')],
  });
  const aAbs = path.join(notesRoot, a.relPath);
  const bAbs = path.join(notesRoot, b.relPath);
  return { aAbs, bAbs, aBytes: fs.readFileSync(aAbs) };
}

let notesRoot: string;

beforeEach(() => { notesRoot = makeTmpDir(); });
afterEach(() => { cleanDir(notesRoot); });

// ─── agentSession:list ────────────────────────────────────────────────────────

describe('handleAgentSessionList', () => {
  it('returns an empty list when the Sessions/ dir does not exist', () => {
    expect(handleAgentSessionList(notesRoot, {})).toEqual({ sessions: [] });
  });

  it('lists sessions newest-updated first with turn counts and relPaths', () => {
    createSession(notesRoot, {
      agent: 'brainstorm', id: A_ID, startedAt: '2026-07-01T10:00:00.000Z',
      turns: [turn('user', 'hi'), turn('agent', 'hello')],
    });
    createSession(notesRoot, { agent: 'coach', id: B_ID, startedAt: '2026-07-02T10:00:00.000Z' });

    const { sessions } = handleAgentSessionList(notesRoot, {});
    expect(sessions.map((s) => s.id)).toEqual([B_ID, A_ID]);
    expect(sessions[1].turnCount).toBe(2);
    for (const s of sessions) expect(s.relPath.startsWith(`${SESSIONS_DIRNAME}/`)).toBe(true);
  });

  it('filters by agent when payload.agent is set', () => {
    createSession(notesRoot, { agent: 'brainstorm', id: A_ID });
    createSession(notesRoot, { agent: 'coach', id: B_ID });
    const { sessions } = handleAgentSessionList(notesRoot, { agent: 'coach' });
    expect(sessions.map((s) => s.id)).toEqual([B_ID]);
  });
});

// ─── agentSession:create ──────────────────────────────────────────────────────

describe('handleAgentSessionCreate', () => {
  it('writes a parseable session file into Sessions/ and returns it', () => {
    const { session, relPath } = handleAgentSessionCreate(notesRoot, { agent: 'brainstorm', title: 'My chat' });
    expect(relPath.startsWith(`${SESSIONS_DIRNAME}/`)).toBe(true);
    expect(fs.existsSync(path.join(notesRoot, relPath))).toBe(true);

    const onDisk = readSession(notesRoot, session.id);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.agent).toBe('brainstorm');
    expect(onDisk!.title).toBe('My chat');
    expect(onDisk!.turns).toEqual([]);
  });

  it('stores a greeting as a single agent turn', () => {
    const { session } = handleAgentSessionCreate(notesRoot, { agent: 'coach', greeting: 'Welcome back!' });
    const onDisk = readSession(notesRoot, session.id);
    expect(onDisk!.turns).toHaveLength(1);
    expect(onDisk!.turns[0].role).toBe('agent');
    expect(onDisk!.turns[0].text).toBe('Welcome back!');
  });
});

// ─── agentSession:rename ──────────────────────────────────────────────────────

describe('handleAgentSessionRename', () => {
  it('persists the new title and bumps updatedAt', () => {
    createSession(notesRoot, { agent: 'brainstorm', id: A_ID, title: 'Old', startedAt: '2026-07-01T10:00:00.000Z' });
    expect(handleAgentSessionRename(notesRoot, { sessionId: A_ID, title: 'New title' })).toEqual({ ok: true });
    const onDisk = readSession(notesRoot, A_ID);
    expect(onDisk!.title).toBe('New title');
    expect(onDisk!.updatedAt > '2026-07-01T10:00:00.000Z').toBe(true);
  });

  it('flattens newlines in the title and keeps the old title when the new one is blank', () => {
    createSession(notesRoot, { agent: 'brainstorm', id: A_ID, title: 'Old' });
    handleAgentSessionRename(notesRoot, { sessionId: A_ID, title: 'multi\nline' });
    expect(readSession(notesRoot, A_ID)!.title).toBe('multi line');
    handleAgentSessionRename(notesRoot, { sessionId: A_ID, title: '  \n ' });
    expect(readSession(notesRoot, A_ID)!.title).toBe('multi line');
  });

  it('returns ok:false for an unknown session id', () => {
    createSession(notesRoot, { agent: 'brainstorm', id: A_ID });
    expect(handleAgentSessionRename(notesRoot, { sessionId: B_ID, title: 'X' })).toEqual({ ok: false });
  });

  // B1 regression (PR #917): resolving the target by body-text substring scan
  // overwrote whichever file readdir yielded first that *mentioned* the id.
  it('renames ONLY the session whose parsed id matches, even when another transcript mentions that id', () => {
    const { aAbs, aBytes } = makePoisonedVault(notesRoot);

    expect(handleAgentSessionRename(notesRoot, { sessionId: B_ID, title: 'Renamed target' })).toEqual({ ok: true });

    // The poisoned bystander file must survive byte-identical …
    expect(fs.readFileSync(aAbs).equals(aBytes)).toBe(true);
    // … A must still resolve to A, and B must carry the new title.
    expect(readSession(notesRoot, A_ID)!.title).toBe('Poisoned transcript');
    expect(readSession(notesRoot, B_ID)!.title).toBe('Renamed target');
  });
});

// ─── agentSession:duplicate ───────────────────────────────────────────────────

describe('handleAgentSessionDuplicate', () => {
  it('copies turns into a new session file titled "<title> (copy)"', () => {
    createSession(notesRoot, {
      agent: 'brainstorm', id: A_ID, title: 'Original',
      turns: [turn('user', 'hi'), turn('agent', 'hello')],
    });
    const { session, relPath } = handleAgentSessionDuplicate(notesRoot, { sessionId: A_ID });
    expect(session.id).not.toBe(A_ID);
    expect(session.title).toBe('Original (copy)');
    expect(fs.existsSync(path.join(notesRoot, relPath))).toBe(true);

    const onDisk = readSession(notesRoot, session.id);
    expect(onDisk!.turns.map((t) => t.text)).toEqual(['hi', 'hello']);
    // Source untouched.
    expect(readSession(notesRoot, A_ID)!.title).toBe('Original');
    expect(sessionFiles(notesRoot)).toHaveLength(2);
  });

  it('throws for an unknown session id', () => {
    expect(() => handleAgentSessionDuplicate(notesRoot, { sessionId: B_ID })).toThrow(/not found/i);
  });
});

// ─── agentSession:delete ──────────────────────────────────────────────────────

describe('handleAgentSessionDelete', () => {
  it('deletes the session file and returns no replacement while others of that agent remain', () => {
    createSession(notesRoot, { agent: 'brainstorm', id: A_ID, startedAt: '2026-07-01T10:00:00.000Z' });
    const b = createSession(notesRoot, { agent: 'brainstorm', id: B_ID, startedAt: '2026-07-02T10:00:00.000Z' });

    expect(handleAgentSessionDelete(notesRoot, { sessionId: B_ID })).toEqual({ ok: true });
    expect(fs.existsSync(path.join(notesRoot, b.relPath))).toBe(false);
    expect(readSession(notesRoot, A_ID)).not.toBeNull();
  });

  it('auto-creates a replacement when the last session of an agent is deleted', () => {
    createSession(notesRoot, { agent: 'coach', id: A_ID });
    const res = handleAgentSessionDelete(notesRoot, { sessionId: A_ID });
    expect(res.ok).toBe(true);
    expect(res.replacement).toBeDefined();
    expect(res.replacement!.agent).toBe('coach');
    expect(res.replacementRelPath).toBeDefined();
    expect(fs.existsSync(path.join(notesRoot, res.replacementRelPath!))).toBe(true);
    expect(readSession(notesRoot, A_ID)).toBeNull();
  });

  it('returns ok:false for an unknown session id and deletes nothing', () => {
    createSession(notesRoot, { agent: 'brainstorm', id: A_ID });
    expect(handleAgentSessionDelete(notesRoot, { sessionId: B_ID })).toEqual({ ok: false });
    expect(sessionFiles(notesRoot)).toHaveLength(1);
  });

  // B1 regression (PR #917): the body-text substring scan deleted whichever
  // file readdir yielded first that contained `id: <target>` — including a
  // different session whose TRANSCRIPT merely mentioned the target's id.
  it('deletes ONLY the session whose parsed id matches, even when another transcript mentions that id', () => {
    const { aAbs, bAbs, aBytes } = makePoisonedVault(notesRoot);

    expect(handleAgentSessionDelete(notesRoot, { sessionId: B_ID })).toEqual({ ok: true });

    // B's file is gone …
    expect(fs.existsSync(bAbs)).toBe(false);
    expect(readSession(notesRoot, B_ID)).toBeNull();
    // … and the poisoned bystander survives byte-identical.
    expect(fs.existsSync(aAbs)).toBe(true);
    expect(fs.readFileSync(aAbs).equals(aBytes)).toBe(true);
    expect(readSession(notesRoot, A_ID)!.title).toBe('Poisoned transcript');
  });
});

// ─── agentSession:appendTurns ─────────────────────────────────────────────────

describe('handleAgentSessionAppendTurns', () => {
  it('appends turns, persists them, and bumps updatedAt', () => {
    createSession(notesRoot, {
      agent: 'brainstorm', id: A_ID, startedAt: '2026-07-01T10:00:00.000Z',
      turns: [turn('agent', 'greeting')],
    });
    const res = handleAgentSessionAppendTurns(notesRoot, {
      sessionId: A_ID,
      turns: [turn('user', 'question'), turn('agent', 'answer')],
    });
    expect(res.session).not.toBeNull();
    expect(res.session!.turns.map((t) => t.text)).toEqual(['greeting', 'question', 'answer']);

    const onDisk = readSession(notesRoot, A_ID);
    expect(onDisk!.turns).toHaveLength(3);
    expect(onDisk!.updatedAt > '2026-07-01T10:00:00.000Z').toBe(true);
  });

  it('returns session:null for an unknown session id', () => {
    expect(handleAgentSessionAppendTurns(notesRoot, { sessionId: B_ID, turns: [turn('user', 'x')] }))
      .toEqual({ session: null });
  });
});
