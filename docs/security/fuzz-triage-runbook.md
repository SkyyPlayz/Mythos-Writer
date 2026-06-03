# Fuzz-Finding Triage Runbook
**Scope:** Mythos Writer — property-based test failures + fuzzer crashes
**Owner:** SecurityEngineer
**Last updated:** 2026-06-02
**Parent issue:** [SKY-361](/SKY/issues/SKY-361) | **Standard:** [SKY-356#document-code-quality-standard](/SKY/issues/SKY-356#document-code-quality-standard)

---

## 1. When a fuzzer or property test signals a finding

A "finding" is any of:
- Fuzzer process exits non-zero (crash, ASAN finding, OOM kill)
- Property test `fc.assert` throws (counterexample found)
- CI job `fuzz:*` or `proptest:*` fails on a PR

**Do not paste crash inputs, stack traces, or reproduction payloads in public issue threads or PRs.** Treat the finding as potentially confidential until severity is assessed.

---

## 2. Immediate triage (< 15 minutes)

### Step 1 — Save the artifact

Crash files land in the **`fuzz-crashes`** artifact zip on the failing CI run, or locally at
`electron-main/fuzz/crashes/` with prefix `frontmatter-` or `docxInline-` plus a hash.
Property test failures print a `fc.counterexample` JSON blob to the CI log.
Save immediately — CI artifacts expire in 30 days.

```
# fuzzer: download the fuzz-crashes artifact zip from the failing Actions run
# property test: copy the fc.counterexample line from CI logs
```

### Step 2 — Reproduce locally

```bash
# Property test counterexample
npx vitest run --reporter verbose electron-main/src/vault.property.test.ts

# Fuzzer crash — frontmatter parser
cd electron-main
npx jazzer fuzz/frontmatter.fuzz.ts fuzz/corpus/frontmatter <crash-file-path>

# Fuzzer crash — DOCX/EPUB inline parsers
cd electron-main
npx jazzer fuzz/docxInline.fuzz.ts fuzz/corpus/docxInline <crash-file-path>
```

Jazzer runs the crash input once and prints the full stack trace.
If you cannot reproduce, mark as `flaky` and re-run the CI job twice before escalating.

### Step 3 — Classify severity

| Class | Description | Action |
|---|---|---|
| **Critical** | RCE, path escape outside vault root, prototype pollution of `Object` prototype | File private Paperclip issue immediately, assign SecurityEngineer + CTO. Do not discuss in public |
| **High** | Main-process crash (DoS), silent data corruption, uncapped memory growth, `RangeError: Maximum call stack size exceeded`, regex catastrophic backtracking, timeout > 30 s | File private issue, assign SecurityEngineer. Patch within 48 h |
| **Medium** | Error swallowed silently, unexpected type coercion passed downstream, roundtrip key-set mismatch, `TypeError` in `buildDocx` / `buildEpub` serializer | File public child of [SKY-361](/SKY/issues/SKY-361), assign FoundingEngineer |
| **Low / Info** | Edge case no attacker can reach, cosmetic output difference | Add to regression corpus, comment on [SKY-361](/SKY/issues/SKY-361) |

### Step 4 — File the issue

**For Critical/High:** post a comment on the current heartbeat issue:
> _"Handling this privately — switching channels."_

Then DM the CEO directly with:
- Vulnerability class
- File:line
- Attack surface (how an attacker reaches the code from a vault or imported file)
- Blast radius
- Suggested fix

**Do NOT** post PoC payloads, crash inputs, or stack traces in public issue threads or PRs.

---

## 3. Patch process

1. **Write the regression test first.** The crashing input or counterexample becomes a permanent test case before the fix lands. Test must fail on old code, pass on new code.
2. **Fix the class, not the instance.** Example: if `parseFrontmatter` OOMs on oversized input, add a per-key/per-value cap, not just a guard for the specific crashing string.
3. **Verify property tests pass** with the fixed code. Re-run the full fuzz corpus for at least 60 seconds.
4. **PR checklist** (from [SKY-356#document-code-quality-standard](/SKY/issues/SKY-356#document-code-quality-standard)):
   - [ ] Correct across the input space
   - [ ] Regression test seen to fail before the fix, pass after
   - [ ] Green CI (lint, typecheck, tests, build)
   - [ ] `parseFrontmatter` / `safeVaultJoin` property tests still pass
5. **Merge only after green CI.** No `--no-verify`.

---

## 4. Corpus management

After any crash is fixed, add the crashing input so future runs always cover that path:

```bash
# Frontmatter crash
cp <crash-file> electron-main/fuzz/corpus/frontmatter/crash-<date>-<hash>.md
git add electron-main/fuzz/corpus/frontmatter/

# docxInline crash
cp <crash-file> electron-main/fuzz/corpus/docxInline/crash-<date>-<hash>
git add electron-main/fuzz/corpus/docxInline/

git commit -m "fuzz(corpus): add regression seed for <crash-description>"
```

Corpus files are committed to the repo and used as seeds on every CI invocation.

---

## 5. Running extended fuzz sessions

CI uses `-max_total_time=60` (60 seconds per harness). For deeper coverage before a release
or after a significant parser change, run a longer local session:

```bash
cd electron-main

# 1-hour frontmatter session with parallel workers
npx jazzer fuzz/frontmatter.fuzz.ts fuzz/corpus/frontmatter \
  -- -max_total_time=3600 -jobs=4 -artifact_prefix=fuzz/crashes/frontmatter-

# 1-hour docxInline session
npx jazzer fuzz/docxInline.fuzz.ts fuzz/corpus/docxInline \
  -- -max_total_time=3600 -jobs=4 -artifact_prefix=fuzz/crashes/docxInline-
```

Commit any new crash inputs to the corpus per §4 above.

---

## 6. Escalation paths

| Severity | Escalate to | Channel |
|---|---|---|
| Critical | CTO + CEO | Private DM |
| High | CTO | Private DM → private Paperclip issue |
| Medium | FoundingEngineer | Public child of [SKY-361](/SKY/issues/SKY-361) |
| Low | No escalation | Comment on [SKY-361](/SKY/issues/SKY-361) |

If unsure of severity, default to High and escalate to CTO.

---

## 7. Done criteria for a finding

- [ ] Regression test committed (failing on old code, passing on new)
- [ ] Fix merged and CI green
- [ ] Crashing input added to fuzz corpus
- [ ] [SKY-361](/SKY/issues/SKY-361) comment updated: vulnerability class, root cause, fix, residual risk
- [ ] If Critical/High: private advisory thread closed or archived

---

## 8. References

- Inventory: `docs/security/untrusted-input-inventory.md`
- Jazzer.js docs: https://github.com/CodeIntelligenceTesting/jazzer.js
- libFuzzer options: https://llvm.org/docs/LibFuzzer.html
- [SKY-361](/SKY/issues/SKY-361) — this work
- [SKY-356#document-code-quality-standard](/SKY/issues/SKY-356#document-code-quality-standard) — Code Quality Standard §3 (required testing techniques)
