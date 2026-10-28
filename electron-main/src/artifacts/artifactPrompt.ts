// Share-as-prompt: source plus data schema, with paths, usernames, and keys stripped.

import { isAiMasterOn, AI_DISABLED_MESSAGE } from '../provider.js';
import type { ArtifactRecord } from './artifactSchema.js';

export interface PromptCard {
  type: 'prompt-card';
  source: string;
  dataSchema: Record<string, unknown>;
}

const PATH_RE = /(?:\/(?:Users|home|tmp|var|private)\/[^\s'"]+|\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+|[A-Za-z]:\\[^\s'"]+)/g;
const USER_RE = /(?:\/Users\/|\/home\/|\\Users\\)[^/\s\\'"]+/g;
const KEY_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|Bearer\s+[A-Za-z0-9._\-]+|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+)/gi;

export function redactPromptText(input: string): string {
  return input
    .replace(KEY_RE, '[redacted]')
    .replace(USER_RE, '[redacted]')
    .replace(PATH_RE, '[redacted]');
}

export function shareArtifactPrompt(
  record: Pick<ArtifactRecord, 'body' | 'dataSchema'>,
  aiOn: () => boolean = isAiMasterOn,
): { ok: true; card: PromptCard } | { ok: false; error: string } {
  try {
    if (!aiOn()) return { ok: false, error: AI_DISABLED_MESSAGE };
    const card: PromptCard = {
      type: 'prompt-card',
      source: redactPromptText(record.body),
      dataSchema: record.dataSchema,
    };
    return { ok: true, card };
  } catch {
    return { ok: false, error: 'fail_closed' };
  }
}
