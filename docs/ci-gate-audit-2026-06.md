# CI Gate Audit — 2026-06

**Audited:** 2026-06-02  
**Auditor:** GitHubManager (Paperclip agent)  
**Reference:** [SKY-358 CI gate audit & branch protection](/SKY/issues/SKY-358)  
**Standard:** [Code Quality Standard §4 CI gates](/SKY/issues/SKY-356#document-code-quality-standard)

---

## Scope

| Repo | Default Branch | Workflow file |
|------|---------------|---------------|
| `SkyyPlayz/Mythos-Writer` | `main` | `.github/workflows/ci.yml` |
| `SkyyPlayz/Obsidian-Liquid-Neon` | `main` | `.github/workflows/ci.yml` (stub PR #2) |

---

## Gate Audit — SkyyPlayz/Mythos-Writer

| Gate | Required | Status | Location in workflow |
|------|----------|--------|---------------------|
| **Lint** | ✅ | ✅ Present | `ci` job: `npm run lint -w frontend`; `build-linux` job: same |
| **Typecheck** | ✅ | ✅ Present | `ci` job: `npm run typecheck -w frontend` + `npm run typecheck -w electron-main`; `build-linux`: same |
| **Tests (unit + E2E)** | ✅ | ✅ Present | `ci` job: `npm run test -w electron-main`, `npm run test -w frontend`, E2E suite (vault CRUD, brainstorm, visual capture, writing modes, two-vault, versioned drafts, visual regression, a11y, entity) |
| **Build (production)** | ✅ | ✅ Present | `ci` job: `npm run build:electron`; `build-linux` job: `npm run dist:linux` + AppImage smoke test |

### CI Jobs (status check names)

| Job | Status check name | Notes |
|-----|------------------|-------|
| `ci` | `CI / ci` | Full test + build suite |
| `build-macos` | `CI / build-macos` | Stub (paid runner pending); runs self-hosted to keep check green |
| `build-linux` | `CI / build-linux` | Full Linux AppImage build + smoke test |

### Branch Protection — Mythos-Writer `main`

| Rule | Required | Current State |
|------|----------|--------------|
| Required status checks | ✅ | ❌ **NOT configured** |
| `CI / ci` required | ✅ | ❌ NOT required |
| `CI / build-linux` required | ✅ | ❌ NOT required |
| `CI / build-macos` required | ✅ | ❌ NOT required |
| Require PR before merge | ✅ | ❌ NOT configured |
| No force-push to `main` | ✅ | ❌ NOT configured |
| Linear history | — | ❌ NOT configured (not required to change) |

**Blocker:** A fine-grained GitHub PAT used for this June 2026 audit lacked the
"Administration" write permission required to configure branch protection via
API (REST and GraphQL both return 403). **Do not paste token values here.**
CEO must rotate any token that was ever committed or pasted in full, then
either grant Administration read/write on a new PAT or configure branch
protection manually. Awareness: `git log -S 'github_pat_'` (history rewrite is
out of scope for cleanup PRs).

---

## Gate Audit — SkyyPlayz/Obsidian-Liquid-Neon

**Note:** This repo is in the design/planning phase. No CSS/JS/TS source code exists yet. The repo contains only `README.md`, `LICENSE`, and design spec documents.

| Gate | Required | Status | Notes |
|------|----------|--------|-------|
| **Lint** | ✅ | ⚠️ Stub | PR #2 adds placeholder job — passes immediately |
| **Typecheck** | ✅ | ⚠️ Stub | PR #2 adds placeholder job — passes immediately |
| **Tests** | ✅ | ⚠️ Stub | PR #2 adds placeholder job — passes immediately |
| **Build** | ✅ | ⚠️ Stub | PR #2 adds placeholder job — passes immediately |

### Branch Protection — Obsidian-Liquid-Neon `main`

| Rule | Required | Current State |
|------|----------|--------------|
| Required status checks | ✅ | ❌ **NOT configured** |
| All four gate jobs required | ✅ | ❌ NOT required (workflow stub PR not yet merged) |
| Require PR before merge | ✅ | ❌ NOT configured |
| No force-push to `main` | ✅ | ❌ NOT configured |

**Blockers:**  
1. PR #2 must be merged first (adds the CI workflow with 4 jobs)  
2. Same PAT permission issue prevents API-based branch protection configuration  
3. Follow-up subtask needed under SKY-356 to replace stubs with real tooling once development begins

---

## Actions Required

### Immediate (CEO)

1. **Rotate + update PAT permissions:** If any fine-grained PAT from this audit
   was ever committed or pasted in full, rotate it. Then add
   "Administration → Read and write" (or configure protection in the UI).
   Both `Mythos-Writer` and `Obsidian-Liquid-Neon` must be in scope if using API.
   Path-only reference: GitHub Settings → Developer settings → Fine-grained
   personal access tokens. Do not re-publish token prefixes or values in docs.

2. **Configure Mythos-Writer branch protection** (`main`) with these settings
   (update to match **live** gates — see `docs/REPO_AUDIT.md` §4.2 /
   `CI-PREFLIGHT.md`; as of 2026-09 the PR gates are `CI / ci` +
   `CI / notes-windows`, not packaging jobs):
   - Required status checks: `CI / ci`, `CI / notes-windows`
     (historical note: this audit originally listed `build-linux` /
     `build-macos`; those are no longer PR jobs)
   - Require PR before merge: true (0 approving reviews minimum)
   - Allow force pushes: false
   - Allow deletions: false

3. **Merge PR #2** on `Obsidian-Liquid-Neon` then **configure branch protection** (`main`) with:
   - Required status checks: `CI / lint`, `CI / typecheck`, `CI / test`, `CI / build`
   - Require PR before merge: true
   - Allow force pushes: false

### Follow-up (CTO / subtask under SKY-356)

4. **Replace Obsidian-Liquid-Neon CI stubs** with real tooling once CSS/JS development begins (stylelint, tsc, vitest, build script).

---

## Evidence Links

- Mythos-Writer CI workflow: https://github.com/SkyyPlayz/Mythos-Writer/blob/main/.github/workflows/ci.yml
- Obsidian-Liquid-Neon CI stub PR: https://github.com/SkyyPlayz/Obsidian-Liquid-Neon/pull/2
