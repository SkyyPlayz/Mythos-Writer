// Owner-gate and flag-default harness (N5): beta profile + all gates false means zero writes; GUARD_MUTANT must turn the cases red.
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLAG_DEFAULTS,
  OWNER_YES_LOG,
  ZERO_FIVE_NINE_FLAGS,
  checkFlagDefaults,
  featureFlags,
  ownerGates,
  resolveChannel,
  whenOwnerGate,
  type FeatureFlagName,
  type OwnerGateName,
} from './featureFlags';
import { announceLayout, describeLayoutChange, disposeLayoutAnnouncer } from './frame/layoutAnnouncer';
import {
  DOCK_EDGES,
  FRAME_WIDGETS,
  frameReducer,
  initialFrameState,
  type FrameAction,
  type FrameState,
} from './frame/widgetRegistry';

// Every S1a storageAdapter export is replaced by a spy, so any write that routes through it is counted.
vi.mock('./frame/storageAdapter', () => ({
  settingsGet: vi.fn(),
  settingsGetIfPresent: vi.fn(),
  settingsGetOrNull: vi.fn(),
  settingsSet: vi.fn(),
  settingsSetIfPresent: vi.fn(),
}));
import * as storageAdapter from './frame/storageAdapter';

type Guard = <T>(gate: OwnerGateName, write: () => T) => T | undefined;

/** The real guard bound to the shipped gates (all false). */
const realGuard: Guard = (gate, write) => whenOwnerGate(gate, write, ownerGates);
/** A guard with the gate check removed. Same cases run through it must produce writes, which proves the cases can detect a missing guard. */
const GUARD_MUTANT: Guard = (_gate, write) => write();

type SinkName = 'settingsStore' | 'vaultLayout' | 'vaultArtifacts' | 'userDataArtifacts' | 'installerManifest';

interface Sinks {
  writes: Array<{ sink: SinkName; target: string }>;
  settingsStore: (settings: Record<string, unknown>) => void;
  vaultLayout: (vault: string, layout: unknown) => void;
  vaultArtifacts: (file: string) => void;
  userDataArtifacts: (file: string) => void;
  installerManifest: (entry: string) => void;
}

/** Spied writers standing in for the real targets; each records into `writes`. */
function createSinks(): Sinks {
  const writes: Sinks['writes'] = [];
  const record = (sink: SinkName, target: string) => { writes.push({ sink, target }); };
  return {
    writes,
    settingsStore: vi.fn((settings: Record<string, unknown>) => record('settingsStore', Object.keys(settings).join(','))),
    vaultLayout: vi.fn((vault: string, _layout: unknown) => record('vaultLayout', path.join(vault, '.mythos', 'layouts.json'))),
    vaultArtifacts: vi.fn((file: string) => record('vaultArtifacts', file)),
    userDataArtifacts: vi.fn((file: string) => record('userDataArtifacts', file)),
    installerManifest: vi.fn((entry: string) => record('installerManifest', entry)),
  };
}

interface GatedWriteCase {
  id: string;
  /** Owner-gate row this write belongs to. */
  gate: OwnerGateName;
  run: (guard: Guard, sinks: Sinks) => void;
}

const VAULT = path.join('vault-root', 'My Vault');

/**
 * Later slices extend this table: S1c, S2 and S3 each APPEND one case per new non-flag-reversible write.
 * A case calls the production write path through `guard(gate, () => <write>)` (swap the synthetic sink call for the
 * real function once it exists, with its dependency spied) and names the gate row it belongs to. Do not add cases
 * to any other list; the zero-write test and the GUARD_MUTANT test both iterate this table.
 */
const GATED_WRITE_CASES: GatedWriteCase[] = [
  {
    id: 'S1c layoutV3 settings write',
    gate: 's1cLayoutV3Persist',
    run: (guard, sinks) => { guard('s1cLayoutV3Persist', () => sinks.settingsStore({ layoutV3: { version: 3 } })); },
  },
  {
    id: 'S2 per-vault layout write',
    gate: 's2PerVaultLayouts',
    run: (guard, sinks) => { guard('s2PerVaultLayouts', () => sinks.vaultLayout(VAULT, { preset: 'writer' })); },
  },
  {
    id: 'S3 artifact vault write',
    gate: 's3ArtifactVaultData',
    run: (guard, sinks) => {
      guard('s3ArtifactVaultData', () => sinks.vaultArtifacts(path.join(VAULT, '.mythos', 'artifacts', 'a1.json')));
    },
  },
  {
    id: 'S3 userData artifacts write',
    gate: 's3ArtifactVaultData',
    run: (guard, sinks) => {
      guard('s3ArtifactVaultData', () => sinks.userDataArtifacts(path.join('userData', 'artifacts', 'a1.json')));
    },
  },
  {
    id: 'S4 llama binary in installer manifest',
    gate: 's4LlamaInInstallers',
    run: (guard, sinks) => { guard('s4LlamaInInstallers', () => sinks.installerManifest('llama-server')); },
  },
];

