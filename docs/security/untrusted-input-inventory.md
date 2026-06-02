# Untrusted-Input Inventory — Mythos Writer

> **Maintained by:** SecurityEngineer (SKY-361)
> **Last updated:** 2026-06-02
> **Reference:** Code Quality Standard §3 (SKY-356)

This document lists every parser, serializer, file-format reader, network-protocol
decoder, and user-input handler in the Mythos Writer codebase, along with the current
testing status for each.

**Status legend:**
- `none` — no tests at all
- `example-only` — only hand-written example tests (happy-path + a few edge cases)
- `property` — fast-check property-based tests in place
- `fuzz` — Jazzer.js coverage-guided fuzzer in place

---

## electron-main / src

| File:line range | Kind | Description | Trust level | Testing status |
|---|---|---|---|---|
| `vault.ts:293-318` | parser | `parseFrontmatter` — hand-rolled YAML frontmatter parser; called on every `.md` file during Obsidian vault import and on vault reads | **untrusted** (attacker-controlled files in Obsidian import) | **property + fuzz** ✅ |
| `vault.ts:323-335` | serializer | `serializeFrontmatter` — serializes frontmatter back to `---\nkey: val\n---\n` format | internal (writes app-generated data) | **property** ✅ |
| `vault.ts:657-717` | parser/importer | `importObsidianVault` — walks an arbitrary user-supplied path, reads all `.md` files, calls `parseFrontmatter` | **untrusted** (user-chosen Obsidian vault path; every file is attacker-controlled) | example-only |
| `vault/safeVaultJoin.ts:1-end` | security boundary | Path-traversal protection for all vault file ops; validates renderer-supplied paths against the vault root | **untrusted** (all renderer-supplied paths) | example-only (extensive) |
| `migration.ts:1-end` | parser | Legacy chapter migration; calls `parseFrontmatter` + `serializeFrontmatter` on discovered `.md` files | **untrusted** (on-disk files from legacy vault) | example-only |
| `docx.ts:37-68` | parser | `inlineRuns` — inline markdown parser (`**bold**`, `_italic_`, `*italic*`) using a look-ahead/look-behind regex | semi-trusted (user prose; can be Obsidian-import-origin) | **fuzz** (indirect via `buildDocx`) ✅ |
| `docx.ts:70-end` | serializer | `buildDocx` — manuscript → OOXML ZIP | internal (user-authored content) | **property + fuzz** ✅ |
| `epub.ts:33-40` | serializer | `escapedHtml` — HTML-escapes prose for XHTML embedding; output-handling critical path | semi-trusted (user prose; can be Obsidian-import-origin) | **property + fuzz** ✅ |
| `epub.ts:41-50` | serializer | `proseToHtml` — double-newline → `<p>` conversion with `escapedHtml` | semi-trusted | **property** (indirect via `buildEpub`) ✅ |
| `epub.ts:158-end` | serializer | `buildEpub` — manuscript → EPUB 3 ZIP | internal (user-authored content) | **property + fuzz** ✅ |
| `manifest.ts:1-end` | parser/serializer | JSON manifest; `openManifest` parses disk JSON; `writeManifestAtomic` serializes; `migrateManifest` transforms raw objects | semi-trusted (on-disk file; renderer cannot write manifest.json directly) | example-only |
| `manifestValidate.ts:1-end` | validator | `assertValidManifest` — validates renderer-supplied Manifest at the IPC boundary; type, length, count, and path-prefix checks | **untrusted** (renderer is an untrusted context in Electron threat model) | example-only |
| `validatePathUtil.ts:1-end` | validator | `validatePathForVault` — validates onboarding path-picker input | **untrusted** (user input) | example-only |
| `db.ts:1-end` | parser | SQLite FTS5 queries; entity/scene CRUD; `search.ts` builds query strings | **untrusted** (search queries from renderer) | example-only |
| `provider.ts:1-end` | parser | AI provider config (model name, base URL); parses user-supplied API key and endpoint | **untrusted** (user-supplied API key + endpoint) | example-only |
| `templates.ts:1-end` | parser | Prompt template rendering (Obsidian-style `{{variable}}` substitution) | semi-trusted (templates are app-defined; variables are user content) | example-only |
| `ipc.ts:1-end` | boundary | IPC channel registry; all renderer↔main messages pass through this | **untrusted** (renderer is untrusted; every handler must re-validate) | none (coverage by callee tests) |
| `ipcErrors.ts:1-end` | serializer | Structured IPC error envelope | internal | example-only |
| `bgLoad.ts:1-end` | parser | Background vault file loader | semi-trusted | none |
| `noteBacklinks.ts:1-end` | parser | `[[wikilink]]` backlink scanner | semi-trusted (reads on-disk files) | example-only |
| `notesTagWrangler.ts:1-end` | parser | Tag extraction from frontmatter | semi-trusted | example-only |

---

## frontend / src

| File:line range | Kind | Description | Trust level | Testing status |
|---|---|---|---|---|
| TipTap editor (various) | parser | Markdown/ProseMirror document parsing in the browser renderer | semi-trusted | example-only |
| Search input handlers | user input | FTS search query strings forwarded to main via IPC | **untrusted** | example-only |

---

## Highest-risk items (priority order)

1. **`parseFrontmatter` + `importObsidianVault`** — fully attacker-controlled bytes from any `.md` file in an arbitrary directory; hand-rolled parser with potential regex pathologies.  
   → ✅ Property tests and Jazzer.js fuzzer added (SKY-361).

2. **`safeVaultJoin`** — single chokepoint for all path traversal defense.  
   → Extensive example tests exist; property/fuzz follow-up recommended (file new issue if findings emerge from P1).

3. **`assertValidManifest`** — IPC boundary; renderer can supply arbitrary JSON.  
   → Example tests exist; property tests recommended as follow-up.

4. **`escapedHtml` / `proseToHtml`** — XSS-class if escaping misses a character.  
   → ✅ Property tests and Jazzer.js fuzzer added (SKY-361).

---

## Gap analysis and follow-up work

| Gap | Recommended action |
|---|---|
| `importObsidianVault` has no property/fuzz tests | Add harness targeting `importObsidianVault` with a synthetic vault directory tree |
| `assertValidManifest` only has example tests | Add property tests for arbitrary renderer-supplied objects (prototype pollution, extremely large arrays) |
| `noteBacklinks.ts` `[[wikilink]]` parser has no tests | Add fault-tolerance + roundtrip property tests |
| `provider.ts` URL parsing (user-supplied AI endpoint) | Add property tests verifying SSRF-relevant URL normalization |
| `db.ts` FTS5 query construction | Verify parameterized queries via property tests; static analysis of any `WHERE` string concatenation |
