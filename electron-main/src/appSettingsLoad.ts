/**
 * Extracted app-settings loader + provider lookup helpers.
 *
 * Kept out of main.ts so heal-on-read (H1) and no-write-on-read (H2) can be
 * pinned against the real code path without booting Electron. main.ts's
 * loadAppSettings / getProviderConfigForAgent / buildGlobalProviderConfig
 * delegate here with no other logic.
 */

import fs from 'fs';
import type { AppSettings } from './ipc.js';
import { providerConfigForAgent, type ProviderConfig } from './provider.js';
import { writeFileAtomicSecure, writeJsonAtomicSecure } from './secrets/atomicWrite.js';
import {
  blankAllKeyFields,
  hydrateSecretsIntoSettings,
  persistSecretsAndStripSettings,
} from './secrets/migration.js';
import type { SecretsStore } from './secrets/store.js';
import {
  getKeyField,
  healMaskedKeyFields,
  isMaskedPreview,
  KEY_FIELD_PATHS,
  setKeyField,
  type KeyFieldPath,
} from './settings-masking.js';
import { migrateVoicePushToTalk, type LegacyVoiceSettings } from './voiceSettingsMigration.js';

/**
 * E3 / S-B11 / M29: set `onboardingComplete: true` via raw JSON read-modify-write.
 * Never routes through the secret saver or SecretsStore (HARD-1).
 */
export function markOnboardingCompleteJsonOnly(settingsPath: string): void {
  let parsed: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  if (parsed.onboardingComplete === true) return;
  parsed.onboardingComplete = true;
  writeJsonAtomicSecure(settingsPath, parsed);
}

/**
 * Abort path: keep non-key fields from `outgoing`, but every KEY_FIELD_PATHS
 * string comes from on-disk JSON (never typed outgoing plaintext).
 */
function withOnDiskKeyFields(outgoing: AppSettings, settingsPath: string): AppSettings {
  let disk: AppSettings | null = null;
  try {
    if (fs.existsSync(settingsPath)) {
      disk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
    }
  } catch {
    disk = null;
  }
  let out = outgoing;
  for (const path of KEY_FIELD_PATHS) {
    if (typeof getKeyField(out, path) !== 'string') continue;
    const diskVal = disk ? getKeyField(disk, path) : undefined;
    out = setKeyField(out, path, typeof diskVal === 'string' ? diskVal : '');
  }
  return out;
}

/** Abort snapshot: absent (ENOENT) vs bytes vs unknown (never unlink/overwrite). */
type SecretsSnapshot =
  | { kind: 'absent' }
  | { kind: 'bytes'; data: Buffer }
  | { kind: 'unknown' };

/**
 * KEYS-B S1: only ENOENT / missing file counts as absent. Any other read error
 * is `unknown` so rollback never unlinks or overwrites secrets.json.
 */
