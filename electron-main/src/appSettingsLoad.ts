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
import { hydrateSecretsIntoSettings, persistSecretsAndStripSettings } from './secrets/migration.js';
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
 * (non-empty and not isMaskedPreview). Blank / mask / absent leave the flag.
 * Also force mask-shaped values to '' so they never reach JSON/secrets (no
 * K19 retention — H2 heal-to-empty on the write path).
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
    if (held.has(path) && typeof val === 'string' && val.length > 0) {
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

/**
 * Real settings loader body: read JSON, migrations, hydrate secrets, heal masks.
 * main.ts's loadAppSettings delegates here. Tests call this with a temp path
 * + SecretsStore to pin H1/H2 on the production path.
 *
 * @param persistMigration — called when the one-shot slice2 autonomy-off migrate
 *   needs to persist (same role as saveAppSettings in main). Optional for tests
 *   that pre-seed `slice2AutonomyOffMigrated: true`.
 */
export function loadAppSettingsFrom(
  settingsPath: string,
  getStore: () => SecretsStore,
  persistMigration?: (settings: AppSettings) => void,
): AppSettings {
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
          // Persist the one-shot migrate immediately so a subsequent load
          // does not re-apply and so prior autoApply:true never comes back.
          persistMigration?.(base);
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
      // SKY-2627: back-fill flat wa* fields for existing installs that predate this field set.
      // waModel is intentionally NOT back-filled: null means "use global model" — the spec default.
      const rawRecord = raw as Record<string, unknown>;
      if (!('waEnabled' in rawRecord)) base.waEnabled = base.agents.writingAssistant.enabled;
      if (!('waCadenceTrigger' in rawRecord)) base.waCadenceTrigger = base.agents.writingAssistant.cadenceTrigger ?? 'on_save';
      if (!('waIdleHeartbeatConstantInterval' in rawRecord)) base.waIdleHeartbeatConstantInterval = base.agents.writingAssistant.idleHeartbeatConstantInterval ?? false;
      if (!('waIdleDebounceSeconds' in rawRecord)) base.waIdleDebounceSeconds = base.agents.writingAssistant.idleDebounceSeconds ?? 30;
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
 * Real settings saver body (S4 + R4-L). main.ts's saveAppSettings delegates here.
 * Always strips incoming keyReentryPaths before JSON / secrets write (K18 —
 * written bytes never contain the flag or a mask). Main keeps held flags in
 * memory: a path clears only when this save carries a non-empty non-mask value
 * for that path. Boot re-sends, blank saves, mask-valued saves, and unrelated
 * full-object writes leave flags intact. H2 stands (disk may heal to '').
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
  let outgoing = stripKeyReentryPaths(lifecycleApplied);

  let toWrite: AppSettings = outgoing;
  try {
    toWrite = persistSecretsAndStripSettings(outgoing, getStore());
  } catch {
    // Store unavailable — still strip secret-shaped fields and keyReentryPaths.
    toWrite = {
      ...outgoing,
      apiKey: '',
      ...(outgoing.provider ? { provider: { ...outgoing.provider, apiKey: '' } } : {}),
      ...(outgoing.voice ? { voice: { ...outgoing.voice, openaiApiKey: '' } } : {}),
    };
  }
  toWrite = stripKeyReentryPaths(toWrite);
  fs.writeFileSync(settingsPath, JSON.stringify(toWrite, null, 2), 'utf-8');
}
