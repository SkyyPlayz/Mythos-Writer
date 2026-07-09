// agentPersona.test.ts — Unit tests for MYT-816 persona loader/composer

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Hoist electron mock so ipc.ts can be imported for §6 frame-guard tests.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn() },
}));

import {
  loadPersonaFile,
  loadAgentPersona,
  buildAgentSystemPrompt,
  resetPersonaFile,
  getBundledPersona,
  getPersonaOverridePath,
  validatePersonaArgs,
  resolvedInsideRoot,
  PERSONA_KEYS,
  validatePersonaPayload,
  writePersonaFile,
  resolveAgentDisplayName,
  IDENTITY_FILES,
  VALID_AGENT_NAMES,
  DEFAULT_AGENT_DISPLAY_NAMES,
  MAX_PERSONA_FILE_LENGTH,
} from './agentPersona.js';
import type { AgentPersonaName } from './agentPersona.js';
import { isFromTopFrame, UNTRUSTED_FRAME_REJECTION } from './ipc.js';
import type { IpcMainInvokeEvent } from 'electron';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-persona-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── §1  loadPersonaFile ──────────────────────────────────────────────────────

describe('loadPersonaFile (§1)', () => {
  it('returns bundled default when no override exists', () => {
    const result = loadPersonaFile(tmpDir, 'writingAssistant', 'SOUL');
    expect(result.isCustom).toBe(false);
    expect(result.content).toContain('Writing Assistant');
  });

  it('returns user override when override file exists', () => {
    const overridePath = getPersonaOverridePath(tmpDir, 'brainstorm', 'AGENTS');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '# Custom agents\nmy custom rules', 'utf-8');

    const result = loadPersonaFile(tmpDir, 'brainstorm', 'AGENTS');
    expect(result.isCustom).toBe(true);
    expect(result.content).toBe('# Custom agents\nmy custom rules');
  });

  it('falls back to bundled default when override file is unreadable', () => {
    const overridePath = getPersonaOverridePath(tmpDir, 'writingAssistant', 'HEARTBEAT');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    // Write a directory at the file path so readFileSync fails
    fs.mkdirSync(overridePath);

    const result = loadPersonaFile(tmpDir, 'writingAssistant', 'HEARTBEAT');
    expect(result.isCustom).toBe(false);
    expect(result.content).toContain('Per-Request Checklist');
  });

  it('loads all four PERSONA_KEYS for both agents without throwing', () => {
    for (const agent of ['writingAssistant', 'brainstorm'] as const) {
      for (const key of PERSONA_KEYS) {
        expect(() => loadPersonaFile(tmpDir, agent, key)).not.toThrow();
      }
    }
  });
});

// ─── §2  loadAgentPersona ─────────────────────────────────────────────────────

describe('loadAgentPersona (§2)', () => {
  it('returns an object with all four keys for writingAssistant', () => {
    const persona = loadAgentPersona(tmpDir, 'writingAssistant');
    for (const key of PERSONA_KEYS) {
      expect(persona[key]).toBeDefined();
      expect(typeof persona[key].content).toBe('string');
      expect(persona[key].content.length).toBeGreaterThan(0);
    }
  });

  it('returns an object with all four keys for brainstorm', () => {
    const persona = loadAgentPersona(tmpDir, 'brainstorm');
    for (const key of PERSONA_KEYS) {
      expect(persona[key].content.length).toBeGreaterThan(0);
    }
  });

  it('marks only overridden keys as isCustom', () => {
    const overridePath = getPersonaOverridePath(tmpDir, 'brainstorm', 'SOUL');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '# My custom soul', 'utf-8');

    const persona = loadAgentPersona(tmpDir, 'brainstorm');
    expect(persona.SOUL.isCustom).toBe(true);
    expect(persona.AGENTS.isCustom).toBe(false);
    expect(persona.HEARTBEAT.isCustom).toBe(false);
    expect(persona.TOOLS.isCustom).toBe(false);
  });
});