function snapshotSecretsBytes(store: SecretsStore): SecretsSnapshot {
  try {
    if (!fs.existsSync(store.path)) return { kind: 'absent' };
    return { kind: 'bytes', data: fs.readFileSync(store.path) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unknown' };
  }
}

/**
 * Restore secrets from an Abort snapshot. KEYS-B S2: always reload() in
 * `finally` after a rollback attempt so a failed rollback write cannot leave
 * a dirty in-memory cache.
 */
function restoreSecretsBytes(store: SecretsStore, snapshot: SecretsSnapshot): void {
  try {
    if (snapshot.kind === 'absent') {
      try {
        if (fs.existsSync(store.path)) fs.unlinkSync(store.path);
      } catch {
        /* best-effort */
      }
    } else if (snapshot.kind === 'bytes') {
      writeFileAtomicSecure(store.path, snapshot.data);
    }
    // kind === 'unknown': never unlink or overwrite
  } finally {
    store.reload();
  }
}

/** Drop ephemeral keyReentryPaths — never reaches JSON or secrets (S4 / H3 / K18). */
function stripKeyReentryPaths(settings: AppSettings): AppSettings {
  if (!('keyReentryPaths' in settings)) return settings;
  const { keyReentryPaths: _drop, ...rest } = settings;
  void _drop;
  return rest;
}

/**
 * R4-L: main owns keyReentryPaths in memory (never on disk / K18).
 * Seeded from heal-on-read; survive boot re-send and unrelated full-object
 * saves; clear one path only when that path is saved with a non-empty
 * non-mask value. Keyed by settingsPath so temp-file pins stay isolated.
 */
const heldKeyReentryBySettingsPath = new Map<string, Set<string>>();

function heldKeyReentryFor(settingsPath: string): Set<string> {
  let held = heldKeyReentryBySettingsPath.get(settingsPath);
  if (!held) {
    held = new Set();
    heldKeyReentryBySettingsPath.set(settingsPath, held);
  }
  return held;
}

/** Attach held + newly healed re-entry paths onto a loaded settings object. */
function withHeldKeyReentryPaths(settingsPath: string, settings: AppSettings): AppSettings {
  const held = heldKeyReentryFor(settingsPath);
  for (const path of settings.keyReentryPaths ?? []) {
    held.add(path);
  }
  const stripped = stripKeyReentryPaths(settings);
  if (held.size === 0) return stripped;
  return { ...stripped, keyReentryPaths: [...held] };
}

/**
 * Clear held flags only for paths whose saved value is a real key
 * (non-empty after trim, and not isMaskedPreview). Blank / whitespace-only /
 * mask / absent leave the flag (Shield r2). Also force mask-shaped values to
 * '' so they never reach JSON/secrets (H2 heal-to-empty on the write path).
 */
function applyHeldFlagLifecycle(
  settingsPath: string,
  settings: AppSettings,
): AppSettings {
  const held = heldKeyReentryFor(settingsPath);
  let out = settings;
  for (const path of KEY_FIELD_PATHS) {
    const val = getKeyField(out, path as KeyFieldPath);
    if (typeof val === 'string' && isMaskedPreview(val)) {
      // Never persist a mask; leave the re-entry flag alone.
      out = setKeyField(out, path as KeyFieldPath, '');
      continue;
    }
    // Shield r2: whitespace-only is not a real key — do not clear the flag.
    if (held.has(path) && typeof val === 'string' && val.trim().length > 0) {
      held.delete(path);
    }
  }
  return out;
}

export const AGENT_BUDGET_DEFAULTS = {
  autoApply: false,
  confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000,
  maxSuggestionsPerHour: 50,
  heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500_000,
  // MYT-343: per-agent config additions
  autoApplyThreshold: 0.85,
  requestsPerMinute: 60,
  // SKY-321 shipped these all ON; Beta 4 M28 (B4-8, binding owner decision)
  // flips the default: every auto-apply category toggle ships OFF until the
  // user opts in. Vaults that already saved an explicit map keep their values.
  autoApplyCategories: {
    punctuation: false,
    spelling: false,
    grammar: false,
    'sentence-structure': false,
    'style-tone': false,
    other: false,
  } as Record<import('./ipc.js').SuggestionCategory, boolean>,
};

export const SETTINGS_DEFAULTS: AppSettings = {
  apiKey: '',
  // M11a (SKY-9160): master AI switch — default on; off = manual mode.
  ai: { enabled: true },
  waScanInterval: 'on-save',
  waEnabled: true,
  waModel: null,
  waCadenceTrigger: 'on_save',
  waIdleHeartbeatConstantInterval: false,
  waIdleDebounceSeconds: 30,
  agents: {
    // SKY-11355: '' means "use the provider's Default model" — resolved by
    // getProviderConfigForAgent()'s `agentSettings.model || undefined` fallthrough.
    // A hardcoded Anthropic model name here silently overrode local providers
    // (LM Studio/Ollama/etc. would be asked for a model they don't have).
    writingAssistant: { enabled: true, model: '', scanIntervalSeconds: 60, cadenceTrigger: 'on_save', idleHeartbeatConstantInterval: false, idleDebounceSeconds: 30, ...AGENT_BUDGET_DEFAULTS },
    brainstorm: { enabled: true, model: '', ...AGENT_BUDGET_DEFAULTS },
    archive: {
      enabled: true,
      model: '',
      continuityCheckIntervalSeconds: 60,
      sceneCrafterSuggestions: { enabled: false, cadence: 1800 },
      ...AGENT_BUDGET_DEFAULTS,
    },
    // Beta 3 M22: fourth named agent — reader-eye chapter reads → margin comments.
    betaReader: { enabled: true, model: '', ...AGENT_BUDGET_DEFAULTS },
    // SKY-11411 (SKY-10741 M12.B6): production-team roles. All default OFF (AC1)
    // — a fresh install never starts calling a provider for these until the
    // author opts in from Settings > AI Agents.
    alphaReader: { enabled: false, model: '', ...AGENT_BUDGET_DEFAULTS },
    storylineConsultant: { enabled: false, model: '', ...AGENT_BUDGET_DEFAULTS },
    lineEditor: { enabled: false, model: '', ...AGENT_BUDGET_DEFAULTS },
  },
  // SKY-11241 (AC1): the reader's first voice should be the good one — Kokoro
  // ships bundled and in-process (SKY-11243), so it needs no setup step to be
  // the fresh-install default. Only applied when no settings file (or no
  // `voice` block) exists yet; an install that already saved `voice` keeps
  // whatever ttsVoiceId (or its absence) it already has.
  voice: { enabled: false, cloudFallback: false, ttsVoiceId: 'kokoro:nicole' },
  theme: 'dark',
  snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  updateChannel: 'stable',
  // SKY-10878 M12.B5b: default the self-building wiki to "always ask" so it
  // never writes to the vault without author approval.
  wikiAutonomy: 'ask',
  archiveContinuityEnabled: true,
  archiveScanOnSave: true,
  archiveScanScope: 'active_scene',
  archiveScanInterval: null,
  archiveMinSeverity: 'low',
  archiveCheckCharacterDrift: true,
  archiveCheckLocationMismatch: true,
  archiveCheckFactualContradict: true,
  archiveScanBudget: 8000,
  archiveStoryEditConsentGiven: false,
  // SKY-11186: Notes Board zoom-out limit — the spec §6 default; a visible
  // performance setting (owner ruling 4), adjustable in Settings → Editor.
  notesBoard: { minZoom: 40 },
  // rightSidebarVisible/Width/Panels are intentionally absent from defaults so
  // DesktopShell keeps grsVisible=undefined until the user explicitly opens the
  // new global sidebar. This prevents the old per-view RightSidebar and the new
  // GlobalRightSidebar from rendering simultaneously (duplicate WritingAssistantPanel).
};

export type OptionalAgentKey = 'betaReader' | 'alphaReader' | 'storylineConsultant' | 'lineEditor';

const OPTIONAL_AGENT_KEYS: readonly OptionalAgentKey[] = ['betaReader', 'alphaReader', 'storylineConsultant', 'lineEditor'];

function isOptionalAgentKey(name: string): name is OptionalAgentKey {
  return (OPTIONAL_AGENT_KEYS as readonly string[]).includes(name);
}

export { isOptionalAgentKey };

export function getOptionalAgentSettings(
  settings: AppSettings,
  key: OptionalAgentKey,
): NonNullable<AppSettings['agents'][OptionalAgentKey]> {
  return (settings.agents[key]
    ?? SETTINGS_DEFAULTS.agents[key]) as NonNullable<AppSettings['agents'][OptionalAgentKey]>;
}

function isPlainSettingsObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readSavedWritingAssistantBooleans(rawRecord: Record<string, unknown>): {
  savedFlat?: boolean;
  savedAgent?: boolean;
} {
  const savedFlat = typeof rawRecord.waEnabled === 'boolean' ? rawRecord.waEnabled : undefined;
  const agentsRaw = rawRecord.agents;
  let savedAgent: boolean | undefined;
  if (isPlainSettingsObject(agentsRaw)) {
    const waRaw = agentsRaw.writingAssistant;
    if (isPlainSettingsObject(waRaw) && typeof waRaw.enabled === 'boolean') {
      savedAgent = waRaw.enabled;
    }
  }
  return { savedFlat, savedAgent };
}

/** F2: saved "off" wins; non-booleans count as unset. */
export function resolveWritingAssistantEnabledPair(rawRecord: Record<string, unknown>): boolean {
  const { savedFlat, savedAgent } = readSavedWritingAssistantBooleans(rawRecord);
  if (savedFlat === false || savedAgent === false) return false;
  if (savedAgent !== undefined) return savedAgent;
  if (savedFlat !== undefined) return savedFlat;
  return SETTINGS_DEFAULTS.waEnabled ?? true;
}

/**
 * F3: shallow repair object for disagreeing on-disk wa pair, or null to skip.
 * Never mutates `raw`.
 */
export function buildWaPairRepair(raw: unknown, value: boolean): Record<string, unknown> | null {
  if (!isPlainSettingsObject(raw)) return null;
  const agentsRaw = raw.agents;
  if (agentsRaw !== undefined && !isPlainSettingsObject(agentsRaw)) return null;
  const waRaw = isPlainSettingsObject(agentsRaw) ? agentsRaw.writingAssistant : undefined;
  if (waRaw !== undefined && !isPlainSettingsObject(waRaw)) return null;

  const out: Record<string, unknown> = { ...raw };
  out.waEnabled = value;
  const agentsOut: Record<string, unknown> = isPlainSettingsObject(agentsRaw)
    ? { ...agentsRaw }
    : {};
  const waOut: Record<string, unknown> = isPlainSettingsObject(waRaw) ? { ...waRaw } : {};
  waOut.enabled = value;
  agentsOut.writingAssistant = waOut;
  out.agents = agentsOut;
  return out;
}

function rawWaPairNeedsRepair(rawRecord: Record<string, unknown>, resolved: boolean): boolean {
  const { savedFlat, savedAgent } = readSavedWritingAssistantBooleans(rawRecord);
  if (typeof savedFlat === 'boolean' && savedFlat !== resolved) return true;
  if (typeof savedAgent === 'boolean' && savedAgent !== resolved) return true;
  return false;
}

/**
 * Real settings loader body: read JSON, migrations, hydrate secrets, heal masks.
 * main.ts's loadAppSettings delegates here. Tests call this with a temp path
 * + SecretsStore to pin H1/H2 on the production path.
 *
 * @param persistMigration — retained for call-site compatibility with main's
 *   `loadAppSettingsFrom(..., saveAppSettings)`. KEYS-B D5 / S-B11: the slice2
 *   autonomy-off flag write is JSON-only inside this function and does **not**
 *   invoke this callback (calling the secret saver mid-load would wipe stored
 *   keys when JSON fields are empty).
 */
export function loadAppSettingsFrom(
  settingsPath: string,
  getStore: () => SecretsStore,
  persistMigration?: (settings: AppSettings) => void,
): AppSettings {
  void persistMigration;
  let base: AppSettings;
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Partial<AppSettings> & { liquidGlass?: AppSettings['liquidNeon'] };
      type AgentsRaw = Partial<AppSettings['agents']>;
      const rawAgents: AgentsRaw = (raw.agents as AgentsRaw | undefined) ?? {};
      // One-shot migration: legacy key liquidGlass → liquidNeon (MYT-814)
      const liquidNeon = raw.liquidNeon ?? raw.liquidGlass;
      base = {
        ...SETTINGS_DEFAULTS,
        ...raw,
        ...(liquidNeon ? { liquidNeon } : {}),
        agents: {
          writingAssistant: { ...SETTINGS_DEFAULTS.agents.writingAssistant, ...(rawAgents.writingAssistant ?? {}) },
          brainstorm: { ...SETTINGS_DEFAULTS.agents.brainstorm, ...(rawAgents.brainstorm ?? {}) },
          archive: { ...SETTINGS_DEFAULTS.agents.archive, ...(rawAgents.archive ?? {}) },
          // Beta 3 M22: back-fill for pre-M22 settings files (key absent on disk).
          betaReader: { ...(SETTINGS_DEFAULTS.agents.betaReader as NonNullable<AppSettings['agents']['betaReader']>), ...(rawAgents.betaReader ?? {}) },
          // SKY-11411: back-fill the production-team roles for pre-SKY-11411 files
          // (keys absent on disk) so getProviderConfigForAgent / the run handler
          // always see a full, default-OFF settings object.
          alphaReader: { ...(SETTINGS_DEFAULTS.agents.alphaReader as NonNullable<AppSettings['agents']['alphaReader']>), ...(rawAgents.alphaReader ?? {}) },
          storylineConsultant: { ...(SETTINGS_DEFAULTS.agents.storylineConsultant as NonNullable<AppSettings['agents']['storylineConsultant']>), ...(rawAgents.storylineConsultant ?? {}) },
          lineEditor: { ...(SETTINGS_DEFAULTS.agents.lineEditor as NonNullable<AppSettings['agents']['lineEditor']>), ...(rawAgents.lineEditor ?? {}) },
        },
      };
      // Migration AC-CAD-12: existing installs without cadenceTrigger default to idle_heartbeat to preserve prior behavior
      if (rawAgents.writingAssistant && !(rawAgents.writingAssistant as unknown as Record<string, unknown>).cadenceTrigger) {
        base.agents.writingAssistant.cadenceTrigger = 'idle_heartbeat';
        base.agents.writingAssistant.idleHeartbeatConstantInterval = true;
      }
      const rawRecord = raw as Record<string, unknown>;
      const waPair = resolveWritingAssistantEnabledPair(rawRecord);
      base.waEnabled = waPair;
      base.agents.writingAssistant.enabled = waPair;
      // SKY-2627: back-fill flat wa* fields for existing installs that predate this field set.
      // waModel is intentionally NOT back-filled: null means "use global model" — the spec default.
      if (!('waCadenceTrigger' in rawRecord)) {
        base.waCadenceTrigger = base.agents.writingAssistant.cadenceTrigger ?? 'on_save';
      }
      if (!('waIdleHeartbeatConstantInterval' in rawRecord)) {
        base.waIdleHeartbeatConstantInterval = base.agents.writingAssistant.idleHeartbeatConstantInterval ?? false;
      }
      if (!('waIdleDebounceSeconds' in rawRecord)) {
        base.waIdleDebounceSeconds = base.agents.writingAssistant.idleDebounceSeconds ?? 30;
      }
      // Beta 4 M28 (B4-8) back-compat: SETTINGS_DEFAULTS now carries an
      // explicit all-false autoApplyCategories map (every toggle OFF by
      // default). An agent that already had autoApply=true on disk but no
      // per-category map predates the map — injecting the all-false default
      // would silently disable a working setup, so drop the injected map and
      // let the evaluator's legacy "absent map ⇒ all enabled" semantics keep
      // their behavior. Fresh installs and opted-out agents keep the all-OFF map.
      for (const agentKey of ['writingAssistant', 'brainstorm', 'archive', 'betaReader'] as const) {
        const rawAgent = rawAgents[agentKey] as unknown as Record<string, unknown> | undefined;
        if (rawAgent && rawAgent.autoApply === true && !('autoApplyCategories' in rawAgent)) {
          delete (base.agents[agentKey] as unknown as Record<string, unknown>).autoApplyCategories;
        }
      }
      // 0.5.4 Slice 2 S2-5 (path A): one-time migrate every auto-apply Autonomy
      // setting (incl. Grammar category) to OFF on first open of this build.
      // Do not preserve prior on values. Fresh installs already default off.
      if (!base.slice2AutonomyOffMigrated) {
        const offCats = { ...AGENT_BUDGET_DEFAULTS.autoApplyCategories };
        for (const agentKey of [
          'writingAssistant', 'brainstorm', 'archive', 'betaReader',
          'alphaReader', 'storylineConsultant', 'lineEditor',
        ] as const) {
          const agent = base.agents[agentKey];
          if (!agent) continue;
          (base.agents as Record<string, typeof agent>)[agentKey] = {
            ...agent,
            autoApply: false,
            autoApplyCategories: { ...offCats },
          };
        }
        base.slice2AutonomyOffMigrated = true;
        try {
          // KEYS-B D5 / S-B11: JSON-only write — never route through the secret
          // saver. Mid-load `base` often has empty key fields (post-migration
          // shape); persistSecretsAndStripSettings would store.set('', …) and
          // wipe already-migrated secrets. Pre-init plaintext keys must also
          // survive until migrateSecretsFromSettingsFile runs.
          writeJsonAtomicSecure(settingsPath, stripKeyReentryPaths(base));
        } catch {
          /* first-open migrate is best-effort; next Write will carry the flag */
        }
      }
      // SKY-11355: pre-fix installs may have 'claude-sonnet-4-6' baked into an
      // agent's saved settings (the old hardcoded default). That value is only
      // meaningful on Anthropic — on any other effective provider (global or
      // the agent's own override) it silently broke the agent. Migrate it to
      // '' (use the provider's Default model) so upgrading users get a working
      // agent instead of carrying the stale value forward forever.
      for (const agentKey of ['writingAssistant', 'brainstorm', 'archive', 'betaReader'] as const) {
        const rawAgent = rawAgents[agentKey] as unknown as { model?: string; provider?: { kind?: string } } | undefined;
        if (rawAgent?.model !== 'claude-sonnet-4-6') continue;
        const effectiveKind = rawAgent.provider?.kind ?? raw.provider?.kind ?? 'anthropic';
        if (effectiveKind !== 'anthropic') {
          (base.agents[agentKey] as { model: string }).model = '';
        }
      }
      if (base.slice2AutonomyOffMigrated && rawWaPairNeedsRepair(rawRecord, waPair)) {
        const repair = buildWaPairRepair(raw, waPair);
        if (repair) {
          try {
            writeJsonAtomicSecure(settingsPath, repair);
          } catch {
            /* best-effort; retry next load */
          }
        }
      }
      // SKY-7771: back-fill voice.voiceMode from the legacy pushToTalkMode
      // checkbox and drop the duplicate key (see voiceSettingsMigration.ts).
      base.voice = migrateVoicePushToTalk(base.voice as LegacyVoiceSettings | undefined);
    } catch {
      base = { ...SETTINGS_DEFAULTS, agents: { ...SETTINGS_DEFAULTS.agents } };
    }
  } else {
    base = { ...SETTINGS_DEFAULTS, agents: { ...SETTINGS_DEFAULTS.agents } };
  }
  // MYT-777: overlay decrypted credentials from the SecretsStore so the rest
  // of the main-process code keeps reading settings.apiKey / provider.apiKey /
  // voice.openaiApiKey unchanged. The on-disk JSON file holds empty strings
  // for those fields after the one-shot migration in app-ready.
  // Heal-on-read (H1): after decrypt/hydrate, clear any stored masked preview
  // in memory only (no write). Same loader backs SETTINGS_GET and provider
  // lookup (getProviderConfigForAgent / buildGlobalProviderConfig).
  // R4-L: seed/merge held keyReentryPaths so SETTINGS_GET keeps flags after
  // boot re-send writes healed '' to disk (H2 — still no write on read).
  try {
    return withHeldKeyReentryPaths(
      settingsPath,
      healMaskedKeyFields(hydrateSecretsIntoSettings(base, getStore())),
    );
  } catch {
    // Store not yet initialized (very early boot path). Caller will see the
    // post-migration empty key strings; the env-var fallback in
    // buildGlobalProviderConfig still serves as a last resort for CLI/CI scenarios.
    return withHeldKeyReentryPaths(settingsPath, healMaskedKeyFields(base));
  }
}

