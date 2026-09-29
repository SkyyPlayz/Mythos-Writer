/**
 * Slice C — Writing partner + Model & keys settings shape.
 * Identity name/icon bind the existing B partner store (agentNames.brainstorm).
 * Slice D: Settings also syncs name/icon to Agents Vault partner.md.
 */

import type {
  PartnerAmbient,
  PartnerRegister,
  PartnerTeach,
  PartnerTone,
  PartnerVerbosity,
} from './partnerPersonality';
import type { PartnerHandId } from '../agents/partnerIdentity';

export type PartnerIconId =
  | 'sparkle'
  | 'feather'
  | 'moon'
  | 'star'
  | 'eye'
  | 'compass'
  | 'flame'
  | 'gem';

export type ClaudeCliState = 'none' | 'installing' | 'login' | 'ready';
export type ClaudeCliMode = 'app' | 'cli';
export type TelemetryLevel = 'off' | 'crash' | 'usage';

/**
 * F3#11 — Writing Partner confidence slider labels (near bottom of Settings).
 * Default **Confident** maps to the historic 0.85 auto-apply threshold.
 */
export type PartnerConfidenceLabel =
  | 'Hesitant'
  | 'Cautious'
  | 'Balanced'
  | 'Confident'
  | 'Bold';

export const PARTNER_CONFIDENCE_LEVELS: readonly PartnerConfidenceLabel[] = [
  'Hesitant',
  'Cautious',
  'Balanced',
  'Confident',
  'Bold',
] as const;

/** Numeric thresholds partner hands read via agents.*.confidenceThreshold. */
export const PARTNER_CONFIDENCE_THRESHOLDS: Record<PartnerConfidenceLabel, number> = {
  Hesitant: 0.5,
  Cautious: 0.65,
  Balanced: 0.75,
  Confident: 0.85,
  Bold: 0.95,
};

export const DEFAULT_PARTNER_CONFIDENCE: PartnerConfidenceLabel = 'Confident';

export function confidenceLabelFromThreshold(value: number): PartnerConfidenceLabel {
  let best: PartnerConfidenceLabel = DEFAULT_PARTNER_CONFIDENCE;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const label of PARTNER_CONFIDENCE_LEVELS) {
    const dist = Math.abs(PARTNER_CONFIDENCE_THRESHOLDS[label] - value);
    if (dist < bestDist) {
      best = label;
      bestDist = dist;
    }
  }
  return best;
}

export function resolvePartnerConfidence(
  settings: AppSettings | undefined,
): { label: PartnerConfidenceLabel; threshold: number } {
  const partner = resolveWritingPartner(settings);
  const label = partner.confidence;
  return { label, threshold: PARTNER_CONFIDENCE_THRESHOLDS[label] };
}

/** UI provider pick for Model & keys buckets (maps to engine kinds where live). */
export type ModelKeysProviderId =
  | 'claude'
  | 'openai-codex'
  | 'gemini'
  | 'copilot'
  | 'cursor'
  | 'openrouter'
  | 'paste-key'
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp';

export type HeartbeatAutomationId = 'dedupe' | 'continuity' | 'questions' | 'timeline';

export interface WritingPartnerSettings {
  icon: PartnerIconId;
  tone: PartnerTone;
  teach: PartnerTeach;
  register: PartnerRegister;
  ambient: PartnerAmbient;
  verbosity: PartnerVerbosity;
  memory: boolean;
  craft: boolean;
  initiative: boolean;
  /** Partner chat/voice model (scoped to chosen provider). */
  modelPartner: string;
  modelWriter: string;
  modelAnalyst: string;
  modelArchivist: string;
  webSearch: boolean;
  claudeMemory: boolean;
  inventTools: boolean;
  /** When true, custom tools are disabled — never affects built-ins. */
  customToolsOff: boolean;
  heartbeatOn: boolean;
  heartbeat: Partial<Record<HeartbeatAutomationId, boolean>>;
  /** Model & keys provider bucket selection. */
  modelKeysProvider: ModelKeysProviderId;
  /** Claude connect stub state — IPC stubs only. */
  claudeCli: ClaudeCliState;
  claudeCliMode: ClaudeCliMode;
  /** Help improve Mythos — Don't send is default. */
  telemetryLevel: TelemetryLevel;
  /** F3#11 — suggestion auto-apply confidence; default Confident (0.85). */
  confidence: PartnerConfidenceLabel;
}

export const DEFAULT_WRITING_PARTNER: WritingPartnerSettings = {
  icon: 'sparkle',
  tone: 'Kind + firm',
  teach: 'Adaptive',
  register: 'Dual',
  ambient: 'Quiet',
  verbosity: 'Balanced',
  memory: true,
  craft: true,
  initiative: true,
  modelPartner: 'claude-sonnet-4-5',
  modelWriter: 'claude-sonnet-4-5',
  modelAnalyst: 'claude-sonnet-4-5',
  modelArchivist: 'claude-haiku-4-5',
  webSearch: false,
  claudeMemory: false,
  inventTools: false,
  customToolsOff: true,
  heartbeatOn: true,
  heartbeat: {
    dedupe: false,
    continuity: false,
    questions: false,
    timeline: false,
  },
  modelKeysProvider: 'claude',
  claudeCli: 'none',
  claudeCliMode: 'app',
  telemetryLevel: 'off',
  confidence: DEFAULT_PARTNER_CONFIDENCE,
};

