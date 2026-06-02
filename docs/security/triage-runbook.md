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
Fuzzer crashes produce a file like `crash-<hash>` or `fuzz-<hash>` in the run directory. Property test failures print a counterexample JSON blob. Save it immediately — CI artifacts expire.

```
# fuzzer: artifact is in the CI job output or artifacts zip
# property test: copy the fc.counterexample line from CI logs
```

### Step 2 — Reproduce locally
```bash
# Property test counterexample
npx vitest run --reporter verbose electron-main/src/vault.property.test.ts

# Fuzzer crash (Jazzer.js)
npx jazzer fuzz:frontmatter -- crash-<hash>
```

If you cannot reproduce, mark as `flaky` and re-run the CI job twice before escalating.

### Step 3 — Classify severity

| Class | Description | Action |
|---|---|---|
| **Critical** | RCE, path escape outside vault root, prototype pollution of Object prototype | File private Paperclip issue immediately, assign SecurityEngineer + CTO. Do not discuss in public |
| **High** | Main-process crash (DoS), silent data corruption, uncapped memory growth | File private issue, assign SecurityEngineer. Patch within 48 h |
| **Medium** | Error swallowed silently, unexpected type coercion passed downstream | File public child of SKY-361, assign FoundingEngineer |
| **Low / Info** | Edge case no attacker can reach, cosmetic output difference | Add to regression corpus, comment on SKY-361 |

### Step 4 — File the issue

**For Critical/High:** post a comment on the current heartbeat issue: _"Handling this privately — switching channels."_ Then DM the CEO directly with:
- Vulnerability class
- File:line
- Attack surface (how an attacker reaches the code)
- Blast radius
- Suggested fix

**Do NOT** post PoC payloads, crash inputs, or stack traces in public issue threads.

---

## 3. Patch process

1. **Write the regression test first.** The crashing input or counterexample becomes a permanent test case before the fix lands. Test must fail on old code, pass on new code.
2. **Fix the class, not the instance.** Example: if `parseFrontmatter` OOMs on oversized input, add a per-key/per-value cap, not just a check for the specific crashing string.
3. **Verify property test passes** with the fixed code. Re-run the full fuzz corpus for at least 60 seconds.
4. **PR checklist** (from [SKY-356#document-code-quality-standard](/SKY/issues/SKY-356#document-code-quality-standard)):
   - [ ] Correct across the input space
   - [ ] Regression test seen to fail before the fix, pass after
   - [ ] Green CI (lint, typecheck, tests, build)
   - [ ] `parseFrontmatter` / `safeVaultJoin` property tests still pass
5. **Merge only after green CI.** No `--no-verify`.

---

## 4. Corpus management

After any crash is fixed:
```bash
# Jazzer.js — add the crashing input to the corpus so it's always re-tested
cp crash-<hash> electron-main/src/__fuzz__/corpus/frontmatter/
git add electron-main/src/__fuzz__/corpus/
git commit -m "fuzz: add regression corpus entry for parseFrontmatter crash"
```

Corpus files are committed to the repo. They run on every CI invocation as seed inputs.

---

## 5. Escalation paths

| Severity | Escalate to | Channel |
|---|---|---|
| Critical | CTO + CEO | Private DM |
| High | CTO | Private DM → private Paperclip issue |
| Medium | FoundingEngineer | Public child of SKY-361 |
| Low | No escalation | Comment on SKY-361 |

If unsure of severity, default to High and escalate to CTO.

---

## 6. Done criteria for a finding

- [ ] Regression test committed (failing on old code, passing on new)
- [ ] Fix merged and CI green
- [ ] Crashing input added to fuzz corpus
- [ ] SKY-361 comment updated: vulnerability class, root cause, fix, residual risk
- [ ] If Critical/High: private advisory thread closed or archived
