// Beta 4 M5 — agent chat sessions as files in the vault.
//
// The storage rule (overview, owner-ratified 2026-07-10): agent chat sessions
// are USER WORK and must live as files inside the vault so they survive vault
// copy and Dropbox sync. v0.4 kept transcripts only in renderer memory —
// nothing durable existed. M5 establishes the durable store; M15 (agent hub +
// sessions, "session store (M5 files)") builds its UI on it.
//
// Location: `Agent Vault/Sessions/<ISO-date> <Agent> <shortid>.md`.
//
// SUPERSEDED 2026-08-19 (SKY-10952, owner ruling under SKY-10949): sessions
// originally lived at `Notes Vault/Sessions/`, mirroring the prototype's
// notes tree (which ships a visible `Sessions/` folder there). That put
// machine state in the user-content tree. Agent Vault is now a third
// top-level MythosVault sibling for machine state, so a later fidelity pass
// against the prototype must NOT restore the Notes Vault location.
// migrateSessionsToAgentVault() below moves any pre-existing
// `Notes Vault/Sessions/` contents for vaults created before this change.
//
// Functions here are root-agnostic (the caller passes whichever vault root
// the sessions currently live under) except migrateSessionsToAgentVault,
// which knows about both roots.
//
// Pure Node.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFrontmatter, serializeFrontmatter, renameSyncWithRetry, writeFileAtomic } from '../vault.js';
import { agentVaultRootFor } from './mythosJson.js';
import { ensureActiveNotesVaultPath } from './notesVaultRegistry.js';

export const SESSIONS_DIRNAME = 'Sessions';

export type SessionAgent = 'brainstorm' | 'writing-assistant' | 'archive' | 'beta-reader' | 'coach';

export interface SessionTurn {
  role: 'user' | 'agent';
  text: string;
  at: string;
  /** Present when this agent turn should render as a structured card. */
  cardTitle?: string;
  cardFoot?: string;
  /**
   * Structural card kind set only by trusted writers (Full Analysis / partner
   * actions). Untrusted text that merely looks like an encoded card must NOT
   * set this — MiniAgentChat renders cards only when cardKind is present.
   */
  cardKind?: 'analysis' | 'lesson' | 'action';
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
const CARD_META_RE = /^<!-- mythos:card-meta (\{.*\}) -->$/;
/** Leading coach-card HTML-comment prefix (with or without `v1`). */
const COACH_CARD_MARKER_PREFIX = '<!-- mythos:coach-card';

/** Neutralize fence / card-meta lines embedded in turn text so they stay body. */
function escapeTurnBodyMarkers(text: string): string {
  const withoutClose = text.split(TURN_CLOSE).join('<!- /mythos:turn ->');
  return withoutClose
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (TURN_OPEN_RE.test(trimmed) || CARD_META_RE.test(trimmed)) {
        return line.replace('<!--', '<!-');
      }
      return line;
    })
    .join('\n');
}

/**
 * Shield HARD fix 1 — break a leading coach-card marker (`<!--` → `<!-`) on
 * append / create-greeting writes when `cardKind` is not analysis/lesson.
 * Read + duplicate must leave legacy marker bytes unchanged.
 */
export function escapeLeadingCoachCardMarkerText(text: string): string {
  const lead = text.match(/^\s*/)?.[0] ?? '';
  const rest = text.slice(lead.length);
  if (!rest.startsWith(COACH_CARD_MARKER_PREFIX)) return text;
  return `${lead}${rest.replace('<!--', '<!-')}`;
}

function sanitizeCardKind(value: unknown): SessionTurn['cardKind'] | undefined {
  if (value === 'analysis' || value === 'lesson' || value === 'action') return value;
  return undefined;
}

/** Drop unknown cardKind values before they reach the in-memory session echo. */
export function sanitizeSessionTurn(turn: SessionTurn): SessionTurn {
  const kind = sanitizeCardKind(turn.cardKind);
  const next: SessionTurn = { role: turn.role, text: turn.text, at: turn.at };
  if (kind) next.cardKind = kind;
  if (turn.cardTitle) {
    next.cardTitle = turn.cardTitle;
    if (turn.cardFoot) next.cardFoot = turn.cardFoot;
  }
  return next;
}

/**
 * Append / create-greeting write sanitizer: whitelist cardKind, then escape a
 * leading coach-card marker unless the turn is a trusted analysis/lesson card.
 * Not used by duplicate / createSession bulk copies / read.
 */
