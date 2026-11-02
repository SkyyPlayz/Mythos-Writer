// Compile-time 0.5.9 feature flags and owner-gate guard: renderer-only, no runtime/IPC/settings/env path (plan R7).
import { version as APP_VERSION } from '../package.json';

/** Release channel. Beta builds carry a `-beta.N` prerelease version or are built with VITE_MYTHOS_CHANNEL=beta. */
export type ReleaseChannel = 'stable' | 'beta';

/** The 0.5.9 flags, matched by exact name only (no prefix, substring or regex). */
export const ZERO_FIVE_NINE_FLAGS = ['widgetShell', 'artifactsEngine', 'artifactsWriteBackExtended', 'localEngine'] as const;

export type FeatureFlagName = (typeof ZERO_FIVE_NINE_FLAGS)[number];

/**
 * Pure channel resolution. `override` (the build-time VITE_MYTHOS_CHANNEL) can only force `beta`; any other value is ignored.
 * Otherwise a semver prerelease tag starting `beta` (0.5.9-beta.1) is beta; no prerelease or any other tag (rc) is stable.
 */
export function resolveChannel(version: string, override: string | undefined): ReleaseChannel {
  if (override === 'beta') return 'beta';
  return /^\d+\.\d+\.\d+-beta(?:[.+-].*)?$/.test(version) ? 'beta' : 'stable';
}

/** Resolved at build time only: Vite inlines VITE_MYTHOS_CHANNEL and the JSON import. */
export const BUILD_CHANNEL: ReleaseChannel = resolveChannel(APP_VERSION, import.meta.env.VITE_MYTHOS_CHANNEL);

/** Default value of every 0.5.9 flag per channel. A beta ON needs a logged yes in OWNER_YES_LOG. */
export const FLAG_DEFAULTS: Readonly<Record<ReleaseChannel, Readonly<Record<FeatureFlagName, boolean>>>> = {
  stable: { widgetShell: false, artifactsEngine: false, artifactsWriteBackExtended: false, localEngine: false },
  beta: { widgetShell: true, artifactsEngine: true, artifactsWriteBackExtended: false, localEngine: true },
};

/**
 * Where the owner said yes to a beta-ON default. null = no yes logged yet, so the flag must stay OFF in beta.
 * artifactsWriteBackExtended stays null until the Shield FULL entry at the S3 tip is logged (its flip PR sets this and FLAG_DEFAULTS together).
 */
export const OWNER_YES_LOG: Readonly<Record<FeatureFlagName, string | null>> = {
  widgetShell: 'owner-answers.md 2026-10-26 5:01 AM (beta.1 default ON, Q-D)',
  artifactsEngine: 'owner-answers.md 2026-10-26 5:11 AM (Q-A)',
  artifactsWriteBackExtended: null,
  localEngine: 'owner-answers.md 2026-10-26 5:11 AM (Q-A)',
};

export const featureFlags: Readonly<{
  widgetShell: boolean;
  artifactsEngine: boolean;
  artifactsWriteBackExtended: boolean;
  localEngine: boolean;
}> = Object.freeze({ ...FLAG_DEFAULTS[BUILD_CHANNEL] });

/**
 * One boolean per owner-gate row, all false until the owner opens that item. Not flags: nothing flips them at build time.
 * Slices route every write a flag cannot undo (persisted layouts, vault data, installer contents) through whenOwnerGate.
 */
export const ownerGates = Object.freeze({
  /** S1c: write `layoutV3` to the settings store. */
  s1cLayoutV3Persist: false,
  /** S2: per-vault and preset layouts. */
  s2PerVaultLayouts: false,
  /** S3: artifact vault data under `<vault>/.mythos/artifacts` and `userData/artifacts`, plus write-back. */
  s3ArtifactVaultData: false,
  /** S4: llama.cpp binary in the installers. */
  s4LlamaInInstallers: false,
});

export type OwnerGateName = keyof typeof ownerGates;

/** Runs `write` only when that gate is open. Returns its result, or undefined when the gate is closed (write never called). `gates` is injectable for tests. */
export function whenOwnerGate<T>(
  gate: OwnerGateName,
  write: () => T,
  gates: Readonly<Record<OwnerGateName, boolean>> = ownerGates,
): T | undefined {
  return gates[gate] === true ? write() : undefined;
}

const EXPECTED_BETA: Readonly<Record<FeatureFlagName, boolean>> = {
  widgetShell: true,
  artifactsEngine: true,
  artifactsWriteBackExtended: false,
  localEngine: true,
};

const has = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Checks flag defaults against the allowlist and the owner yes-log. Returns human-readable violations, [] when clean.
 * Names match the allowlist exactly. Defaults are typed loosely so tests can inject unknown flags.
 */
export function checkFlagDefaults(
  defaults: Readonly<Record<string, Readonly<Record<string, boolean>>>>,
  yesLog: Readonly<Record<string, string | null | undefined>>,
  allowlist: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const channel of ['stable', 'beta']) {
    const flags = has(defaults, channel) ? defaults[channel] : undefined;
    if (!flags) {
      violations.push(`${channel}: channel defaults are missing`);
      continue;
    }
    for (const name of Object.keys(flags)) {
      if (!allowlist.includes(name)) violations.push(`${channel}: flag "${name}" is not on the 0.5.9 allowlist (exact match only)`);
    }
    for (const name of allowlist) {
      if (!has(flags, name)) violations.push(`${channel}: allowlisted flag "${name}" has no default`);
    }
    for (const name of Object.keys(flags)) {
      if (flags[name] !== true) continue;
      if (channel === 'stable') {
        violations.push(`stable: flag "${name}" is ON; every 0.5.9 flag must be OFF in stable`);
      } else {
        const yes = has(yesLog, name) ? yesLog[name] : undefined;
        if (typeof yes !== 'string' || yes.trim() === '') violations.push(`beta: flag "${name}" is ON without a logged owner yes`);
      }
    }
    if (channel === 'beta') {
      for (const name of Object.keys(EXPECTED_BETA) as FeatureFlagName[]) {
        if (!allowlist.includes(name) || !has(flags, name)) continue;
        if (flags[name] !== EXPECTED_BETA[name]) {
          violations.push(`beta: flag "${name}" is ${flags[name] ? 'ON' : 'OFF'}, expected ${EXPECTED_BETA[name] ? 'ON' : 'OFF'}`);
        }
      }
    }
  }
  return violations;
}
