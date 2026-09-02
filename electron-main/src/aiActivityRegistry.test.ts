// SKY-11223 — locks the "empty" terminal-status contract for the shared AI
// activity registry. The review that shipped alongside this ticket caught the
// two beta surfaces conflating "successful run, zero discrete artifacts" with
// "model produced nothing" — a summary-only report or a clean scene was
// dishonestly labeled "Produced nothing — try again" while its saved result
// sat on screen. `isEmptyModelOutput` is the one predicate every tracked call
// site now shares so that can never drift back.
import { describe, it, expect } from 'vitest';
import { isEmptyModelOutput } from './aiActivityRegistry.js';

describe('isEmptyModelOutput — empty means the model streamed no text', () => {
  it('treats a truly empty stream as empty', () => {
    expect(isEmptyModelOutput('')).toBe(true);
  });

  it('treats a whitespace-only stream as empty', () => {
    expect(isEmptyModelOutput('   \n\t  ')).toBe(true);
  });

  it('does NOT treat a clean beta scan (real answer, zero margin comments) as empty', () => {
    // The model streamed a genuine "no problems here" reply that parses to zero
    // comments — a success, not silence.
    expect(isEmptyModelOutput('No issues found — the pacing and voice read cleanly.')).toBe(false);
  });

  it('does NOT treat a summary-only beta report (score/verdict, zero reactions) as empty', () => {
    // A scored report with no LOVED/STUMBLED/CONFUSED reactions is parsed,
    // saved, and displayed — it must terminate as `done`, never "empty".
    const summaryOnly = 'OVERALL: 8/10\nVERDICT: A confident, well-structured draft.\nFEEDBACK: Tighten the middle act.';
    expect(isEmptyModelOutput(summaryOnly)).toBe(false);
  });
});
