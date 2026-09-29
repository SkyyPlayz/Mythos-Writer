// Slice F3 — unified Writing Partner identity.
// One renameable partner face; action buttons (Update Timeline / Beta Read /
// Writer Scan) replace the old Writer/Analyst/Archivist persona chips.
// Display name is stored on settings.agentNames.brainstorm (spine).

import type { NamedAgentId } from './agentIdentity';
import { resolveAgentDisplayName } from './agentIdentity';

/** Fallback when the user has not renamed the partner in Settings. */
export const DEFAULT_PARTNER_DISPLAY_NAME = 'Mythos';

/**
 * F3#1 — every chat surface (hub, Timeline partner tab, Coach page, Beta chat,
 * WA float-out, Brainstorm page) reads/writes this single session-store key.
 * Send path is always `invokeBrainstorm` / `agentBrainstorm` — never coach or
 * beta-reader IPC.
 */
export const PARTNER_SESSION_AGENT = 'brainstorm' as const;

/** Hands still used for busy/status routing behind the single partner face. */
export type PartnerHandId = 'writer' | 'analyst' | 'archivist';

/** Engine metadata (Settings / Model Keys); not shown as persona chat chips. */
export const PARTNER_HANDS: ReadonlyArray<{
  id: PartnerHandId;
  label: string;
  /** Existing engine / NamedAgentId the hand routes to. */
  engineKey: NamedAgentId;
  description: string;
  color: string;
}> = [
  {
    id: 'writer',
    label: 'Writer',
    engineKey: 'writingAssistant',
    description: 'Prose that lands in notes; lessons & craft.',
    color: '#9b5fff',
  },
  {
    id: 'analyst',
    label: 'Analyst',
    engineKey: 'betaReader',
    description: 'Reads manuscript/vault → reports only.',
    color: '#8ad9ff',
  },
  {
    id: 'archivist',
    label: 'Archivist',
    engineKey: 'archive',
    description: 'Timeline build + done-vs-planned tooling.',
    color: '#f5d76e',
  },
];

/** F3#3 — action buttons that replace persona chips in the hub. */
export type PartnerActionId = 'update-timeline' | 'beta-read' | 'writer-scan';

export const PARTNER_ACTIONS: ReadonlyArray<{
  id: PartnerActionId;
  label: string;
  /** Engine hand that runs the action. */
  hand: PartnerHandId;
  description: string;
  color: string;
}> = [
  {
    id: 'update-timeline',
    label: 'Update Timeline',
    hand: 'archivist',
    description: 'Scan notes → add new timeline items; mark written as done.',
    color: '#f5d76e',
  },
  {
    id: 'beta-read',
    label: 'Beta Read',
    hand: 'analyst',
    description: 'Run a beta read and show the report in this thread.',
    color: '#8ad9ff',
  },
  {
    id: 'writer-scan',
    label: 'Writer Scan',
    hand: 'writer',
    description: 'Scan the active scene for craft notes in this thread.',
    color: '#9b5fff',
  },
];

/**
 * Resolve the Writing Partner display name.
 * Prefer an explicit brainstorm (spine) rename; otherwise the default.
 */
export function resolvePartnerDisplayName(
  agentNames?: Partial<Record<NamedAgentId, string>>,
): string {
  const custom = agentNames?.brainstorm?.trim();
  if (custom) return custom;
  return DEFAULT_PARTNER_DISPLAY_NAME;
}

/** Comment-gutter / notes-panel author label for partner-attributed chrome. */
export function resolvePartnerAuthorLabel(
  agentNames?: Partial<Record<NamedAgentId, string>>,
  kind?: string,
): string {
  const partner = resolvePartnerDisplayName(agentNames);
  if (!kind) return partner;
  // Legacy kinds still map to the single face so renames don't leave stale names.
  switch (kind) {
    case 'coach':
    case 'writing-assistant':
    case 'writingAssistant':
    case 'brainstorm':
    case 'archive':
    case 'beta':
    case 'beta-reader':
    case 'betaReader':
    case 'partner':
      return partner;
    default:
      return partner;
  }
}

/** Hand label for status lines ("Writer is working — messages queue"). */
export function partnerHandStatusLine(
  hand: PartnerHandId | null,
  busy: boolean,
  onCall: boolean,
  muted: boolean,
): string {
  if (onCall && muted) return 'MUTED';
  if (onCall && hand && busy) return `LISTENING · ${handLabel(hand)} WORKING`;
  if (onCall) return 'LISTENING';
  if (hand && busy) return `${handLabel(hand)} is working — messages queue`;
  return 'Listening quietly · memory on';
}

function handLabel(hand: PartnerHandId): string {
  switch (hand) {
    case 'writer':
      return 'Writer';
    case 'analyst':
      return 'Analyst';
    case 'archivist':
      return 'Archivist';
    default: {
      const _exhaustive: never = hand;
      return _exhaustive;
    }
  }
}

/** Re-export resolve for hand engine labels when needed in Settings. */
export { resolveAgentDisplayName };
