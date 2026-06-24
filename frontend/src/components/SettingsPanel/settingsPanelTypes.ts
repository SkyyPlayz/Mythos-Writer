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
  { value: 'claude-opus-4-7', label: 'claude-opus' },
];

export type AgentName = 'writingAssistant' | 'brainstorm' | 'archive';

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

export const DEFAULTS: AppSettings = {
  apiKey: '',
  agents: {
    writingAssistant: { enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, ...BUDGET_DEFAULTS },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', ...BUDGET_DEFAULTS },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, ...BUDGET_DEFAULTS },
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

export const NAV_RAIL_DEFAULTS: NavRailConfig = {
  items: [
    { id: 'story', enabled: true, label: 'Story', icon: '✍', order: 0 },
    { id: 'notes', enabled: true, label: 'Notes', icon: '📝', order: 1 },
  ],
  collapsedDefault: false,
  showLabels: true,
  showIcons: true,
};