// ─── §3  buildAgentSystemPrompt ───────────────────────────────────────────────

describe('buildAgentSystemPrompt (§3)', () => {
  it('includes SOUL content', () => {
    const prompt = buildAgentSystemPrompt(tmpDir, 'writingAssistant');
    expect(prompt).toContain('Writing Assistant');
    // SOUL.md has "Warm but direct"
    expect(prompt).toContain('Warm but direct');
  });

  it('includes AGENTS content', () => {
    const prompt = buildAgentSystemPrompt(tmpDir, 'brainstorm');
    expect(prompt).toContain('FACT:character');
  });

  it('includes HEARTBEAT content', () => {
    const prompt = buildAgentSystemPrompt(tmpDir, 'brainstorm');
    expect(prompt).toContain('Per-Request Checklist');
  });

  it('does NOT include TOOLS content', () => {
    const prompt = buildAgentSystemPrompt(tmpDir, 'writingAssistant');
    // TOOLS.md header should not appear in the system prompt
    expect(prompt).not.toContain('Declared Tool Surface');
  });

  it('joins sections with separator', () => {
    const prompt = buildAgentSystemPrompt(tmpDir, 'writingAssistant');
    expect(prompt).toContain('---');
  });

  it('uses custom SOUL when override exists', () => {
    const overridePath = getPersonaOverridePath(tmpDir, 'writingAssistant', 'SOUL');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '# Custom voice\nI am very dramatic.', 'utf-8');

    const prompt = buildAgentSystemPrompt(tmpDir, 'writingAssistant');
    expect(prompt).toContain('I am very dramatic.');
    expect(prompt).not.toContain('Warm but direct');
  });
});

// ─── §4  resetPersonaFile ─────────────────────────────────────────────────────

describe('resetPersonaFile (§4)', () => {
  it('deletes the override file when it exists', () => {
    const overridePath = getPersonaOverridePath(tmpDir, 'writingAssistant', 'AGENTS');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '# custom', 'utf-8');
    expect(fs.existsSync(overridePath)).toBe(true);

    resetPersonaFile(tmpDir, 'writingAssistant', 'AGENTS');
    expect(fs.existsSync(overridePath)).toBe(false);
  });

  it('does not throw when the file does not exist', () => {
    expect(() => resetPersonaFile(tmpDir, 'brainstorm', 'TOOLS')).not.toThrow();
  });

  it('after reset, loadPersonaFile returns bundled default', () => {
    const overridePath = getPersonaOverridePath(tmpDir, 'brainstorm', 'AGENTS');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '# custom brainstorm agents', 'utf-8');

    resetPersonaFile(tmpDir, 'brainstorm', 'AGENTS');
    const result = loadPersonaFile(tmpDir, 'brainstorm', 'AGENTS');
    expect(result.isCustom).toBe(false);
    expect(result.content).toContain('Brainstorm Agent');
  });
});

// ─── §5  getBundledPersona ────────────────────────────────────────────────────

describe('getBundledPersona (§5)', () => {
  it('returns non-empty content for all agent+key combinations', () => {
    for (const agent of ['writingAssistant', 'brainstorm'] as const) {
      for (const key of PERSONA_KEYS) {
        const content = getBundledPersona(agent, key);
        expect(typeof content).toBe('string');
        expect(content.length).toBeGreaterThan(0);
      }
    }
  });

  it('brainstorm AGENTS bundled default contains FACT tag syntax', () => {
    const content = getBundledPersona('brainstorm', 'AGENTS');
    expect(content).toContain('[FACT:');
  });

  it('brainstorm AGENTS teaches only tag types parseFacts accepts (no deprecated note)', () => {
    const content = getBundledPersona('brainstorm', 'AGENTS');
    // parseFacts accepts character|location|item|faction|scene_card|inbox;
    // the deprecated 'note' type is silently dropped by the parser, so the
    // bundled prompt must not teach it.
    expect(content).not.toContain('[FACT:note|');
    expect(content).toContain('[FACT:inbox|');
    expect(content).toContain('[FACT:faction|');
    expect(content).toContain('[FACT:scene_card|');
  });

  it('archive AGENTS instructs coverage with severity marking rather than dropping uncertain flags', () => {
    const content = getBundledPersona('archive', 'AGENTS');
    expect(content).toContain('Report every genuine contradiction');
    expect(content).toContain('lower severity');
  });

  it('betaReader AGENTS requires verbatim anchors', () => {
    const content = getBundledPersona('betaReader', 'AGENTS');
    expect(content).toContain('character-for-character');
  });
});

