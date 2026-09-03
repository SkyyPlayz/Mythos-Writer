// SKY-11375: resolve which Notes Vault a `project:switch` repoints to.
//
// THE bug this exists to kill: the switch handler used to fall back to
// `getNotesVaultRoot()` — which resolves the *currently-active* (i.e.
// OUTGOING) vault's notes root — whenever the incoming vault had no paired
// notes root. Switching to such a vault then repointed it at ANOTHER vault's
// notes directory, so a note written in vault A appeared in vault B and edits
// propagated between them (cross-vault content bleed — the worst failure class
// a writing app can ship).
//
// The fix: for a MythosVault v2 vault the notes registry inside its own
// structure is authoritative (`structuralNotesRoot`). Only a legacy twin-root
// vault (no registry) may fall back to the recents pairing, and only such a
// vault — with neither a supplied nor a paired root — reaches the historical
// active-vault fallback (`active-fallback`), which is documented as a
// last-resort for vaults that predate structural resolution.
//
// Pure data (no fs, no Electron) so the exact bleed scenario is unit-testable
// at the resolution level, per SKY-11375 AC#6 ("assert the resolved roots
// differ per vault").

export interface SwitchNotesResolutionInput {
  /** notesVaultRoot the renderer passed, already type-validated to a
   *  non-empty string, or null when the caller omitted it. */
  suppliedNotesRoot: string | null;
  /** Notes Vault resolved from the INCOMING story vault's own MythosVault
   *  registry, or null for a legacy twin-root vault with no registry. */
  structuralNotesRoot: string | null;
  /** Notes Vault paired with the incoming vault in the recents allowlist,
   *  or null when the entry predates pairing (SKY-320). */
  pairedNotesRoot: string | null;
  /** The OUTGOING (currently active) vault's notes root. Legacy last resort
   *  ONLY — never used for a vault that resolves structurally. */
  activeNotesRoot: string;
}

export type NotesRootSource =
  | 'registry'                    // v2 structural registry — authoritative
  | 'registry-overrode-supplied'  // v2 registry chosen over a disagreeing supplied root
  | 'supplied'                    // legacy vault, renderer-supplied root (no pairing on file)
  | 'recents-pair'                // legacy vault, recents pairing
  | 'active-fallback';            // legacy vault, nothing else known (historical behavior)

export type SwitchNotesResolution =
  | { ok: true; notesVaultRoot: string; source: NotesRootSource }
  | { ok: false; error: string };

export function resolveSwitchNotesRoot(
  input: SwitchNotesResolutionInput,
): SwitchNotesResolution {
  const { suppliedNotesRoot, structuralNotesRoot, pairedNotesRoot, activeNotesRoot } = input;

  // Belt-and-suspenders: the IPC handler already rejects a non-string; an
  // empty string here is still invalid.
  if (suppliedNotesRoot !== null && suppliedNotesRoot.length === 0) {
    return { ok: false, error: 'notesVaultRoot: must be a non-empty string' };
  }

  // v2 vault: the on-disk notes registry is authoritative and the
  // renderer-supplied root is advisory only — it is IGNORED here rather than
  // rejected. Ignoring (not rejecting) is what makes this both safe and
  // non-breaking:
  //   - Security (SKY-320): a compromised renderer cannot inject a foreign
  //     notes root for a v2 vault — we never repoint at anything but the
  //     structural root, so no never-seen pair can be assembled.
  //   - Correctness (SKY-11375): a stale renderer that still holds the
  //     previously-active notes root (e.g. after the user switched the active
  //     notes vault within this MythosVault — SKY-11058) can neither block the
  //     switch nor re-introduce the bleed; the registry's current active vault
  //     always wins.
  if (structuralNotesRoot) {
    const disagrees = suppliedNotesRoot !== null && suppliedNotesRoot !== structuralNotesRoot;
    return {
      ok: true,
      notesVaultRoot: structuralNotesRoot,
      source: disagrees ? 'registry-overrode-supplied' : 'registry',
    };
  }

  // Legacy twin-root vault: no registry to resolve from — preserve SKY-320.
  if (suppliedNotesRoot !== null) {
    if (pairedNotesRoot && pairedNotesRoot !== suppliedNotesRoot) {
      return { ok: false, error: 'notesVaultRoot: does not match the paired entry in recent-projects' };
    }
    return { ok: true, notesVaultRoot: suppliedNotesRoot, source: pairedNotesRoot ? 'recents-pair' : 'supplied' };
  }
  if (pairedNotesRoot) {
    return { ok: true, notesVaultRoot: pairedNotesRoot, source: 'recents-pair' };
  }
  // Nothing structural, nothing supplied, nothing paired. This is the only
  // path that can still land on the outgoing vault's notes root, and it is
  // reachable ONLY for legacy vaults that carry no pairing — v2 vaults never
  // get here because structuralNotesRoot is set.
  return { ok: true, notesVaultRoot: activeNotesRoot, source: 'active-fallback' };
}
