// Slice B — unified Writing Partner identity.
// One renameable partner face (default Mythos); three hands stay behind it.
// Display name is stored on settings.agentNames.brainstorm (spine) until
// Settings › Writing partner (Slice C) owns a dedicated key.

import type { NamedAgentId } from './agentIdentity';
import { resolveAgentDisplayName } from './agentIdentity';

export const DEFAULT_PARTNER_DISPLAY_NAME = 'Mythos';

/** Hands routed behind the single partner face (engines kept). */
export type PartnerHandId = 'writer' | 'analyst' | 'archivist';

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

/**
 * Resolve the Writing Partner display name.
 * Prefer an explicit brainstorm (spine) rename; otherwise Mythos.
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
