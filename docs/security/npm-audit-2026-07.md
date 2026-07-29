# npm audit — Electron packaging deps (SKY-8622 / GH #1114)

Snapshot: 2026-07-29, `npm audit --json` on a clean `npm ci`.

## Before

13 vulnerabilities (1 critical, 12 high), all rooted in stale
`electron-builder`/`electron-updater` devDependency ranges:

| Package | Severity | Advisory |
|---|---|---|
| `tar` | critical | process-crash DoS (5 stacked CVEs, GHSA-w8wr/23hp/8x88/gvwx/r292) |
| `builder-util-runtime` (electron-updater) | high | `PRIVATE-TOKEN`/`Authorization` leak on cross-origin redirect — GHSA-p2f4-r6v6-j797 |
| `app-builder-lib` (electron-builder) | high | uncontrolled AppImage search-path — GHSA-7g7r-gx96-252g |
| `js-yaml` | high | quadratic-CPU merge-key DoS — GHSA-52cp-r559-cp3m |
| `linkify-it` | high | quadratic `mailto:` DoS — GHSA-v245-v573-v5vm |
| `postcss` | high | source-map path traversal — GHSA-r28c-9q8g-f849 |
| `brace-expansion` | high | exponential-expansion DoS — GHSA-3jxr-9vmj-r5cp |
| + 5 more electron-builder-family packages pulled in transitively | high | same builder-util-runtime chain |

## Fix

Bumped the two devDependency ranges that own this whole tree
(`package.json` root + `electron-main/package.json`, which ships
`electron-updater` at runtime):

- `electron-builder`: `^26.8.1` → `^26.15.7` (latest stable `v26`; `27.x` is
  alpha-only, not adopted — see below)
- `electron-updater`: `^6.3.9` → `^6.8.9` (latest stable `v6`)

Followed by `npm audit fix` (non-force) for the remaining leaf packages
(`tar`, `js-yaml`, `linkify-it`, `postcss`) that had non-breaking fixes.

**Result: 0 critical, 0 moderate.** All 13 originally-reported advisories are
gone, including the two that mattered most:

- The `electron-updater` credential-leak path (GHSA-p2f4-r6v6-j797) — fixed,
  confirmed by `builder-util-runtime` no longer appearing in `npm audit`.
- The AppImage search-path issue (GHSA-7g7r-gx96-252g, range `<26.15.0`) —
  fixed by the `26.15.7` bump, confirmed via the advisory's own version range.

## Remaining: 27 high, cannot upgrade without a breaking/regressive change

`npm audit` now reports 27 high-severity findings, all cascading from ONE
advisory — GHSA-mh99-v99m-4gvg (`brace-expansion` unbounded-expansion DoS) —
via **`minimatch`**, bundled inside two independent devDependency toolchains:

1. **`eslint@8.57.1`**'s own dependency tree (`@eslint/eslintrc`,
   `@humanwhocodes/config-array`, `file-entry-cache`, `flat-cache`, `glob`,
   `rimraf`) and `@typescript-eslint/*` (which depends on `eslint`).
2. **`electron-builder@26.15.7`**'s packaging toolchain
   (`@electron/asar`, `@electron/universal`, `app-builder-lib`,
   `dmg-builder`, `electron-builder-squirrel-windows`, `electron-winstaller`,
   `dir-compare`, `jake`/`ejs`/`filelist`, used for asar/AppImage/deb/Squirrel
   packaging steps).

Verified upstream fix status:

- `eslint`'s only fix is a major version bump to `10.x` — a flat-config
  migration across the whole lint pipeline. Out of scope for a dependency
  patch; tracked as follow-up (see below).
- `electron-builder`'s only fix is `27.0.0-alpha.6` (confirmed via
  `npm view app-builder-lib@27.0.0-alpha.6 dependencies` — bumps
  `minimatch` to `^10.2.5`). `27.x` has no stable release yet. Shipping
  prerelease packaging tooling for a beta release is a worse risk than the
  advisory itself.
- `npm audit fix --force` was tested and rejected: it silently resolves
  `electron-builder` down to `25.1.8` (a regression, not a fix) and `eslint`
  to `7.22.0`/`10.x` depending on the package — neither is a real remediation.

### Reachability

`GHSA-mh99-v99m-4gvg` is a denial-of-service triggered by parsing an
attacker-supplied brace-expansion glob pattern. Every affected package here is
a **devDependency**, invoked only:

- at lint time (`eslint`), against glob patterns we author ourselves
  (`.eslintrc`/ignore patterns) — never against user or network input, or
- at package time (`electron-builder` family, `npm run dist:*`), against our
  own repo's file globs — never against attacker-controlled or downloaded
  content.

None of these packages, or the glob patterns they evaluate, are reachable by
an end user of the shipped app or by network input at runtime. Exploiting this
would require the attacker to already control the repo or CI config, at which
point the DoS is not the binding risk.

### Mitigation

No code change needed — not reachable. Tracked separately, not blocking this
fix:

- `eslint@8 → 10` flat-config migration.
- Revisit `electron-builder@27.x` once it leaves alpha.

## Verification run (2026-07-29, this branch)

- `npm run typecheck` — pass
- `frontend` lint (`eslint src --ext .ts,.tsx --max-warnings 0`) — pass, 0 findings
- `npm run test` — 132+251 files, 3454+4543 tests pass (1 pre-existing skip)
- `npm run build:electron` — pass
- `npm run dist:linux` (AppImage + deb, `LD_LIBRARY_PATH=""` per the CI
  liblzma-shadow workaround) — both artifacts build; `dpkg-deb --info`
  verifies the `.deb`; Xvfb smoke test starts and stops the AppImage cleanly.
- `dist:mac` not run locally (no macOS host available) — the only change
  reaching macOS packaging is the same `electron-builder`/`electron-updater`
  version bump exercised above on Linux; no platform-specific packaging code
  changed.
