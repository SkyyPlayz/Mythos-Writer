// Property-based tests for safeVaultJoin (SKY-361, P0).
//
// safeVaultJoin is the single path-resolution chokepoint for all vault file
// ops. Property tests enumerate the combinatorial space that example tests
// miss: unicode normalisation differentials, mixed separators, long paths,
// percent-encoded sequences, null bytes.
//
// DELIBERATE BREAKAGE PROOF — null-byte guard:
//   1. Remove the NULL_BYTE_RE check from safeVaultJoin.ts.
//   2. Run: npm run test -w electron-main -- src/vault/safeVaultJoin.property
//   3. fast-check finds path "notes\0/../../../etc/passwd":
//        Without the guard, path.resolve(vaultRoot, "notes\0/...") produces a
//        string starting with vaultRoot (containment check passes!), but the
//        returned string CONTAINS a null byte.
//        fs.open("...vault/notes\0/...") silently opens "...vault/notes" on
//        POSIX (Node truncates at \0), defeating the traversal guard entirely.
//        Our assertion fires:
//          Expected: string without null byte
//          Received: "<vault>/notes\0/../../../etc/passwd"

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { safeVaultJoin } from './safeVaultJoin.js';

describe('safeVaultJoin — property-based (SKY-361)', () => {
  let vaultRoot: string;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-prop-'));
  });

  afterEach(() => {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  });

  // Diverse path arbitrary: random ASCII and unicode strings, known traversal
  // payloads, long paths, Windows separators, percent-encoded sequences.
  const relPathArb = fc.oneof(
    // General random strings (ASCII range — most likely to slip past guards)
    { arbitrary: fc.string({ maxLength: 256 }), weight: 4 },
    // Unicode paths with grapheme clusters
    { arbitrary: fc.string({ unit: 'grapheme-composite', maxLength: 128 }), weight: 2 },
    // Hard-coded traversal payloads
    { arbitrary: fc.constant('..'), weight: 1 },
    { arbitrary: fc.constant('../..'), weight: 1 },
    { arbitrary: fc.constant('../../etc/passwd'), weight: 1 },
    { arbitrary: fc.constant('../../../etc/passwd'), weight: 1 },
    // Null-byte injection (POSIX truncates at \0; Node passes it through)
    { arbitrary: fc.constant('notes\x00'), weight: 1 },
    { arbitrary: fc.constant('a\x00b'), weight: 1 },
    { arbitrary: fc.constant('notes\x00/../../../etc/passwd'), weight: 1 },
    // Windows / UNC absolute paths
    { arbitrary: fc.constant('C:\\Windows\\System32'), weight: 1 },
    { arbitrary: fc.constant('\\\\server\\share\\file'), weight: 1 },
    { arbitrary: fc.constant('D:/secret'), weight: 1 },
    // Percent-encoded traversal sequences
    { arbitrary: fc.constant('%2e%2e/%2e%2e'), weight: 1 },
    { arbitrary: fc.constant('%252e%252e'), weight: 1 },
    { arbitrary: fc.constant('%2e%2e%2f%2e%2e%2fetc%2fpasswd'), weight: 1 },
    // Very long paths (near filesystem limit)
    { arbitrary: fc.string({ minLength: 3990, maxLength: 4096 }), weight: 1 },
    // Unicode path components joined with /
    {
      arbitrary: fc
        .array(fc.string({ unit: 'grapheme-composite', maxLength: 30 }), {
          minLength: 1,
          maxLength: 8,
        })
        .map((parts) => parts.join('/')),
      weight: 2,
    },
    // Windows backslash separator mixed in
    {
      arbitrary: fc
        .array(fc.string({ maxLength: 20 }), { minLength: 1, maxLength: 5 })
        .map((parts) => parts.join('\\')),
      weight: 1,
    },
  );

  // ── P1: Containment invariant ─────────────────────────────────────────────
  //
  // safeVaultJoin must EITHER throw OR return a path contained within vaultRoot
  // with no null bytes. A null byte in the return value would allow truncation
  // attacks where containment passes but the OS opens a different file.
  //
  // MUTATION DETECTION: remove the NULL_BYTE_RE guard from safeVaultJoin.ts →
  // fast-check finds "notes\0/../../../etc/passwd". Path resolves to inside
  // vaultRoot (passes containment) but return value contains '\0'. Assertion
  // fires: "expected string not to contain '\0'".
  it('P1: either throws or returns a contained path with no null bytes', () => {
    fc.assert(
      fc.property(relPathArb, (relPath) => {
        let result: string | undefined;
        let threw = false;
        try {
          result = safeVaultJoin(vaultRoot, relPath);
        } catch {
          threw = true;
        }

        if (threw) {
          // Rejection is always acceptable — any path may be rejected.
          expect(result).toBeUndefined();
          return;
        }

        expect(result).toBeDefined();
        const contained =
          result === vaultRoot || result!.startsWith(vaultRoot + path.sep);
        expect(contained).toBe(true);
        // Null bytes in the return value allow fs truncation attacks where the
        // containment check passes but the OS opens a different file entirely.
        expect(result).not.toContain('\x00');
      }),
      { numRuns: 500 },
    );
  });

  // ── P2: Rejection-only guarantee for known-bad payloads ───────────────────
  //
  // These inputs MUST throw — a return value would be a security regression.
  //
  // MUTATION DETECTION: remove any single guard from safeVaultJoin.ts (e.g.
  // delete the ENCODED_DOTDOT_RE check) → the corresponding case below stops
  // throwing and the test reports a failure.
  const mustThrowCases: [string, string][] = [
    ['null byte', 'notes\x00'],
    ['null byte + traversal', 'notes\x00/../../../etc/passwd'],
    ['Windows drive C:', 'C:\\secret.md'],
    ['Windows drive D:/', 'D:/secret'],
    ['UNC path', '\\\\server\\share'],
    ['percent-encoded ..', '%2e%2e/%2e%2e'],
    ['double-encoded ..', '%252e%252e'],
  ];

  for (const [label, badPath] of mustThrowCases) {
    it(`P2: rejects ${label}`, () => {
      expect(() => safeVaultJoin(vaultRoot, badPath)).toThrow(/Path traversal denied/);
    });
  }
});
