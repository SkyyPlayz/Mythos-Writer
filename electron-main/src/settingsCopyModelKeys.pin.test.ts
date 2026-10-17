/**
 * Source pin: the three main-process errors that used to name the retired
 * Settings page now name Settings → Model & keys. Those throws only fire
 * when a disabled role is invoked, so there is no cheap UI path — the
 * strings are pinned on the source.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mainPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts');

/** Retired page name, built so this file does not itself contain the phrase. */
const RETIRED_SETTINGS_PAGE = ['Settings', '>', 'AI Agents'].join(' ');

const MODEL_KEYS_MESSAGES = [
  'enable it in Settings → Model & keys to run a read.',
  'try a different model in Settings → Model & keys.',
  'enable it in Settings → Model & keys to run a review.',
] as const;

describe('settings copy: Model & keys (source pin)', () => {
  const mainSrc = fs.readFileSync(mainPath, 'utf-8');

  it('does not send authors to the retired Settings page', () => {
    expect(mainSrc).not.toContain(RETIRED_SETTINGS_PAGE);
  });

  it('names Settings → Model & keys in each of the three messages', () => {
    for (const message of MODEL_KEYS_MESSAGES) {
      expect(mainSrc).toContain(message);
    }
  });
});
