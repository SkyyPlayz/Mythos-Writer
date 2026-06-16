/**
 * archiveConfirmValidation.test.ts (SKY-1747)
 *
 * Regression test for missing enum validation on the archive:confirm IPC handler
 * action parameter. Uses inline replica (no Electron, no FS) matching the pattern
 * from agentPayloadValidation.test.ts.
 *
 * Coverage:
 *   §1  Invalid action string throws
 *   §2  Valid actions do not throw at the validation step
 */

import { describe, it, expect } from 'vitest';

// ─── Inline replica of the validation added in main.ts ───────────────────────

const VALID_ARCHIVE_ACTIONS = ['match_archive', 'suggest_story_change', 'ignore'] as const;
type ArchiveConfirmAction = typeof VALID_ARCHIVE_ACTIONS[number];

function validateArchiveConfirmAction(action: unknown): asserts action is ArchiveConfirmAction {
  if (!VALID_ARCHIVE_ACTIONS.includes(action as ArchiveConfirmAction)) {
    throw new Error(`Invalid action: ${action}`);
  }
}

// ─── §1 Invalid action throws ─────────────────────────────────────────────────

describe('archive:confirm action validation', () => {
  it('throws for an unrecognised action string', () => {
    expect(() => validateArchiveConfirmAction('delete_all')).toThrow('Invalid action: delete_all');
  });

  it('throws for an empty string', () => {
    expect(() => validateArchiveConfirmAction('')).toThrow('Invalid action: ');
  });

  it('throws for null', () => {
    expect(() => validateArchiveConfirmAction(null)).toThrow('Invalid action: null');
  });

  it('throws for undefined', () => {
    expect(() => validateArchiveConfirmAction(undefined)).toThrow('Invalid action: undefined');
  });

  // ─── §2 Valid actions pass ──────────────────────────────────────────────────

  it('does not throw for match_archive', () => {
    expect(() => validateArchiveConfirmAction('match_archive')).not.toThrow();
  });

  it('does not throw for suggest_story_change', () => {
    expect(() => validateArchiveConfirmAction('suggest_story_change')).not.toThrow();
  });

  it('does not throw for ignore', () => {
    expect(() => validateArchiveConfirmAction('ignore')).not.toThrow();
  });
});
