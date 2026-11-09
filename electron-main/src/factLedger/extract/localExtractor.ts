// Purpose: Extract through the user's local model. It sends only to a loopback
// baseUrl on a kind that really uses baseUrl, does Extract only (never
// Classify), and re-checks the mode right before each send. Any failure is
// unsure, so the caller uses script.

import {
  isLoopbackUrl,
  streamFromProvider,
  type ProviderConfig,
  type ProviderKind,
  type StreamRequest,
} from '../../provider.js';
import {
  EXTRACT_SYSTEM_PROMPT,
  PROMPT_VERSION,
  extractUserContent,
  type Extractor,
  type ExtractorInput,
  type ExtractorOutput,
  type FactMode,
} from './types.js';
import { validateOutput } from './validateOutput.js';

/** Longest local reply read (UTF-16 code units). Past it the reply is cut off and unsure. */
export const LOCAL_MAX_REPLY_UNITS = 512 * 1024;
export const LOCAL_EXTRACT_MAX_TOKENS = 4096;

/**
 * Kinds whose stream goes to config.baseUrl (the OpenAI-compatible path).
 * 'anthropic' is not here: its SDK client ignores baseUrl, so a loopback
 * baseUrl on it would still send to the cloud.
 */
const BASEURL_ROUTED_KINDS: ReadonlySet<ProviderKind> = new Set<ProviderKind>([
  'ollama',
  'lmstudio',
  'llamacpp',
  'custom',
  'openai',
]);

export interface LocalExtractorOptions {
  /** The configured provider, read right before each send. */
  getConfig: () => ProviderConfig | null | undefined;
  /** The effective mode, read right before each send. Only Full AI and Local Only may send. */
  getMode: () => FactMode | unknown;
  stream?: (config: ProviderConfig, req: StreamRequest) => AsyncIterable<string>;
}

function mayUseLocal(mode: unknown): boolean {
  return mode === 'local' || mode === 'full';
}

export function createLocalExtractor(options: LocalExtractorOptions): Extractor {
  const stream = options.stream ?? streamFromProvider;
  return {
    id: 'local',
    promptVersion: PROMPT_VERSION.local,
    async extract(input: ExtractorInput, signal: AbortSignal): Promise<ExtractorOutput | null> {
      let config: ProviderConfig | null | undefined;
      try {
        if (!mayUseLocal(options.getMode())) return null;
        config = options.getConfig();
      } catch {
        return null;
      }
      if (!config || !BASEURL_ROUTED_KINDS.has(config.kind) || !isLoopbackUrl(config.baseUrl)) return null;
      if (signal.aborted) return null;

      let reply = '';
      try {
        for await (const token of stream(config, {
          system: EXTRACT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: extractUserContent(input) }],
          maxTokens: LOCAL_EXTRACT_MAX_TOKENS,
          signal,
        })) {
          reply += token;
          if (reply.length > LOCAL_MAX_REPLY_UNITS) return null;
        }
      } catch {
        return null;
      }
      return validateOutput(reply);
    },
  };
}
