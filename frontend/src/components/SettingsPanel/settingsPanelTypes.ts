// Shared types, constants, and helpers for SettingsPanel components.
// Extracted from SettingsPanel.tsx to enable per-section component splitting (SKY-3216/D2).

import type { ThemeMode } from '../../theme';
import { LIQUID_NEON_DEFAULTS } from '../../theme';

export interface MicDevice { deviceId: string; label: string; }

export type FieldType = 'text' | 'number' | 'select';

export interface CustomFieldDef {
  id: string;
  name: string;
  type: FieldType;
  options?: string[];
}

export type ProviderKind = 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'custom';

export const PROVIDER_OPTIONS: { value: ProviderKind; label: string; needsKey: boolean; needsUrl: boolean }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)', needsKey: true, needsUrl: false },
  { value: 'openai', label: 'OpenAI', needsKey: true, needsUrl: false },
  { value: 'ollama', label: 'Ollama (local)', needsKey: false, needsUrl: true },
  { value: 'lmstudio', label: 'LM Studio (local)', needsKey: false, needsUrl: true },
  { value: 'custom', label: 'Custom endpoint', needsKey: true, needsUrl: true },
];

export const LISTABLE_PROVIDERS = new Set<ProviderKind>(['ollama', 'lmstudio', 'openai', 'custom']);

export const TELEMETRY_DATA_LIST = [
  'App version and platform (OS / Electron version)',
  'Session start and end timestamps',
  'Feature usage counts (e.g. brainstorm invocations, suggestions accepted)',
  'Error type and frequency (no content or personal data)',
];

export type TestConnectionStatus = 'idle' | 'testing' | 'ok' | 'error';
export type ModelListStatus = 'idle' | 'loading' | 'ok' | 'error';

const OLLAMA_NOT_RUNNING_COPY = 'Ollama is not running. Start it with ollama serve.';
const MODEL_LIST_TIMEOUT_COPY = 'Endpoint did not respond within 5 seconds — check the URL and try again.';
const MODEL_LIST_NETWORK_COPY = 'Could not reach the endpoint — check the URL and try again.';

export function modelListErrorCopy(kind: ProviderKind, error?: string): string {
  const normalized = (error ?? '').toLowerCase();
  if (normalized.includes('5 second') || normalized.includes('timeout') || normalized.includes('timed out')) {
    return MODEL_LIST_TIMEOUT_COPY;
  }
  if (kind === 'ollama' && (!error || normalized.includes('ollama') || normalized.includes('network') || normalized.includes('econnrefused') || normalized.includes('fetch'))) {
    return OLLAMA_NOT_RUNNING_COPY;
  }
  if (normalized.includes('network') || normalized.includes('econn') || normalized.includes('fetch')) {
    return MODEL_LIST_NETWORK_COPY;
  }
  return error || MODEL_LIST_NETWORK_COPY;
}

export const THEME_CHOICES: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Liquid Neon' },
  { value: 'high-contrast', label: 'High contrast' },
];

export const LG_DEFAULTS: LiquidNeonPrefs = LIQUID_NEON_DEFAULTS;

export const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku' },
  { value: 'claude-sonnet-4-6', label: 'claude-sonnet' },
  { value: 'claude-sonnet-5', label: 'claude-sonnet-5' },
  { value: 'claude-opus-4-7', label: 'claude-opus' },
  { value: 'claude-opus-4-8', label: 'claude-opus-4-8' },
];

export type AgentName = 'writingAssistant' | 'brainstorm' | 'archive' | 'betaReader';

export interface AgentOverrideState {
  enabled: boolean;
  kind: ProviderKind;
  apiKey: string;
  apiKeyDirty: boolean;
  baseUrl: string;
  model: string;
}

export const DEFAULT_AGENT_OVERRIDE: AgentOverrideState = {
  enabled: false,
  kind: 'anthropic',
  apiKey: '',
  apiKeyDirty: false,
  baseUrl: '',
  model: '',
};

export const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
  anthropic: '',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  custom: '',
};

export function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export const ALL_CATEGORIES_ENABLED: Record<SuggestionCategory, boolean> = {
  punctuation: true,
  spelling: true,
  grammar: true,
  'sentence-structure': true,
  'style-tone': true,
  other: true,
};