/** Names of the cases that wrote at least once through `guard`. */
function casesThatWrote(guard: Guard): string[] {
  return GATED_WRITE_CASES.filter((c) => {
    const sinks = createSinks();
    c.run(guard, sinks);
    return sinks.writes.length > 0;
  }).map((c) => c.id);
}

interface WriteSpies {
  apiSettingsSet: ReturnType<typeof vi.fn>;
  apiSettingsGet: ReturnType<typeof vi.fn>;
  localSetItem: ReturnType<typeof vi.spyOn>;
  sessionSetItem: ReturnType<typeof vi.spyOn>;
}

/** Spies on the object that owns `setItem` for this storage (the prototype in jsdom, where spying on the instance would store a key named setItem). */
function spyOnSetItem(storage: Storage): ReturnType<typeof vi.spyOn> {
  let owner: object = storage;
  while (!Object.prototype.hasOwnProperty.call(owner, 'setItem')) {
    const next = Object.getPrototypeOf(owner) as object | null;
    if (!next) throw new Error('Storage.setItem not found');
    owner = next;
  }
  return vi.spyOn(owner as Storage, 'setItem');
}

let spies: WriteSpies;
let savedApi: unknown;

beforeEach(() => {
  savedApi = (window as unknown as { api?: unknown }).api;
  const apiSettingsSet = vi.fn().mockResolvedValue({ saved: true });
  const apiSettingsGet = vi.fn().mockResolvedValue({});
  (window as unknown as { api: unknown }).api = { settingsSet: apiSettingsSet, settingsGet: apiSettingsGet };
  window.localStorage.clear();
  window.sessionStorage.clear();
  spies = { apiSettingsSet, apiSettingsGet, localSetItem: spyOnSetItem(window.localStorage),
    sessionSetItem: spyOnSetItem(window.sessionStorage),
  };
  vi.mocked(storageAdapter.settingsSet).mockClear();
  vi.mocked(storageAdapter.settingsSetIfPresent).mockClear();
});

afterEach(() => {
  (window as unknown as { api: unknown }).api = savedApi;
  spies.localSetItem.mockRestore();
  spies.sessionSetItem.mockRestore();
  disposeLayoutAnnouncer();
});

function expectNoShellWrites(): void {
  expect(spies.apiSettingsSet).not.toHaveBeenCalled();
  expect(spies.apiSettingsGet).not.toHaveBeenCalled();
  expect(storageAdapter.settingsSet).not.toHaveBeenCalled();
  expect(storageAdapter.settingsSetIfPresent).not.toHaveBeenCalled();
  expect(spies.localSetItem).not.toHaveBeenCalled();
  expect(spies.sessionSetItem).not.toHaveBeenCalled();
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
}

/** Drives the whole S1b frame in memory: unlock, every widget to every edge, duplicate, close the copy, lock; announces each change. */
function driveS1bFrame(): { finalState: FrameState; messages: string[] } {
  const messages: string[] = [];
  let state = initialFrameState();
  const apply = (action: FrameAction) => {
    const before = state;
    state = frameReducer(state, action);
    const message = describeLayoutChange(action, before, state);
    if (message) {
      messages.push(message);
      announceLayout(message);
    }
  };
  apply({ type: 'unlock' });
  for (const def of FRAME_WIDGETS) {
    for (const edge of DOCK_EDGES) apply({ type: 'move', id: def.kind, edge });
  }
  apply({ type: 'duplicate', id: 'leftSidebar' });
  const copy = state.instances.find((inst) => inst.copy > 0);
  if (!copy) throw new Error('duplicate did not add a copy');
  for (const edge of DOCK_EDGES) apply({ type: 'move', id: copy.id, edge });
  apply({ type: 'close', id: copy.id });
  apply({ type: 'lock' });
  return { finalState: state, messages };
}