/** Build a ProviderConfig from the global provider settings (or legacy apiKey field). */
export function buildGlobalProviderConfig(settings: AppSettings): ProviderConfig {
  if (settings.provider) {
    return {
      kind: settings.provider.kind,
      model: settings.provider.model,
      baseUrl: settings.provider.baseUrl ?? undefined,
      apiKey: settings.provider.apiKey ?? undefined,
    };
  }
  // Legacy path: Anthropic key from settings.apiKey (hydrated from SecretsStore) or env.
  const apiKey = settings.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('No API key configured. Add one in Settings or set ANTHROPIC_API_KEY to enable AI features.');
  }
  return {
    kind: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    apiKey,
  };
}

/**
 * Build a ProviderConfig for a named agent slot from an already-loaded settings
 * object (no re-load). main's getProviderConfigForAgent loads then delegates here.
 */
export function getProviderConfigForAgentFrom(
  settings: AppSettings,
  agentName: 'brainstorm' | 'writingAssistant' | 'archive' | OptionalAgentKey,
): ProviderConfig {
  const agentSettings = isOptionalAgentKey(agentName)
    ? getOptionalAgentSettings(settings, agentName)
    : settings.agents[agentName];
  const global = buildGlobalProviderConfig(settings);
  const agentProvider = agentSettings.provider
    ? {
        kind: agentSettings.provider.kind,
        model: agentSettings.provider.model,
        baseUrl: agentSettings.provider.baseUrl ?? undefined,
        apiKey: agentSettings.provider.apiKey ?? undefined,
      }
    : undefined;
  return providerConfigForAgent(global, agentSettings.model || undefined, agentProvider);
}

