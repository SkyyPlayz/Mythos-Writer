# Fuzz-Finding Triage Runbook

> **Maintained by:** SecurityEngineer (SKY-361)
> **Last updated:** 2026-06-02

This runbook describes what to do when a fuzzer produces a crash, a hang, or a
failing assertion.  Follow these steps in order.

---

## 1. Where crashes appear

The CI fuzz step (`Fuzz — frontmatter parser` or `Fuzz — DOCX/EPUB inline parsers`)
uploads crash artifacts to the GitHub Actions artifact named **`fuzz-crashes`** on the
failing run.  Download the artifact zip; each file inside is a minimized input that
reproduces the crash.

Locally, crash files are written to `electron-main/fuzz/crashes/` with the prefix
`frontmatter-` or `docxInline-` plus a hash.

---

## 2. Reproduce the crash

```bash
# Reproduce a frontmatter crash
cd electron-main
npx jazzer fuzz/frontmatter.fuzz.ts <crash-file-path>

# Reproduce a docxInline crash
npx jazzer fuzz/docxInline.fuzz.ts <crash-file-path>
```

Jazzer will run the crash input through the harness once and print the stack trace.

---

## 3. Classify the finding

| What Jazzer reports | Likely class | Severity |
|---|---|---|
| Uncaught `Error` / exception in `parseFrontmatter` | Parser crash / DoS | Medium–High |
| Roundtrip key-set mismatch thrown by the harness | Data-corruption bug | Medium |
| Timeout / hang > 30 s | Regex catastrophic backtracking or infinite loop | High |
| `RangeError: Maximum call stack size exceeded` | Recursive parser bug | High |
| Out-of-memory / heap OOM | Unbounded allocation | High |
| `TypeError` in `buildDocx` / `buildEpub` | Serializer crash | Low–Medium |

**Is this exploitable?**  Ask:
- Can an attacker trigger this by placing a crafted `.md` file in an Obsidian vault?
- Does the crash happen in the main process (Node.js) or renderer?
- Does the crash give the attacker code execution, information disclosure, or persistent DoS?

---

## 4. Handle by severity

### Critical / High (potential code execution, persistent crash-on-open)

1. **Do NOT paste the crash input or PoC in the public issue thread.**
2. Comment on the related issue "Handling this privately — switching channels"
   and DM the CEO immediately.
3. The CEO will open a private advisory channel.
4. Development stops on the affected component until a fix is confirmed.
5. Fix, regression test, then disclose publicly after the patched build ships.

### Medium (parser exception, data-corruption roundtrip)

1. File a new issue in the normal SKY board with:
   - Vulnerability class (e.g., "uncaught exception in parseFrontmatter")
   - The harness name and crash file SHA256
   - Stack trace (sanitized — no sensitive data)
   - Exploitability assessment (can an attacker trigger this without user interaction?)
2. Assign SecurityEngineer + FoundingEngineer.
3. The crash input becomes a new vitest regression test case in the affected module.

### Low (serializer crash requiring valid internal input)

1. File a normal bug issue.
2. Add a regression test.
3. Fix in the next sprint.

---

## 5. Fix requirements

Every security fix must:

- Include a **regression test** using the exact crash input (or a minimized
  equivalent).  The test must fail against the unfixed code and pass after the fix.
- Update the inventory at `docs/security/untrusted-input-inventory.md`.
- Add the crash input to the relevant corpus directory
  (`electron-main/fuzz/corpus/<harness>/`) so future fuzz runs don't re-discover it.

---

## 6. Adding crash inputs to the corpus

```bash
cp <crash-file> electron-main/fuzz/corpus/frontmatter/crash-<date>-<hash>.md
git add electron-main/fuzz/corpus/frontmatter/
git commit -m "fuzz(corpus): add regression seed for <crash-description>"
```

Jazzer uses the corpus directory as seeds on subsequent runs, so the next CI run
will cover the previously-crashing path from the first second.

---

## 7. Running extended fuzz sessions

The CI step uses `-max_total_time=60` (60 seconds).  For deeper coverage before
a release or after a significant parser change, run a longer session locally:

```bash
cd electron-main
# 1-hour session with parallel jobs and a larger corpus
npx jazzer fuzz/frontmatter.fuzz.ts fuzz/corpus/frontmatter \
  -- -max_total_time=3600 -jobs=4 -artifact_prefix=fuzz/crashes/frontmatter-
```

Any new crash inputs found should be committed to the corpus per §6 above.

---

## 8. References

- Inventory: `docs/security/untrusted-input-inventory.md`
- Jazzer.js docs: https://github.com/CodeIntelligenceTesting/jazzer.js
- libFuzzer options: https://llvm.org/docs/LibFuzzer.html
- SKY-361 (this work)
- SKY-356 Code Quality Standard §3 (required testing techniques)
