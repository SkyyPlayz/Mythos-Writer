// SKY-11351 — the "bring the vault runtime back online" step shared by the
// success and failure paths of the VAULT_SURFACE_MOVE_VAULTS_PARENT IPC
// handler in main.ts.
//
// Carved into a sibling module because main.ts runs app.whenReady() /
// app.disableHardwareAcceleration() at import time and cannot be loaded under
// vitest without mocking 'electron' end to end (same reason onboardingPaths.ts
// exists — see buildSystemPaths). Keeping the recovery sequence here lets it be
// unit-tested directly with the db module and watchers injected.
//
// The critical invariant this function enforces: reopen the DB
// (ensureVaultDir()/ensureNotesVaultDir() both call openDb()) BEFORE restarting
// the watchers and the writing-scan scheduler. Before SKY-11346, the handler's
// failure path restarted the watchers but never reopened the DB, so a failed
// folder move left getDb() throwing "DB not open" for every vault-scoped IPC
// call until the user restarted the app.

export interface VaultRuntimeRestartDeps {
  /** Reopens the Story Vault DB (via openDb) and re-scaffolds as needed. */
  ensureVaultDir: () => void;
  /** Reopens / re-scaffolds the Notes Vault. */
  ensureNotesVaultDir: () => void;
  /** Restarts the Story Vault file watcher rooted at the given path. */
  startVaultWatcher: (vaultRoot: string) => Promise<void> | void;
  /** Restarts the Notes Vault file watcher rooted at the given path. */
  startNotesVaultWatcher: (notesVaultRoot: string) => Promise<void> | void;
  /** Restarts the periodic writing-scan scheduler. */
  startWritingScanScheduler: () => void;
}

/**
 * Restart the vault runtime after a VAULT_SURFACE_MOVE_VAULTS_PARENT attempt.
 *
 * Order matters: the DB is reopened first so that by the time the watchers fire
 * their first change event (or any concurrent vault-scoped IPC lands), getDb()
 * is already usable. This is the exact sequence the success path runs; sharing
 * it guarantees the failure path can never diverge and strand the DB closed.
 */
export async function restartVaultRuntime(
  vaultRoot: string,
  notesVaultRoot: string,
  deps: VaultRuntimeRestartDeps,
): Promise<void> {
  deps.ensureVaultDir();
  deps.ensureNotesVaultDir();
  await deps.startVaultWatcher(vaultRoot);
  await deps.startNotesVaultWatcher(notesVaultRoot);
  deps.startWritingScanScheduler();
}
