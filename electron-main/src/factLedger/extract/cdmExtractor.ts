// Purpose: Extract through CDM. Its only network path is cdmClient; the payload
// is built from ExtractorInput alone (one scene's prose and the names).

import { CDM_EXTRACT_MODEL, type CdmClient } from '../cdmClient.js';
import {
  EXTRACT_SYSTEM_PROMPT,
  PROMPT_VERSION,
  extractUserContent,
  type Extractor,
  type ExtractorInput,
  type ExtractorOutput,
} from './types.js';
import { validateOutput } from './validateOutput.js';

export function createCdmExtractor(client: CdmClient): Extractor {
  return {
    id: 'cdm',
    promptVersion: PROMPT_VERSION.cdm,
    async extract(input: ExtractorInput, signal: AbortSignal): Promise<ExtractorOutput | null> {
      const result = await client.complete(
        {
          model: CDM_EXTRACT_MODEL,
          messages: [
            { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
            { role: 'user', content: extractUserContent(input) },
          ],
        },
        signal,
        validateOutput,
      );
      return result.ok ? result.value : null;
    },
  };
}