export const BUDGET_DEFAULTS: AgentBudgetSettings = {
  autoApply: false,
  confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000,
  maxSuggestionsPerHour: 50,
  heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500_000,
  autoApplyCategories: ALL_CATEGORIES_ENABLED,
};

export const SUGGESTION_CATEGORY_ORDER: SuggestionCategory[] = [
  'punctuation',
  'spelling',
  'grammar',
  'sentence-structure',
  'style-tone',
  'other',
];

export function isCategoryAutoApplyEnabled(
  agent: AgentBudgetSettings,
  category: SuggestionCategory,
): boolean {
  if (!agent.autoApplyCategories) return true;
  const value = agent.autoApplyCategories[category];
  return value !== false;
}

/** Beta 3 M22: default Beta Reader agent settings (also the back-fill for pre-M22 settings files). */
export const BETA_READER_DEFAULTS: NonNullable<AppSettings['agents']['betaReader']> = {
  enabled: true,
  model: 'claude-sonnet-4-6',
  ...BUDGET_DEFAULTS,
};

export const DEFAULTS: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, ...BUDGET_DEFAULTS },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', ...BUDGET_DEFAULTS },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, ...BUDGET_DEFAULTS },
    betaReader: { ...BETA_READER_DEFAULTS },
  },
  theme: 'dark',
  snapshots: { maxPerScene: 100, maxAgeDays: 30 },
};

export const BG_POSITIONS = [
  { value: 'top left',     label: '↖' },
  { value: 'top',          label: '↑' },
  { value: 'top right',    label: '↗' },
  { value: 'left',         label: '←' },
  { value: 'center',       label: '·' },
  { value: 'right',        label: '→' },
  { value: 'bottom left',  label: '↙' },
  { value: 'bottom',       label: '↓' },
  { value: 'bottom right', label: '↘' },
];

export function validateApiKey(key: string): string | null {
  if (!key) return null;
  if (!key.startsWith('sk-ant-')) return 'Key must start with sk-ant-';
  return null;
}

export function providerSupportsVoice(provider?: AppSettings['provider']): boolean {
  if (!provider) return false;
  if (provider.capabilities?.transcribe || provider.capabilities?.speak) return true;
  if (provider.kind === 'openai') return true;
  return provider.kind === 'custom' && Boolean(provider.baseUrl);
}

export function formatProviderLabel(provider: AppSettings['provider']): string {
  if (!provider) return 'Provider';
  if (provider.kind === 'openai') return 'OpenAI';
  if (provider.kind === 'custom') return provider.baseUrl ? `Custom (${provider.baseUrl})` : 'Custom endpoint';
  const option = PROVIDER_OPTIONS.find((p) => p.value === provider.kind);
  return option?.label ?? provider.kind.charAt(0).toUpperCase() + provider.kind.slice(1);
}

export const FOCUS_PREFS_DEFAULTS = {
  showTitleBar: true, showStatusBar: true, showTabBar: true,
  showSidebarButtons: true, showScrollbars: true, showFileTreeArrows: true,
};

// Beta 4 M3 (FULL-SPEC §4): the six modules in spec order — Story Writer,
// Notes Editor, Scene Crafter, Brainstorm, Timeline, Vault Graph. Settings is
// pinned at the rail bottom and never part of this list.
export const NAV_RAIL_DEFAULTS: NavRailConfig = {
  items: [
    { id: 'story', enabled: true, label: 'Story Writer', icon: '✍', order: 0 },
    { id: 'notes', enabled: true, label: 'Notes Editor', icon: '📝', order: 1 },
    { id: 'crafter', enabled: true, label: 'Scene Crafter', icon: '🗂️', order: 2 },
    { id: 'brainstorm', enabled: true, label: 'Brainstorm', icon: '💡', order: 3 },
    { id: 'timeline', enabled: true, label: 'Timeline', icon: '📅', order: 4 },
    { id: 'graph', enabled: true, label: 'Vault Graph', icon: '🕸️', order: 5 },
  ],
  collapsedDefault: false,
  showLabels: true,
  showIcons: true,
};

