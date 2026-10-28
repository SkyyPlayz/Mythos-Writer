// PLAN-0.5.9 compile-time flags. Every flag stays off. There is no remote-config path.

export const artifactsEngine = false as const;
export const artifactsWriteBackExtended = false as const;

/** Skyy has not answered. Artifact vault data stays gated. */
export const artifactOwnerGate = 'unanswered' as const;

export const PLAN_059_FLAGS = {
  artifactsEngine,
  artifactsWriteBackExtended,
} as const;