describe('owner gates', () => {
  it('ships every gate false, one per owner-gate row', () => {
    expect(ownerGates).toEqual({
      s1cLayoutV3Persist: false,
      s2PerVaultLayouts: false,
      s3ArtifactVaultData: false,
      s4LlamaInInstallers: false,
    });
    expect(Object.isFrozen(ownerGates)).toBe(true);
  });

  it('whenOwnerGate skips the write with a closed gate and runs it with an injected open gate', () => {
    const write = vi.fn(() => 'wrote');
    expect(whenOwnerGate('s1cLayoutV3Persist', write)).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    const open = { ...ownerGates, s1cLayoutV3Persist: true };
    expect(whenOwnerGate('s1cLayoutV3Persist', write, open)).toBe('wrote');
    expect(whenOwnerGate('s2PerVaultLayouts', write, open)).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('has at least one gated write case for every gate row', () => {
    for (const gate of Object.keys(ownerGates) as OwnerGateName[]) {
      expect(GATED_WRITE_CASES.some((c) => c.gate === gate), `no case for ${gate}`).toBe(true);
    }
  });

  it('every gated write case does zero writes with all gates false', () => {
    expect(casesThatWrote(realGuard)).toEqual([]);
    for (const c of GATED_WRITE_CASES) {
      const sinks = createSinks();
      c.run(realGuard, sinks);
      expect(sinks.writes, c.id).toEqual([]);
      expect(sinks.settingsStore).not.toHaveBeenCalled();
      expect(sinks.vaultLayout).not.toHaveBeenCalled();
      expect(sinks.vaultArtifacts).not.toHaveBeenCalled();
      expect(sinks.userDataArtifacts).not.toHaveBeenCalled();
      expect(sinks.installerManifest).not.toHaveBeenCalled();
    }
    expectNoShellWrites();
  });

  it('GUARD_MUTANT (gate check removed) turns every gated write case red', () => {
    // If a case still passed under the mutant it could not detect a missing guard.
    expect(casesThatWrote(GUARD_MUTANT)).toEqual(GATED_WRITE_CASES.map((c) => c.id));
  });

  it('GUARD_MUTANT writes to the exact gated targets', () => {
    const sinks = createSinks();
    for (const c of GATED_WRITE_CASES) c.run(GUARD_MUTANT, sinks);
    const targets = sinks.writes.map((w) => `${w.sink}:${w.target}`);
    expect(targets).toContain('settingsStore:layoutV3');
    expect(targets).toContain(`vaultLayout:${path.join(VAULT, '.mythos', 'layouts.json')}`);
    expect(targets).toContain(`vaultArtifacts:${path.join(VAULT, '.mythos', 'artifacts', 'a1.json')}`);
    expect(targets).toContain(`userDataArtifacts:${path.join('userData', 'artifacts', 'a1.json')}`);
    expect(targets).toContain('installerManifest:llama-server');
  });
});

describe('S1b shell writes nothing', () => {
  it('stable profile: the full frame flow does zero writes', () => {
    const { finalState, messages } = driveS1bFrame();
    expect(finalState.locked).toBe(true);
    expect(finalState.instances.every((inst) => inst.copy === 0)).toBe(true);
    expect(messages.length).toBeGreaterThan(10);
    expect(messages[0]).toBe('Layout unlocked. Widgets can be moved and duplicated.');
    expect(messages[messages.length - 1]).toBe('Layout locked.');
    expectNoShellWrites();
  });

  it('beta profile (flags ON) with all gates false: the full frame flow does zero writes', () => {
    const profile = FLAG_DEFAULTS.beta;
    expect(profile.widgetShell).toBe(true);
    expect(Object.values(ownerGates).every((open) => open === false)).toBe(true);
    const { messages } = driveS1bFrame();
    expect(messages.some((m) => m === 'Story navigator duplicated as Story navigator (copy 2).')).toBe(true);
    expect(messages.some((m) => m === 'Story navigator (copy 2) closed.')).toBe(true);
    expect(messages.some((m) => m === 'Assistant moved to the bottom.')).toBe(true);
    expectNoShellWrites();
  });

  it('the S1b flow plus every gated write case still does zero writes in beta with gates false', () => {
    driveS1bFrame();
    expect(casesThatWrote(realGuard)).toEqual([]);
    expectNoShellWrites();
  });

  it('the write spies do detect a write (the zero-write checks are not vacuous)', () => {
    window.localStorage.setItem('k', 'v');
    window.sessionStorage.setItem('k', 'v');
    void window.api.settingsSet({} as AppSettings);
    expect(spies.localSetItem.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(spies.sessionSetItem.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(spies.apiSettingsSet).toHaveBeenCalledTimes(1);
    void storageAdapter.settingsSet({} as AppSettings);
    expect(storageAdapter.settingsSet).toHaveBeenCalledTimes(1);
  });
});

describe('feature flag defaults', () => {
  it('lists exactly the four 0.5.9 flags', () => {
    expect([...ZERO_FIVE_NINE_FLAGS]).toEqual(['widgetShell', 'artifactsEngine', 'artifactsWriteBackExtended', 'localEngine']);
    expect(Object.keys(featureFlags).sort()).toEqual([...ZERO_FIVE_NINE_FLAGS].sort());
  });

  it('defaults pass the check', () => {
    expect(checkFlagDefaults(FLAG_DEFAULTS, OWNER_YES_LOG, ZERO_FIVE_NINE_FLAGS)).toEqual([]);
  });

  it('beta turns widgetShell, artifactsEngine, localEngine on and artifactsWriteBackExtended off; stable is all off', () => {
    expect(FLAG_DEFAULTS.beta).toEqual({
      widgetShell: true,
      artifactsEngine: true,
      artifactsWriteBackExtended: false,
      localEngine: true,
    });
    expect(Object.values(FLAG_DEFAULTS.stable).every((on) => on === false)).toBe(true);
  });

  it('cites the owner answers for every beta-ON flag and none for artifactsWriteBackExtended', () => {
    expect(OWNER_YES_LOG.widgetShell).toContain('owner-answers.md 2026-10-26 5:01 AM');
    expect(OWNER_YES_LOG.artifactsEngine).toContain('owner-answers.md 2026-10-26 5:11 AM');
    expect(OWNER_YES_LOG.localEngine).toContain('owner-answers.md 2026-10-26 5:11 AM');
    expect(OWNER_YES_LOG.artifactsWriteBackExtended).toBeNull();
  });

  it('the build-time flags equal the defaults of the build channel (test build is stable)', () => {
    expect({ ...featureFlags }).toEqual(FLAG_DEFAULTS.stable);
  });

  describe('negative cases', () => {
    const clone = () => ({
      stable: { ...FLAG_DEFAULTS.stable } as Record<string, boolean>,
      beta: { ...FLAG_DEFAULTS.beta } as Record<string, boolean>,
    });

    it('an unknown flag forced ON in beta is a violation', () => {
      const defaults = clone();
      defaults.stable.mysteryFlag = false;
      defaults.beta.mysteryFlag = true;
      const violations = checkFlagDefaults(defaults, OWNER_YES_LOG, ZERO_FIVE_NINE_FLAGS);
      expect(violations.some((v) => v.includes('"mysteryFlag"') && v.startsWith('beta'))).toBe(true);
    });

    it('a 0.5.9 flag ON in stable is a violation', () => {
      for (const name of ZERO_FIVE_NINE_FLAGS) {
        const defaults = clone();
        defaults.stable[name] = true;
        const violations = checkFlagDefaults(defaults, OWNER_YES_LOG, ZERO_FIVE_NINE_FLAGS);
        expect(violations.some((v) => v.startsWith('stable') && v.includes(`"${name}"`)), name).toBe(true);
      }
    });

    it('a flag ON in beta with a null or empty yes is a violation', () => {
      const defaults = clone();
      defaults.beta.artifactsWriteBackExtended = true;
      const nullLog = checkFlagDefaults(defaults, OWNER_YES_LOG, ZERO_FIVE_NINE_FLAGS);
      expect(nullLog.some((v) => v.includes('"artifactsWriteBackExtended"') && v.includes('without a logged owner yes'))).toBe(true);
      const emptyLog = checkFlagDefaults(defaults, { ...OWNER_YES_LOG, artifactsWriteBackExtended: '  ' }, ZERO_FIVE_NINE_FLAGS);
      expect(emptyLog.some((v) => v.includes('without a logged owner yes'))).toBe(true);
    });

    it('a beta-ON flag whose yes was removed from the log is a violation', () => {
      const noYes: Record<FeatureFlagName, string | null> = { ...OWNER_YES_LOG, localEngine: null };
      const violations = checkFlagDefaults(FLAG_DEFAULTS, noYes, ZERO_FIVE_NINE_FLAGS);
      expect(violations.some((v) => v.includes('"localEngine"') && v.includes('without a logged owner yes'))).toBe(true);
    });

    it('a yes inherited from Object.prototype does not count', () => {
      const defaults = clone();
      defaults.beta = Object.fromEntries([...Object.entries(defaults.beta), ['hasOwnProperty', true]]);
      const violations = checkFlagDefaults(defaults, {}, [...ZERO_FIVE_NINE_FLAGS, 'hasOwnProperty']);
      expect(violations.some((v) => v.includes('"hasOwnProperty"') && v.includes('without a logged owner yes'))).toBe(true);
    });

    it('expected beta values are enforced: widgetShell OFF and write-back ON both fail', () => {
      const off = clone();
      off.beta.widgetShell = false;
      expect(checkFlagDefaults(off, OWNER_YES_LOG, ZERO_FIVE_NINE_FLAGS).some((v) => v.includes('"widgetShell"') && v.includes('expected ON'))).toBe(true);
      const on = clone();
      on.beta.artifactsWriteBackExtended = true;
      const yes = { ...OWNER_YES_LOG, artifactsWriteBackExtended: 'logged' };
      expect(checkFlagDefaults(on, yes, ZERO_FIVE_NINE_FLAGS).some((v) => v.includes('"artifactsWriteBackExtended"') && v.includes('expected OFF'))).toBe(true);
    });

    it('a missing allowlisted flag or channel is a violation', () => {
      const defaults = clone();
      delete defaults.beta.localEngine;
      expect(checkFlagDefaults(defaults, OWNER_YES_LOG, ZERO_FIVE_NINE_FLAGS).some((v) => v.includes('"localEngine" has no default'))).toBe(true);
      expect(checkFlagDefaults({ stable: defaults.stable }, OWNER_YES_LOG, ZERO_FIVE_NINE_FLAGS)).toContain('beta: channel defaults are missing');
    });

    it.each(['widgetShellV2', 'WidgetShell', 'widgetShel', 'widgetshell', 'widgetShell ', 'artifactsEngine2', 'localEngin'])(
      'near-miss name %j is rejected (exact match only)',
      (name) => {
        const defaults = clone();
        defaults.stable[name] = false;
        defaults.beta[name] = false;
        const violations = checkFlagDefaults(defaults, OWNER_YES_LOG, ZERO_FIVE_NINE_FLAGS);
        expect(violations.some((v) => v.includes(`"${name}" is not on the 0.5.9 allowlist`))).toBe(true);
      },
    );

    it('an allowlist given as a near-miss does not accept the real name', () => {
      const violations = checkFlagDefaults(FLAG_DEFAULTS, OWNER_YES_LOG, ['widgetShellV2', 'artifactsEngine', 'artifactsWriteBackExtended', 'localEngine']);
      expect(violations.some((v) => v.includes('"widgetShell" is not on the 0.5.9 allowlist'))).toBe(true);
    });
  });
});

describe('resolveChannel', () => {
  it('resolves stable and beta from the version', () => {
    expect(resolveChannel('0.5.7', undefined)).toBe('stable');
    expect(resolveChannel('0.5.9', undefined)).toBe('stable');
    expect(resolveChannel('0.5.9-beta.1', undefined)).toBe('beta');
    expect(resolveChannel('0.5.9-beta', undefined)).toBe('beta');
    expect(resolveChannel('0.5.9-rc.1', undefined)).toBe('stable');
    expect(resolveChannel('0.5.9-alpha.1', undefined)).toBe('stable');
    expect(resolveChannel('0.5.9-betamax', undefined)).toBe('stable');
    expect(resolveChannel('not-a-version', undefined)).toBe('stable');
  });

  it('the build override can force beta', () => {
    expect(resolveChannel('0.5.9', 'beta')).toBe('beta');
    expect(resolveChannel('0.5.7', 'beta')).toBe('beta');
  });

  it('any other override string is ignored, and no override can force stable on a beta version', () => {
    for (const other of ['stable', 'BETA', ' beta', 'beta ', 'true', '1', '']) {
      expect(resolveChannel('0.5.7', other), JSON.stringify(other)).toBe('stable');
    }
    expect(resolveChannel('0.5.9-beta.1', 'stable')).toBe('beta');
  });
});
