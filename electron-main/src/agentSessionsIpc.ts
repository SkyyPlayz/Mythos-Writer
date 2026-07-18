// SKY-6228 (M15): Pure handler logic for the agentSession:* IPC channels.
// Extracted from main.ts (same pattern as timelineIpc.ts) so the real
// rename/duplicate/delete/append handlers are unit-testable without Electron
// mocks — these handlers destroy/overwrite files in the user's vault, so they
// must be covered by tests that run against a real on-disk Sessions/ dir.
import fs from 'node:fs';
import path from 'node:path';
import {
  listSessions,
  createSession,
  appendTurns,
  readSession,
  findSessionFile,
  serializeSessionFile,
} from './mythosFormat/agentSessions.js';
import { writeFileAtomic } from './vault.js';
import type {
  AgentSessionListPayload,
  AgentSessionListResponse,
  AgentSessionReadPayload,
  AgentSessionReadResponse,
  AgentSessionCreatePayload,
  AgentSessionCreateResponse,
  AgentSessionRenamePayload,
  AgentSessionRenameResponse,
  AgentSessionDuplicatePayload,
  AgentSessionDuplicateResponse,
  AgentSessionDeletePayload,
  AgentSessionDeleteResponse,
  AgentSessionAppendTurnsPayload,
  AgentSessionAppendTurnsResponse,
} from './ipc.js';

export function handleAgentSessionList(
  notesRoot: string,
  payload: AgentSessionListPayload,
): AgentSessionListResponse {
  let sessions = listSessions(notesRoot);
  if (payload?.agent) sessions = sessions.filter((s) => s.agent === payload.agent);
  return { sessions };
}

// M12 — hydrate one full session (turns included). Coach page ↔ Coach panel
// render the same conversation, so a surface mounting onto an existing
// session needs its stored turns, not just the list summary. Also used by
// M20 (SKY-6663) to hydrate the Brainstorm chat's turn history on session
// switch. Lookup is by the PARSED frontmatter id (readSession), never a
// substring scan (B1 contract).
export function handleAgentSessionRead(
  notesRoot: string,
  payload: AgentSessionReadPayload,
): AgentSessionReadResponse {
  return { session: readSession(notesRoot, payload.sessionId) };
}

export function handleAgentSessionCreate(
  notesRoot: string,
  payload: AgentSessionCreatePayload,
): AgentSessionCreateResponse {
  const firstTurn = payload.greeting
    ? [{ role: 'agent' as const, text: payload.greeting, at: new Date().toISOString() }]
    : [];
  const { session, relPath } = createSession(notesRoot, {
    agent: payload.agent,
    title: payload.title,
    turns: firstTurn,
  });
  return { session, relPath };
}

export function handleAgentSessionRename(
  notesRoot: string,
  payload: AgentSessionRenamePayload,
): AgentSessionRenameResponse {
  // B1 (PR #917): resolve the file by parsed frontmatter id — never by a
  // substring scan over the raw body, which can match a transcript that
  // merely mentions the id and overwrite the wrong session file.
  const found = findSessionFile(notesRoot, payload.sessionId);
  if (!found) return { ok: false };
  const session = found.session;
  session.title = payload.title.replace(/[\r\n]+/g, ' ').trim() || session.title;
  session.updatedAt = new Date().toISOString();
  writeFileAtomic(path.join(notesRoot, found.relPath), serializeSessionFile(session));
  return { ok: true };
}

export function handleAgentSessionDuplicate(
  notesRoot: string,
  payload: AgentSessionDuplicatePayload,
): AgentSessionDuplicateResponse {
  const source = readSession(notesRoot, payload.sessionId);
  if (!source) throw new Error(`Session not found: ${payload.sessionId}`);
  const { session, relPath } = createSession(notesRoot, {
    agent: source.agent,
    title: source.title ? `${source.title} (copy)` : undefined,
    turns: [...source.turns],
  });
  return { session, relPath };
}

export function handleAgentSessionDelete(
  notesRoot: string,
  payload: AgentSessionDeletePayload,
): AgentSessionDeleteResponse {
  // B1 (PR #917): resolve the file by parsed frontmatter id — never by a
  // substring scan over the raw body, which can match a transcript that
  // merely mentions the id and unlink the wrong session file.
  const found = findSessionFile(notesRoot, payload.sessionId);
  if (!found) return { ok: false };
  try {
    fs.unlinkSync(path.join(notesRoot, found.relPath));
  } catch { return { ok: false }; }
  const remaining = listSessions(notesRoot).filter((s) => s.agent === found.session.agent);
  if (remaining.length === 0) {
    const { session: rep, relPath: rp } = createSession(notesRoot, { agent: found.session.agent });
    return { ok: true, replacement: rep, replacementRelPath: rp };
  }
  return { ok: true };
}

export function handleAgentSessionAppendTurns(
  notesRoot: string,
  payload: AgentSessionAppendTurnsPayload,
): AgentSessionAppendTurnsResponse {
  const session = appendTurns(notesRoot, payload.sessionId, payload.turns);
  return { session };
}