/**
 * The pre-Beta-4 default rail (id/order/enabled). A saved config that still
 * matches this exactly was never customized by the user, so the Beta 4 module
 * order may replace it wholesale without violating the SKY-5903 guarantee.
 */
const LEGACY_NAV_RAIL_DEFAULT_ITEMS: ReadonlyArray<Pick<NavRailItemConfig, 'id' | 'order' | 'enabled'>> = [
  { id: 'story', enabled: true, order: 0 },
  { id: 'notes', enabled: true, order: 1 },
  { id: 'brainstorm', enabled: true, order: 2 },
];

/** True when the saved items are exactly the untouched pre-Beta-4 defaults. */
function isLegacyDefaultNavConfig(saved: NavRailItemConfig[]): boolean {
  if (saved.length !== LEGACY_NAV_RAIL_DEFAULT_ITEMS.length) return false;
  return LEGACY_NAV_RAIL_DEFAULT_ITEMS.every((legacy) =>
    saved.some((s) => s.id === legacy.id && s.order === legacy.order && s.enabled === legacy.enabled),
  );
}

/**
 * SKY-5903: merge a user's saved nav-rail items with the current app defaults.
 * The user's order/enabled always win for items they already have. Defaults
 * introduced by a newer app version are appended *after* the user's highest
 * saved order — not at the default item's own hardcoded order — so a new item
 * can never jump ahead of a re-ordered saved item (e.g. saved notes.order=0,
 * story.order=5 must keep a new brainstorm item after story, not between
 * notes and story just because brainstorm's own default order is 2).
 *
 * Beta 4 M3 refinements (both keep the SKY-5903 order guarantee intact):
 * - label/icon are app-owned display fields and are refreshed from the current
 *   defaults, so module renames (Story → Story Writer) reach older configs;
 * - a saved config that is byte-for-byte the untouched pre-Beta-4 default
 *   (story/notes/brainstorm, default order, all enabled) is treated as
 *   uncustomized and replaced with the new six-module default order.
 */
export function mergeNavConfigItems(
  savedItems: NavRailItemConfig[] | undefined,
  defaultItems: NavRailItemConfig[] = NAV_RAIL_DEFAULTS.items,
): NavRailItemConfig[] {
  const saved = savedItems ?? [];
  if (isLegacyDefaultNavConfig(saved)) return defaultItems.map((d) => ({ ...d }));
  const defaultsById = new Map(defaultItems.map((d) => [d.id, d]));
  const kept = saved.map((item) => {
    const def = defaultsById.get(item.id);
    return def ? { ...item, label: def.label, icon: def.icon } : item;
  });
  const maxSavedOrder = kept.reduce((max, item) => Math.max(max, item.order), -1);
  const appended = defaultItems
    .filter((d) => !saved.some((i) => i.id === d.id))
    .map((d, index) => ({ ...d, order: maxSavedOrder + 1 + index }));
  return [...kept, ...appended];
}

/**
 * Beta 4 M3: move one row of the rail-edit popover (or the Settings Nav-bar
 * list) and re-normalize order values to array positions. Pure.
 */
export function reorderNavConfigItems(
  items: NavRailItemConfig[],
  from: number,
  to: number,
): NavRailItemConfig[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items.map((it, i) => ({ ...it, order: i }));
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((it, i) => ({ ...it, order: i }));
}

/**
 * SKY-5903: resolve the enabled, ordered nav-rail items to render, merging
 * in newer defaults and falling back to the full defaults if the user has
 * disabled every item (so the rail is never stranded empty).
 */
export function resolveNavRailItems(
  savedNavConfig: NavRailConfig | undefined,
  defaults: NavRailConfig = NAV_RAIL_DEFAULTS,
): NavRailItem[] {
  const merged = mergeNavConfigItems(savedNavConfig?.items, defaults.items);
  const enabled = merged
    .filter((i) => i.enabled)
    .sort((a, b) => a.order - b.order)
    .map(({ id, label, icon }) => ({ id, label, icon }));
  return enabled.length > 0
    ? enabled
    : defaults.items.map(({ id, label, icon }) => ({ id, label, icon }));
}