// ─── §6  Security: validatePersonaArgs + resetPersonaFile containment ─────────

describe('validatePersonaArgs (§6)', () => {
  it('throws on out-of-enum agentName', () => {
    expect(() => validatePersonaArgs('../../databases', 'AGENTS')).toThrow('invalid_agent_name');
  });

  it('throws on out-of-enum key', () => {
    expect(() => validatePersonaArgs('writingAssistant', '../../etc/passwd')).toThrow('invalid_key');
  });

  it('throws when both agentName and key are invalid', () => {
    expect(() => validatePersonaArgs('badAgent', 'badKey')).toThrow('invalid_agent_name');
  });

  it('throws on non-string agentName (null)', () => {
    expect(() => validatePersonaArgs(null, 'AGENTS')).toThrow('invalid_agent_name');
  });

  it('throws on non-string key (object)', () => {
    expect(() => validatePersonaArgs('writingAssistant', {})).toThrow('invalid_key');
  });

  it('does not throw for all valid agentName + key combinations', () => {
    for (const agent of ['writingAssistant', 'brainstorm'] as const) {
      for (const key of PERSONA_KEYS) {
        expect(() => validatePersonaArgs(agent, key)).not.toThrow();
      }
    }
  });
});

describe('resetPersonaFile containment guard (§6)', () => {
  it('throws and does not delete when agentName traverses outside agent-personas', () => {
    const userData = path.join(tmpDir, 'userData');
    fs.mkdirSync(userData, { recursive: true });

    // path.join(userData, 'agent-personas', '../secret', 'AGENTS.md')
    // normalises to path.join(userData, 'secret', 'AGENTS.md') — outside agent-personas/
    const victimFile = path.join(userData, 'secret', 'AGENTS.md');
    fs.mkdirSync(path.dirname(victimFile), { recursive: true });
    fs.writeFileSync(victimFile, 'precious data', 'utf-8');

    expect(() => {
      resetPersonaFile(userData, '../secret' as AgentPersonaName, 'AGENTS');
    }).toThrow('Path escape detected');

    expect(fs.existsSync(victimFile)).toBe(true);
  });

  it('valid reset still deletes the correct override file', () => {
    const overridePath = getPersonaOverridePath(tmpDir, 'writingAssistant', 'AGENTS');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '# custom', 'utf-8');

    resetPersonaFile(tmpDir, 'writingAssistant', 'AGENTS');

    expect(fs.existsSync(overridePath)).toBe(false);
  });
});

// ─── §6b  resolvedInsideRoot + getPersonaOverridePath containment ─────────────
// Regression for SEC-5: path traversal via agentName or key supplied over IPC.