/**
 * Real settings saver body (S4 + R4-L + KEYS-B S-B11 / O1).
 * main.ts's saveAppSettings delegates here.
 *
 * Always strips incoming keyReentryPaths before JSON / secrets write (K18 —
 * written bytes never contain the flag or a mask). Main keeps held flags in
 * memory: a path clears only when this save carries a non-empty non-mask value
 * for that path. Boot re-sends, blank saves, mask-valued saves, and unrelated
 * full-object writes leave flags intact. H2 stands (disk may heal to '').
 *
 * Ivy / S-B11 boot-order rule:
 *   - Before initSecretsStore: JSON-only write — never blank keys as "no keyring".
 *   - After init, encryption unavailable: blank every KEY_FIELD_PATHS entry (O1).
 *   - After init, encryption available: persistSecretsAndStripSettings.
 */
export function saveAppSettingsTo(
  settingsPath: string,
  getStore: () => SecretsStore,
  settings: AppSettings,
  opts?: { isCleared?: () => boolean },
): void {
  if (opts?.isCleared?.()) return;

  // R4-L: ignore any renderer-supplied keyReentryPaths; update held from values.
  // Mask-shaped values coerce to '' before persist (still no mask on disk).
  const lifecycleApplied = applyHeldFlagLifecycle(settingsPath, settings);
  const outgoing = stripKeyReentryPaths(lifecycleApplied);

  let store: SecretsStore | null = null;
  try {
    store = getStore();
  } catch {
    // SecretsStore not initialized (pre-init boot path, e.g. slice2 flag write
    // during the first loadAppSettings before initSecretsStore). S-B11: write
    // JSON only — keep plaintext keys so migrateSecretsFromSettingsFile can
    // move them after init. Never treat pre-init as O1 "no keyring".
    writeJsonAtomicSecure(settingsPath, outgoing);
    return;
  }

  let toWrite: AppSettings;
  if (!store.isAvailable()) {
    // Post-init, encryption unavailable → O1 blank all present key fields.
    toWrite = blankAllKeyFields(outgoing);
  } else {
    // KEYS-B P3 Abort: snapshot secrets before persist so a mid-save throw
    // rolls the file back byte-identical; typed keys never land in JSON.
    const secretsBefore = snapshotSecretsBytes(store);
    try {
      toWrite = persistSecretsAndStripSettings(outgoing, store);
    } catch (err) {
      try {
        restoreSecretsBytes(store, secretsBefore);
      } catch {
        /* rollback is best-effort; still refuse plaintext keys below */
      }
      // Non-key settings still save; JSON key fields from on-disk only.
      toWrite = stripKeyReentryPaths(withOnDiskKeyFields(outgoing, settingsPath));
      writeJsonAtomicSecure(settingsPath, toWrite);
      throw err;
    }
  }
  // Single strip after secret handling (PB saver-strip pin). Lifecycle already
  // stripped once above; this catches any flag a secret helper might re-add.
  toWrite = stripKeyReentryPaths(toWrite);
  writeJsonAtomicSecure(settingsPath, toWrite);
}
