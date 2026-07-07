// Beta 3 M22 — renderer-side agent identity helpers.
//
// The four named agents (prototype `agentDefs`, HTML 4346–4351) are renameable
// via AppSettings.agentNames; every UI label should resolve through
// resolveAgentDisplayName so renames propagate app-wide. Mirrors the
// electron-main helper in electron-main/src/agentPersona.ts (no runtime code
// is shared between the processes).

export type NamedAgentId = 'writingAssistant' | 'brainstorm' | 'archive' | 'betaReader';

export const NAMED_AGENT_IDS: readonly NamedAgentId[] = [
  'writingAssistant',
  'brainstorm',
  'archive',
  'betaReader',
];

export const DEFAULT_AGENT_DISPLAY_NAMES: Record<NamedAgentId, string> = {
  writingAssistant: 'Writing Assistant',
  brainstorm: 'Brainstorm Agent',
  archive: 'Archive Agent',
  betaReader: 'Beta Reader',
};

/** Resolve an agent's display name from the optional settings.agentNames map. */
export function resolveAgentDisplayName(
  agent: NamedAgentId,
  agentNames?: Partial<Record<NamedAgentId, string>>,
): string {
  const custom = agentNames?.[agent]?.trim();
  return custom || DEFAULT_AGENT_DISPLAY_NAMES[agent];
}

/**
 * The four identity files per agent (prototype `agentFiles`, HTML 3145),
 * mapped onto the persona keys that store their content in
 * {userData}/agent-personas/{agentName}/{KEY}.md. Mirrors IDENTITY_FILES in
 * electron-main/src/agentPersona.ts.
 */
export const IDENTITY_FILES: ReadonlyArray<{ key: string; fileName: string }> = [
  { key: 'AGENTS', fileName: 'agent.md' },
  { key: 'HEARTBEAT', fileName: 'instructions.md' },
  { key: 'LEARNING', fileName: 'learning.md' },
  { key: 'SOUL', fileName: 'soul.md' },
];