describe('resolvedInsideRoot (§6b)', () => {
  it('returns the resolved absolute path for valid inputs', () => {
    const result = resolvedInsideRoot(tmpDir, 'writingAssistant', 'SOUL.md');
    expect(result).toBe(path.resolve(tmpDir, 'writingAssistant', 'SOUL.md'));
  });

  it('throws when ../.. in first segment escapes root', () => {
    expect(() => resolvedInsideRoot(tmpDir, '../../etc', 'AGENTS.md')).toThrow('Path escape detected');
  });

  it('throws when traversal is in a later segment', () => {
    expect(() => resolvedInsideRoot(tmpDir, 'writingAssistant', '../../../etc/passwd')).toThrow(
      'Path escape detected',
    );
  });

  it('does not throw for all real persona combos', () => {
    const personasRoot = path.join(tmpDir, 'agent-personas');
    for (const agent of ['writingAssistant', 'brainstorm'] as const) {
      for (const key of PERSONA_KEYS) {
        expect(() => resolvedInsideRoot(personasRoot, agent, `${key}.md`)).not.toThrow();
      }
    }
  });
});

describe('getPersonaOverridePath containment (§6b)', () => {
  it('throws when agentName contains path traversal', () => {
    expect(() =>
      getPersonaOverridePath(tmpDir, '../../etc' as AgentPersonaName, 'AGENTS'),
    ).toThrow('Path escape detected');
  });

  it('does not throw for valid agentName and key', () => {
    for (const agent of ['writingAssistant', 'brainstorm'] as const) {
      for (const key of PERSONA_KEYS) {
        expect(() => getPersonaOverridePath(tmpDir, agent, key)).not.toThrow();
      }
    }
  });
});

// ─── §6 SEC-6 anti-injection instruction regression ───────────────────────────
// The bundled writingAssistant AGENTS must include the content-security instruction
// so the LLM knows to treat <scene_context> content as data, not instructions.

describe('writingAssistant AGENTS anti-injection instruction (§6 / SEC-6)', () => {
  it('bundled AGENTS default includes the scene_context tag name', () => {
    const content = getBundledPersona('writingAssistant', 'AGENTS');
    expect(content).toContain('scene_context');
  });

  it('bundled AGENTS default instructs LLM to treat context as data not instructions', () => {
    const content = getBundledPersona('writingAssistant', 'AGENTS');
    // The instruction must communicate that the tagged block is source material / data.
    expect(content.toLowerCase()).toMatch(/data|source material/);
    expect(content.toLowerCase()).toMatch(/not.*instructions?|instructions?.*not/);
  });

  it('system prompt includes the anti-injection instruction', () => {
    const prompt = buildAgentSystemPrompt(tmpDir, 'writingAssistant');
    expect(prompt).toContain('scene_context');
    expect(prompt.toLowerCase()).toMatch(/data|source material/);
  });

  it('system prompt does not include the instruction when AGENTS override removes it', () => {
    // Verify the guard lives in bundled AGENTS, not hardcoded elsewhere.
    const overridePath = getPersonaOverridePath(tmpDir, 'writingAssistant', 'AGENTS');
    fs.mkdirSync(path.dirname(overridePath), { recursive: true });
    fs.writeFileSync(overridePath, '# Custom agents — no security section', 'utf-8');

    const prompt = buildAgentSystemPrompt(tmpDir, 'writingAssistant');
    expect(prompt).not.toContain('scene_context');
  });
});

// ─── §6c  validatePersonaPayload — return-style validation (SKY-698) ──────────

describe('validatePersonaPayload — traversal rejection (§6c)', () => {
  it('rejects path-traversal agentName, returns { error: "invalid agentName" }', () => {
    expect(validatePersonaPayload('../../..', 'SOUL')).toEqual({ ok: false, error: 'invalid agentName' });
  });

  it('rejects path-traversal key', () => {
    expect(validatePersonaPayload('writingAssistant', '../../../foo')).toEqual({
      ok: false,
      error: 'invalid key',
    });
  });

  it('rejects traversal in both fields — agentName checked first', () => {
    expect(validatePersonaPayload('../../..', '../../../foo')).toEqual({
      ok: false,
      error: 'invalid agentName',
    });
  });

  it('rejects null agentName', () => {
    expect(validatePersonaPayload(null, 'SOUL')).toEqual({ ok: false, error: 'invalid agentName' });
  });

  it('rejects undefined key', () => {
    expect(validatePersonaPayload('writingAssistant', undefined)).toEqual({
      ok: false,
      error: 'invalid key',
    });
  });

  it('accepts every valid agentName + key combination', () => {
    for (const agent of ['writingAssistant', 'brainstorm'] as const) {
      for (const key of PERSONA_KEYS) {
        const result = validatePersonaPayload(agent, key);
        expect(result).toMatchObject({ ok: true, agentName: agent, key });
      }
    }
  });
});

