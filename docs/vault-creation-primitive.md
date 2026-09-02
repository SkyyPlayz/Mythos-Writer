# The vault-creation primitive (SKY-11151)

One creation option-set — **template** (RECOMMENDED) · **blank** · **import** —
built once and reused everywhere it appears: first run, `New Mythos vault…`, and
Settings `Add vault…`. Only the surrounding chrome differs per caller. This is
the single source of truth in parent spec **SKY-11141 §3 / §3a**.

Module: [`electron-main/src/mythosFormat/createVaultFromOptions.ts`](../electron-main/src/mythosFormat/createVaultFromOptions.ts)
Entry point: `createVaultFromOptions({ destinationParent, name, mode, … })`.

## The IPC surface callers consume

The primitive is pure Node (unit-testable with real tmpdirs). Renderer callers
reach it through **one channel**, so first run, `New Mythos vault…`, and Settings
`Add vault…` all invoke the same option set — only their chrome differs:

```ts
// renderer
window.api.createVaultFromOptions({
  mode: 'template' | 'blank' | 'import',
  destinationParent?: string, // absolute or ~-prefixed; omitted → default Mythos Vaults parent
  name?: string,              // collision-suffixed unless exactName
  exactName?: boolean,
  defaultTheme?: string,      // sanitised main-side to /^[a-z0-9-]{1,64}$/
  importSources?: { kind: 'notes' | 'story'; srcPath: string }[], // import mode: ≥1 required
  activate?: boolean,         // opt-in: make the new vault the open one (first run wants this)
}) // → { ok, mode, mythosRoot, storyVaultPath, notesVaultPath, vaultName, importTally?, error? }
```

- Channel: `IPC_CHANNELS.VAULT_CREATE_FROM_OPTIONS = 'vault:create-from-options'`
  (`electron-main/src/ipc.ts`). The main-side handler
  (`electron-main/src/main.ts`) owns **destination resolution** (`~` expansion +
  default-parent fallback) and **theme-token sanitisation**; the pure primitive
  owns scaffold / seed / import.
- `activate` runs the canonical post-scaffold bookkeeping (persist vault paths,
  add to recents, open DB + manifest cache, restart watchers) — the same
  sequence `onboarding:complete` and the Obsidian importer use. Left `false`,
  the caller owns activation (e.g. "Add vault without switching to it").
- Reachability is proven end-to-end from a fresh profile in
  [`e2e/vault-create-primitive-sky11151.spec.ts`](../e2e/vault-create-primitive-sky11151.spec.ts)
  (each mode creates a vault at a **chosen non-default** location, verified on
  disk; blank stays empty across a full relaunch).

## The three modes

| mode | what lands on disk | seed record (`mythos.json`) |
|---|---|---|
| `blank` | genuine machinery only — `.mythos/`, the three JSON files, empty vault roots. **Nothing the user sees in the tree.** | `mode: 'blank'`, `layout: 'blank@M5'` |
| `template` | the RECOMMENDED *ready shape*: empty top-level folders in the Notes Vault (`Characters/ Locations/ Stories/ Plot/ Worldbuilding/ Research/`). **Folders only — no notes.** | `mode: 'blank'`, `layout: 'template@SKY-11151'` |
| `import` | a **new** vault whose roots are filled by copying the user's source folder(s) byte-for-byte (links/frontmatter untouched, SKY-10383). | `mode: 'blank'`, `layout: 'import@SKY-11151'` |

Every mode scaffolds through `createMythosVault({ seedDemo: false })`. The
generated Veynn **demo** seed is deliberately **not** used by any of the three
options — §3 removes the "generated sample-story path" from first run. `template`
is a shape, not content; `blank` is Obsidian-parity empty; `import` is the user's
own content.

## Obsidian-parity empty, and why it survives a relaunch (§3a)

"Blank" must read as empty **and stay empty** — the real failure mode is a later
start / index-rebuild / health-repair *re-seeding* the folders.

The choice is **persisted on the vault** in `mythos.json`'s `seed` record.
`ensureMythosV2SeedMarker` (the boot guard) refuses to seed whenever that record
is present, so no later path can re-seed a blank or template vault. All three
modes keep `seed.mode: 'blank'` precisely so the re-seed guard treats them all as
"do not seed the demo" — only the free-form `layout` tag differs, for provenance.

> Acceptance test: create blank → relaunch → run any rebuild/repair path →
> folders are still absent. Covered at the unit layer by
> `createVaultFromOptions.test.ts` ("re-seed-proof" case, which drives the boot
> guard directly); the fresh-profile reachability E2E covers it end-to-end.

## Import: always a NEW vault, never adopt the source (§3b)

Import creates a brand-new MythosVault under the chosen parent and copies into it.
It **never** adopts or writes into the source folder (the SKY-11132 rule).

**Coverage, stated honestly — do not claim parity you haven't built:** the
startup creation primitive wires **Obsidian** and **plain-Markdown trees** (both
route through `importObsidianToVaultDir`). **Notion and Scrivener are NOT wired
into this startup primitive** — they exist only in the in-app Settings "Import a
vault" conversion flow (`vaultConvert.ts`), with their own coverage caveats
(Notion CSV database exports skipped; Scrivener flattened to plain markdown).

## What this module deliberately does NOT own

- The wizard screens / Add-vault dialogs that *call* this primitive — that UI
  integration is SKY-11141 §6 step 4 (ProductEngineer). This module exposes a
  clean function surface for them to consume.
- The `template` folder set is the sane shipping default; final copy/layout is
  UX-owned (UXDesigner) and can be tuned without touching creation logic.
