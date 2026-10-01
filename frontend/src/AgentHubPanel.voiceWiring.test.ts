/**
 * Probe B — AgentHubPanel must pass voiceEnabled into UnifiedPartnerChat.
 * RED if `voiceEnabled={voiceEnabled}` is dropped on that call site.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = readFileSync(resolve(process.cwd(), 'src/AgentHubPanel.tsx'), 'utf-8');

describe('AgentHubPanel voiceEnabled wiring', () => {
  it('passes voiceEnabled into UnifiedPartnerChat (not only WritingAssistantPanel)', () => {
    const partnerCall = src.indexOf('<UnifiedPartnerChat');
    expect(partnerCall).toBeGreaterThan(-1);
    const chunk = src.slice(partnerCall, partnerCall + 450);
    expect(chunk).toContain('voiceEnabled={voiceEnabled}');
    expect(chunk).toContain('voicePrefs={voicePrefs}');
    // MiniAgentChat under UnifiedPartnerChat also receives the prop.
    const mini = src.indexOf('<MiniAgentChat');
    expect(mini).toBeGreaterThan(partnerCall);
    const miniChunk = src.slice(mini, mini + 400);
    expect(miniChunk).toContain('voiceEnabled={voiceEnabled}');
  });
});
