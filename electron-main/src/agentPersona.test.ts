// agentPersona.test.ts — Unit tests for MYT-816 persona loader/composer

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadPersonaFile,
  loadAgentPersona,
  buildAgentSystemPrompt,
  resetPersonaFile,
  getBundledPersona,
  getPersonaOverridePath,
  PERSONA_KEYS,
} from './agentPersona.js';

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
});
