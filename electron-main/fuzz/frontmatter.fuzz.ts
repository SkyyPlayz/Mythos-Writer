// SKY-361: Coverage-guided Jazzer.js fuzz harness for parseFrontmatter.
//
// parseFrontmatter is a hand-rolled YAML parser that processes every .md file
// in an Obsidian vault import — fully attacker-controlled input.
//
// Threat model:
//   - ZIP-extracted .md file with adversarial frontmatter content
//   - Very long keys or values designed to OOM or trigger regex backtracking
//   - Embedded null bytes, Unicode surrogates, control characters
//   - Frontmatter blocks that look like valid YAML but trip edge-case branches
//
// The harness both checks for crashes AND performs an inline roundtrip
// consistency check: if parseFrontmatter succeeds and produces a non-empty
// frontmatter, serialize→re-parse must not crash and must produce the same
// frontmatter keys.
//
// Run locally (60 s):
//   cd electron-main
//   npx jazzer fuzz/frontmatter.fuzz.ts fuzz/corpus/frontmatter \
//     -- -max_total_time=60 -artifact_prefix=fuzz/crashes/frontmatter-
//
// Crashes are written to fuzz/crashes/. See docs/security/fuzz-triage-runbook.md.

import { parseFrontmatter, serializeFrontmatter } from '../src/vault.js';

export function fuzz(data: Buffer): void {
  const input = data.toString('utf-8');

  // Primary check: parser must never crash on arbitrary bytes.
  const result = parseFrontmatter(input);

  // Secondary roundtrip consistency check.
  // Only attempt when parseFrontmatter found actual frontmatter — otherwise
  // we'd be fuzzing the plain-prose path with no additional coverage.
  if (Object.keys(result.frontmatter).length > 0) {
    const serialized = serializeFrontmatter(result.frontmatter, result.prose);
    const reparsed = parseFrontmatter(serialized);

    // All keys recovered in the first parse must survive a roundtrip.
    // If this throws or produces fewer keys, Jazzer records it as a finding.
    const firstKeys = Object.keys(result.frontmatter).sort();
    const secondKeys = Object.keys(reparsed.frontmatter).sort();
    if (firstKeys.join('\0') !== secondKeys.join('\0')) {
      throw new Error(
        `Frontmatter key set changed across roundtrip: ` +
          `[${firstKeys.join(',')}] → [${secondKeys.join(',')}]`
      );
    }
  }
}