export const PARTNER_ICON_OPTIONS: readonly PartnerIconId[] = [
  'sparkle',
  'feather',
  'moon',
  'star',
  'eye',
  'compass',
  'flame',
  'gem',
];

export const HEARTBEAT_ROWS: ReadonlyArray<{
  id: HeartbeatAutomationId;
  title: string;
  description: string;
  hand: PartnerHandId;
}> = [
  {
    id: 'dedupe',
    title: 'Vault cleanup',
    description: 'Near-duplicate notes merged into one; broken and stale links rewired.',
    hand: 'archivist',
  },
  {
    id: 'continuity',
    title: 'Continuity / beta-style read',
    description: 'Story ↔ vault fact checks and first-reader reactions, pinned as suggestions.',
    hand: 'analyst',
  },
  {
    id: 'questions',
    title: 'Notes-gap & story-question refresh',
    description: 'Keeps the Questions sidebar current.',
    hand: 'archivist',
  },
  {
    id: 'timeline',
    title: 'Archivist timeline & done-vs-planned',
    description: 'Rebuilds the story timeline; diffs plotted against intended.',
    hand: 'archivist',
  },
];

export const BUILTIN_TOOLS: ReadonlyArray<{ title: string; description: string }> = [
  { title: 'Vault search', description: 'Finds notes, scenes and tags by name or content.' },
  { title: 'Scene card', description: 'Reads and writes the beats, POV and status of one scene.' },
  { title: 'Continuity flag', description: 'Pins a story ↔ vault conflict where you can see it.' },
  { title: 'Timeline note', description: 'Places or moves one dated event on a timeline.' },
];

export const HAND_LIMITS: Record<PartnerHandId, { description: string; limit: string }> = {
  writer: {
    description: 'Prose work that lands in notes and other vault prose.',
    limit:
      'Notes-only by default. Manuscript line edits need explicit confirmation. Never authors story into the manuscript except on an explicit continuity-fix request.',
  },
  analyst: {
    description: 'Reads manuscript, vault and timeline; produces reports — reads, beta-style reactions, analysis.',
    limit: 'No silent vault or manuscript writes.',
  },
  archivist: {
    description: 'Timeline build + done-vs-planned diff (plotted vs intended).',
    limit: 'Structural and continuity tooling — not a second chat persona.',
  },
};

/** Models listed per Model & keys provider pick. */
export const PROVIDER_MODEL_LISTS: Record<ModelKeysProviderId, readonly string[]> = {
  claude: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
  'openai-codex': ['codex-1', 'gpt-5.1-codex', 'gpt-5.1-codex-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  copilot: ['copilot-gpt-5.1', 'copilot-claude-sonnet-4.5', 'copilot-o4-mini'],
  cursor: ['cursor-composer', 'cursor-fast', 'claude-sonnet-4-5'],
  openrouter: [
    'anthropic/claude-sonnet-4.5',
    'openai/gpt-5.1',
    'meta-llama/llama-3.3-70b',
    'deepseek/deepseek-v3',
  ],
  'paste-key': ['gpt-5.1', 'gpt-5.1-mini', 'o4-mini', 'custom-model'],
  ollama: ['llama3.3:70b', 'mistral-small', 'qwen2.5:32b'],
  lmstudio: ['local-gguf-14b', 'local-gguf-7b'],
  llamacpp: ['local-gguf-14b', 'local-gguf-7b'],
};

export const COMING_SOON_PROVIDERS = new Set<ModelKeysProviderId>([
  'openai-codex',
  'gemini',
  'copilot',
  'cursor',
]);

export function resolveWritingPartner(settings: AppSettings | undefined): WritingPartnerSettings {
  const raw = settings?.writingPartner;
  if (!raw) return { ...DEFAULT_WRITING_PARTNER, heartbeat: { ...DEFAULT_WRITING_PARTNER.heartbeat } };
  const merged = {
    ...DEFAULT_WRITING_PARTNER,
    ...(raw as Partial<WritingPartnerSettings>),
    heartbeat: { ...DEFAULT_WRITING_PARTNER.heartbeat, ...(raw.heartbeat ?? {}) },
  };
  const conf = (raw as Partial<WritingPartnerSettings>).confidence;
  if (conf && (PARTNER_CONFIDENCE_LEVELS as readonly string[]).includes(conf)) {
    merged.confidence = conf;
  } else if (typeof (settings?.agents?.brainstorm as { confidenceThreshold?: number } | undefined)?.confidenceThreshold === 'number') {
    merged.confidence = confidenceLabelFromThreshold(
      (settings!.agents!.brainstorm as { confidenceThreshold: number }).confidenceThreshold,
    );
  } else {
    merged.confidence = DEFAULT_PARTNER_CONFIDENCE;
  }
  return merged;
}

/** Scope a saved model to the active provider list; fall back to provider default. */
export function scopedModel(provider: ModelKeysProviderId, saved: string, fallbackIndex = 0): string {
  const list = PROVIDER_MODEL_LISTS[provider];
  if (list.includes(saved)) return saved;
  return list[fallbackIndex] ?? list[0] ?? saved;
}

export function modelsForProvider(provider: ModelKeysProviderId): readonly string[] {
  return PROVIDER_MODEL_LISTS[provider];
}
