// Beta 4 M5 — agent chat sessions as files in the vault.
//
// The storage rule (overview, owner-ratified 2026-07-10): agent chat sessions
// are USER WORK and must live as files inside the vault so they survive vault
// copy and Dropbox sync. v0.4 kept transcripts only in renderer memory —
// nothing durable existed. M5 establishes the durable store; M15 (agent hub +
// sessions, "session store (M5 files)") builds its UI on it.
//
// Location: `Notes Vault/Sessions/<ISO-date> <Agent> <shortid>.md` — the
// prototype's notes tree ships a `Sessions/` folder, and markdown transcripts
// read cleanly in Obsidian. Each turn is fenced by an HTML comment marker so
// the file is machine-parseable without sacrificing readability.
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFrontmatter, serializeFrontmatter, writeFileAtomic } from '../vault.js';

export const SESSIONS_DIRNAME = 'Sessions';

export type SessionAgent = 'brainstorm' | 'writing-assistant' | 'archive' | 'beta-reader' | 'coach';

export interface SessionTurn {
  role: 'user' | 'agent';
  text: string;
  at: string;
}

export interface AgentSessionFile {
  id: string;
  agent: SessionAgent | string;
  title?: string;
  startedAt: string;
  updatedAt: string;
  turns: SessionTurn[];
}

export interface AgentSessionSummary {
  id: string;
  agent: string;
  title?: string;
  startedAt: string;
  updatedAt: string;
  turnCount: number;
  /** Notes-Vault-relative path of the session file. */
  relPath: string;
}

const TURN_OPEN_RE = /^<!-- mythos:turn (user|agent) ([^>]*?) -->$/;
const TURN_CLOSE = '<!-- /mythos:turn -->';

export function sessionsDir(notesVaultRoot: string): string {
  return path.join(notesVaultRoot, SESSIONS_DIRNAME);
}

function sessionFileName(session: { startedAt: string; agent: string; id: string }): string {
  const day = session.startedAt.slice(0, 10) || 'undated';
  const agent = session.agent.replace(/[^a-z0-9-]/gi, '') || 'agent';
  const shortId = session.id.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'session';
  return `${day} ${agent} ${shortId}.md`;
}

export function serializeSessionFile(session: AgentSessionFile): string {
  const fm: Record<string, unknown> = {
    mythosSession: 1,
    id: session.id,
    agent: session.agent,
    ...(session.title ? { title: session.title.replace(/[\r\n]+/g, ' ') } : {}),
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    turns: session.turns.length,
  };
  const body: string[] = [`# ${session.title ?? `${session.agent} session`}`, ''];
  for (const turn of session.turns) {
    body.push(`<!-- mythos:turn ${turn.role} ${turn.at} -->`);
    body.push(turn.role === 'user' ? '**You:**' : '**Agent:**', '');
    // Guard the fence: a literal close marker inside a turn would truncate it.
    body.push(turn.text.split(TURN_CLOSE).join('<!- /mythos:turn ->'));
    body.push(TURN_CLOSE, '');
  }
  return serializeFrontmatter(fm, body.join('\n'));
}

export function parseSessionFile(raw: string, relPath = ''): AgentSessionFile | null {
  const { frontmatter, prose } = parseFrontmatter(raw);
  if (frontmatter.mythosSession === undefined) return null;
  const id = typeof frontmatter.id === 'string' && frontmatter.id ? frontmatter.id : '';
  if (!id) return null;
  const turns: SessionTurn[] = [];
  const lines = prose.split('\n');
  let current: { role: 'user' | 'agent'; at: string; buf: string[] } | null = null;
  for (const line of lines) {
    const open = TURN_OPEN_RE.exec(line.trim());
    if (open) {
      current = { role: open[1] as 'user' | 'agent', at: open[2].trim(), buf: [] };
      continue;
    }
    if (line.trim() === TURN_CLOSE) {
      if (current) {
        // Drop the leading speaker label + blank line the serializer added.
        const buf = [...current.buf];
        if (buf[0] === '**You:**' || buf[0] === '**Agent:**') buf.shift();
        while (buf.length > 0 && buf[0].trim() === '') buf.shift();
        while (buf.length > 0 && buf[buf.length - 1].trim() === '') buf.pop();
        turns.push({ role: current.role, at: current.at, text: buf.join('\n') });
      }
      current = null;
      continue;
    }
    if (current) current.buf.push(line);
  }
  return {
    id,
    agent: typeof frontmatter.agent === 'string' && frontmatter.agent ? frontmatter.agent : 'agent',
    ...(typeof frontmatter.title === 'string' && frontmatter.title
      ? { title: frontmatter.title }
      : {}),
    startedAt:
      typeof frontmatter.startedAt === 'string' && frontmatter.startedAt
        ? frontmatter.startedAt
        : new Date(0).toISOString(),
    updatedAt:
      typeof frontmatter.updatedAt === 'string' && frontmatter.updatedAt
        ? frontmatter.updatedAt
        : new Date(0).toISOString(),
    turns,
  };
}

export interface CreateSessionOptions {
  agent: SessionAgent | string;
  title?: string;
  turns?: SessionTurn[];
  id?: string;
  startedAt?: string;
}

/** Create a new session file. Returns the stored session + its relative path. */
export function createSession(
  notesVaultRoot: string,
  opts: CreateSessionOptions,
): { session: AgentSessionFile; relPath: string } {
  const startedAt = opts.startedAt ?? new Date().toISOString();
  const session: AgentSessionFile = {
    id: opts.id ?? crypto.randomUUID(),
    agent: opts.agent,
    ...(opts.title ? { title: opts.title } : {}),
    startedAt,
    updatedAt: startedAt,
    turns: opts.turns ?? [],
  };
  const relPath = path.posix.join(SESSIONS_DIRNAME, sessionFileName(session));
  writeFileAtomic(path.join(notesVaultRoot, relPath), serializeSessionFile(session));
  return { session, relPath };
}

/** Append turns to an existing session file (looked up by id). */
export function appendTurns(
  notesVaultRoot: string,
  sessionId: string,
  turns: SessionTurn[],
): AgentSessionFile | null {
  const found = findSessionFile(notesVaultRoot, sessionId);
  if (!found) return null;
  const session = found.session;
  session.turns.push(...turns);
  session.updatedAt = new Date().toISOString();
  writeFileAtomic(path.join(notesVaultRoot, found.relPath), serializeSessionFile(session));
  return session;
}

function findSessionFile(
  notesVaultRoot: string,
  sessionId: string,
): { session: AgentSessionFile; relPath: string } | null {
  const dir = sessionsDir(notesVaultRoot);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf-8');
      const session = parseSessionFile(raw);
      if (session && session.id === sessionId) {
        return { session, relPath: path.posix.join(SESSIONS_DIRNAME, name) };
      }
    } catch {
      /* skip unreadable */
    }
  }
  return null;
}

export function readSession(notesVaultRoot: string, sessionId: string): AgentSessionFile | null {
  return findSessionFile(notesVaultRoot, sessionId)?.session ?? null;
}

/** All sessions, newest-updated first. */
export function listSessions(notesVaultRoot: string): AgentSessionSummary[] {
  const dir = sessionsDir(notesVaultRoot);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: AgentSessionSummary[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf-8');
      const session = parseSessionFile(raw);
      if (!session) continue;
      out.push({
        id: session.id,
        agent: session.agent,
        ...(session.title ? { title: session.title } : {}),
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        turnCount: session.turns.length,
        relPath: path.posix.join(SESSIONS_DIRNAME, name),
      });
    } catch {
      /* skip unreadable */
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}
