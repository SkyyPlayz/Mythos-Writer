import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const mainPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'main.ts');
const mainSrc = fs.readFileSync(mainPath, 'utf-8');

describe('Settings copy names Model & keys', () => {
  it('does not direct users to the obsolete AI Agents page', () => {
    expect(mainSrc).not.toContain('Settings > ' + 'AI Agents');
  });

  it('names Model & keys when the Beta Reader is disabled', () => {
    expect(mainSrc).toContain('Beta Reader is disabled — enable it in Settings → Model & keys to run a read.');
  });

  it('names Model & keys when the Beta Reader response cannot be parsed', () => {
    expect(mainSrc).toContain(
      'some local/reasoning models — try again, or try a different model in Settings → Model & keys.',
    );
  });

  it('names Model & keys when a production role is disabled', () => {
    expect(mainSrc).toContain('${displayName} is disabled — enable it in Settings → Model & keys to run a review.');
  });
});