// ─── §7  Beta 3 M22 — four agents, identity files, editing, display names ─────

describe('M22 §7a — all four named agents carry a full file set', () => {
  it('VALID_AGENT_NAMES contains exactly the four named agents', () => {
    expect([...VALID_AGENT_NAMES].sort()).toEqual(
      ['archive', 'betaReader', 'brainstorm', 'writingAssistant'],
    );
  });

  it('every agent+key combination has non-empty bundled content', () => {
    for (const agent of VALID_AGENT_NAMES) {
      for (const key of PERSONA_KEYS) {
        expect(getBundledPersona(agent, key).length).toBeGreaterThan(0);
      }
    }
  });

  it('PERSONA_KEYS includes LEARNING', () => {
    expect(PERSONA_KEYS).toContain('LEARNING');
  });

  it('betaReader AGENTS bundled default carries the JSON output contract and anti-injection guard', () => {
    const content = getBundledPersona('betaReader', 'AGENTS');
    expect(content).toContain('scene_context');
    expect(content).toContain('"anchor"');
    expect(content).toContain('"comment"');
    expect(content.toLowerCase()).toMatch(/not.*instructions?/);
  });

  it('betaReader system prompt composes and keeps the output contract', () => {
    const prompt = buildAgentSystemPrompt(tmpDir, 'betaReader');
    expect(prompt).toContain('"anchor"');
    expect(prompt).toContain('one JSON object per line');
  });
});

describe('M22 §7b — IDENTITY_FILES mapping (agent/instructions/learning/soul)', () => {
  it('maps the four prototype file names onto persona keys in prototype order', () => {
    expect(IDENTITY_FILES.map((f) => f.fileName)).toEqual(
      ['agent.md', 'instructions.md', 'learning.md', 'soul.md'],
    );
    expect(IDENTITY_FILES.map((f) => f.key)).toEqual(
      ['AGENTS', 'HEARTBEAT', 'LEARNING', 'SOUL'],
    );
  });

  it('every identity file key is a valid PersonaKey', () => {
    for (const f of IDENTITY_FILES) expect(PERSONA_KEYS).toContain(f.key);
  });
});

describe('M22 §7c — writePersonaFile (identity files editable)', () => {
  it('round-trips: write → loadPersonaFile returns the custom content', () => {
    writePersonaFile(tmpDir, 'betaReader', 'SOUL', '# Grumpy reviewer\nHard to please.');
    const result = loadPersonaFile(tmpDir, 'betaReader', 'SOUL');
    expect(result.isCustom).toBe(true);
    expect(result.content).toBe('# Grumpy reviewer\nHard to please.');
  });

  it('editing an identity file changes the composed system prompt', () => {
    const before = buildAgentSystemPrompt(tmpDir, 'betaReader');
    expect(before).not.toContain('always mention the weather');

    writePersonaFile(tmpDir, 'betaReader', 'LEARNING', '# Learning\n2026-07-07 · always mention the weather');
    const after = buildAgentSystemPrompt(tmpDir, 'betaReader');
    expect(after).toContain('always mention the weather');
  });

  it('reset after write restores the bundled default', () => {
    writePersonaFile(tmpDir, 'archive', 'HEARTBEAT', '# custom checklist');
    resetPersonaFile(tmpDir, 'archive', 'HEARTBEAT');
    const result = loadPersonaFile(tmpDir, 'archive', 'HEARTBEAT');
    expect(result.isCustom).toBe(false);
    expect(result.content).toContain('Per-Request Checklist');
  });

  it('rejects content over the length cap', () => {
    const huge = 'x'.repeat(MAX_PERSONA_FILE_LENGTH + 1);
    expect(() => writePersonaFile(tmpDir, 'brainstorm', 'SOUL', huge)).toThrow('content_too_long');
  });

  it('rejects non-string content', () => {
    expect(() =>
      writePersonaFile(tmpDir, 'brainstorm', 'SOUL', { evil: true } as unknown as string),
    ).toThrow('invalid_content');
  });

  it('containment guard blocks traversal through agentName', () => {
    expect(() =>
      writePersonaFile(tmpDir, '../secret' as AgentPersonaName, 'AGENTS', 'x'),
    ).toThrow('Path escape detected');
  });
});

