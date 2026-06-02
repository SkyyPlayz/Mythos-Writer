// SKY-361: Coverage-guided Jazzer.js fuzz harness for the DOCX inline
// markdown parser (inlineRuns / proseToParagraphs inside docx.ts) and the
// EPUB HTML-escaping path (escapedHtml / proseToHtml inside epub.ts).
//
// Both functions process user-authored prose that may originate from an
// attacker-controlled Obsidian vault import.  The inline markdown parser
// uses a regex with look-ahead/look-behind assertions — a common source of
// regex catastrophic backtracking under adversarial input.
//
// Run locally (60 s):
//   cd electron-main
//   npx jazzer fuzz/docxInline.fuzz.ts fuzz/corpus/docxInline \
//     -- -max_total_time=60 -artifact_prefix=fuzz/crashes/docxInline-
//
// Crashes are written to fuzz/crashes/. See docs/security/fuzz-triage-runbook.md.

import { buildDocx } from '../src/docx.js';
import { buildEpub } from '../src/epub.js';

export async function fuzz(data: Buffer): Promise<void> {
  const prose = data.toString('utf-8');

  // Fuzz DOCX inline parser — checks for crashes and excessively long runs.
  await buildDocx({
    title: 'Fuzz',
    chapters: [
      {
        id: 'ch1',
        title: 'Chapter',
        scenes: [{ id: 'sc1', title: 'Scene', prose }],
      },
    ],
  });

  // Fuzz EPUB HTML-escaping path — checks for crashes. The fuzzer will
  // also explore edge cases in escapedHtml and proseToHtml via coverage guidance.
  await buildEpub({
    title: 'Fuzz',
    chapters: [
      {
        id: 'ch1',
        title: 'Chapter',
        scenes: [{ id: 'sc1', title: 'Scene', prose }],
      },
    ],
  });
}