export function sanitizeIncomingWriteTurn(turn: SessionTurn): SessionTurn {
  const next = sanitizeSessionTurn(turn);
  if (next.cardKind === 'analysis' || next.cardKind === 'lesson') return next;
  return { ...next, text: escapeLeadingCoachCardMarkerText(next.text) };
}

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
  const safeTitle = session.title ? session.title.replace(/[\r\n]+/g, ' ') : undefined;
  const fm: Record<string, unknown> = {
    mythosSession: 1,
    id: session.id,
    agent: session.agent,
    ...(safeTitle ? { title: safeTitle } : {}),
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    turns: session.turns.length,
  };
  // Residual 11 — strip newlines in the `# title` heading (not only frontmatter).
  const headingTitle = (safeTitle ?? `${session.agent} session`).replace(/[\r\n]+/g, ' ');
  const body: string[] = [`# ${headingTitle}`, ''];
  for (const turn of session.turns) {
    const safe = sanitizeSessionTurn(turn);
    body.push(`<!-- mythos:turn ${safe.role} ${safe.at} -->`);
    if (safe.cardTitle || safe.cardKind) {
      const meta: Record<string, string> = {};
      if (safe.cardTitle) meta.cardTitle = safe.cardTitle;
      if (safe.cardFoot) meta.cardFoot = safe.cardFoot;
      if (safe.cardKind) meta.cardKind = safe.cardKind;
      body.push(`<!-- mythos:card-meta ${JSON.stringify(meta)} -->`);
    }
    body.push(safe.role === 'user' ? '**You:**' : '**Agent:**', '');
    // Guard fences: close / open / card-meta lines inside text must not parse as structure.
    body.push(escapeTurnBodyMarkers(safe.text));
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
  let current: {
    role: 'user' | 'agent';
    at: string;
    buf: string[];
    cardTitle?: string;
    cardFoot?: string;
    cardKind?: SessionTurn['cardKind'];
    /** True once any non-meta body line has been accepted — blocks late card-meta. */
    bodyStarted: boolean;
  } | null = null;
  for (const line of lines) {
    const open = TURN_OPEN_RE.exec(line.trim());
    if (open) {
      // Mid-turn open markers are forged body text — do not start a new turn.
      if (current) {
        current.buf.push(line);
        current.bodyStarted = true;
        continue;
      }
      current = {
        role: open[1] as 'user' | 'agent',
        at: open[2].trim(),
        buf: [],
        bodyStarted: false,
      };
      continue;
    }
    if (current && !current.bodyStarted) {
      const cardMeta = CARD_META_RE.exec(line.trim());
      if (cardMeta) {
        try {
          const parsed = JSON.parse(cardMeta[1]) as Record<string, unknown>;
          if (typeof parsed.cardTitle === 'string') current.cardTitle = parsed.cardTitle;
          if (typeof parsed.cardFoot === 'string') current.cardFoot = parsed.cardFoot;
          const kind = sanitizeCardKind(parsed.cardKind);
          if (kind) current.cardKind = kind;
        } catch {
          // malformed card-meta line — ignore, degrade to plain bubble
        }
        // Structural meta only immediately after turn-open (before first body line).
        continue;
      }
    }
    if (line.trim() === TURN_CLOSE) {
      if (current) {
        // Drop the leading speaker label + blank line the serializer added.
        const buf = [...current.buf];
        if (buf[0] === '**You:**' || buf[0] === '**Agent:**') buf.shift();
        while (buf.length > 0 && buf[0].trim() === '') buf.shift();
        while (buf.length > 0 && buf[buf.length - 1].trim() === '') buf.pop();
        const turn: SessionTurn = { role: current.role, at: current.at, text: buf.join('\n') };
        if (current.cardKind) turn.cardKind = current.cardKind;
        if (current.cardTitle) {
          turn.cardTitle = current.cardTitle;
          if (current.cardFoot) turn.cardFoot = current.cardFoot;
        }
        turns.push(turn);
      }
      current = null;
      continue;
    }
    if (current) {
      current.buf.push(line);
      current.bodyStarted = true;
    }
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
    turns: (opts.turns ?? []).map(sanitizeSessionTurn),
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
  // Shield HARD fix 1 — escape leading coach-card marker on append (not duplicate/read).
  session.turns.push(...turns.map(sanitizeIncomingWriteTurn));
  session.updatedAt = new Date().toISOString();
  writeFileAtomic(path.join(notesVaultRoot, found.relPath), serializeSessionFile(session));
  return session;
}

/**
 * Locate a session file by its PARSED frontmatter id (`session.id === sessionId`).
 * This is the only safe lookup: transcripts are serialized verbatim, so a raw
 * substring scan for `id: <uuid>` can match another session whose chat text
 * merely mentions that id (PR #917 review, B1).
 */
export function findSessionFile(
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

/** Suffix `name.md` → `name (2).md`, `name (3).md`, … until `dir` has no collision. */
function uniqueDestName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
}

/**
 * SKY-10952 (owner ruling 2026-08-19, SKY-10949): one-shot per-vault
 * migration of pre-existing sessions off `Notes Vault/Sessions/` onto
 * `Agent Vault/Sessions/`. Safe to call on every vault open — once the
 * legacy folder is empty/gone this is a single existsSync check. Never
 * orphans a transcript: a same-name collision at the destination is kept
 * (suffixed), never overwritten or dropped.
 */
export function migrateSessionsToAgentVault(mythosRoot: string): { migratedCount: number } {
  const legacyDir = sessionsDir(ensureActiveNotesVaultPath(mythosRoot));
  let names: string[];
  try {
    names = fs.readdirSync(legacyDir).filter((n) => {
      try {
        return fs.statSync(path.join(legacyDir, n)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return { migratedCount: 0 };
  }
  if (names.length === 0) {
    // Nothing to move — still clear an empty legacy folder left by a prior
    // partial migration.
    try { fs.rmdirSync(legacyDir); } catch { /* not empty, or already gone */ }
    return { migratedCount: 0 };
  }
  const destDir = sessionsDir(agentVaultRootFor(mythosRoot));
  fs.mkdirSync(destDir, { recursive: true });
  let migratedCount = 0;
  for (const name of names) {
    const destName = uniqueDestName(destDir, name);
    try {
      renameSyncWithRetry(path.join(legacyDir, name), path.join(destDir, destName));
      migratedCount++;
    } catch {
      /* leave this transcript in place rather than lose it — retried next open */
    }
  }
  try { fs.rmdirSync(legacyDir); } catch { /* a file failed to move, or already gone */ }
  return { migratedCount };
}