describe('M22 §7d — buildAgentSystemPrompt includes LEARNING', () => {
  it('includes bundled LEARNING content', () => {
    const prompt = buildAgentSystemPrompt(tmpDir, 'writingAssistant');
    expect(prompt).toContain('# Writing Assistant — Learning');
  });

  it('still excludes TOOLS for every agent', () => {
    for (const agent of VALID_AGENT_NAMES) {
      expect(buildAgentSystemPrompt(tmpDir, agent)).not.toContain('Declared Tool Surface');
    }
  });
});

describe('M22 §7e — resolveAgentDisplayName (renames propagate)', () => {
  it('returns the default display name when no custom name is set', () => {
    expect(resolveAgentDisplayName('betaReader')).toBe('Beta Reader');
    expect(resolveAgentDisplayName('archive', {})).toBe('Archive Agent');
  });

  it('returns the custom name when set', () => {
    expect(resolveAgentDisplayName('betaReader', { betaReader: 'Ruthless Rita' })).toBe('Ruthless Rita');
  });

  it('falls back to the default for blank/whitespace custom names', () => {
    expect(resolveAgentDisplayName('brainstorm', { brainstorm: '   ' })).toBe('Brainstorm Agent');
  });

  it('has a default for every valid agent', () => {
    for (const agent of VALID_AGENT_NAMES) {
      expect(DEFAULT_AGENT_DISPLAY_NAMES[agent].length).toBeGreaterThan(0);
    }
  });
});

// ─── §6d  isFromTopFrame frame guard (SKY-698) ───────────────────────────────

describe('isFromTopFrame frame guard (§6d — used by persona handlers)', () => {
  function makeTopFrame(): Record<string, unknown> {
    const frame: Record<string, unknown> = {};
    frame.top = frame; // self-reference: top === itself
    return frame;
  }

  function makeNestedFrame(): { frame: Record<string, unknown>; top: Record<string, unknown> } {
    const top = makeTopFrame();
    const frame: Record<string, unknown> = { top };
    return { frame, top };
  }

  it('handler returns UNTRUSTED_FRAME_REJECTION when senderFrame is a nested frame', () => {
    const { frame } = makeNestedFrame();
    const event = { senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const result = !isFromTopFrame(event) ? UNTRUSTED_FRAME_REJECTION : null;
    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
  });

  it('handler proceeds past the frame guard when senderFrame is the top frame', () => {
    const top = makeTopFrame();
    const event = { senderFrame: top } as unknown as IpcMainInvokeEvent;
    expect(isFromTopFrame(event)).toBe(true);
  });

  it('handler returns UNTRUSTED_FRAME_REJECTION when senderFrame is null (frame destroyed)', () => {
    const event = { senderFrame: null } as unknown as IpcMainInvokeEvent;
    const result = !isFromTopFrame(event) ? UNTRUSTED_FRAME_REJECTION : null;
    expect(result).toBe(UNTRUSTED_FRAME_REJECTION);
  });
});
