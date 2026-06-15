// SKY-20: Brainstorm routing integration test — exercises the full staging →
// resolve → second-note-no-prompt flow against a real on-disk Notes Vault.
// Plays the role of the IPC handlers in main.ts without booting Electron, so
// it stays in the vitest tier (fast) while still covering the move semantics.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadBrainstormSettings,
  setCategoryRouting,
  resolveDestination,
  normalizeRoutingDestination,
  BLANK_MODE_STAGING_DIR,
} from './brainstormRouting.js';
import {
  writeVaultFileAtomic,
  moveVaultFile,
  readVaultFile,
} from './vault.js';

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function joinPosix(...segs: string[]): string {
  return segs
    .map((s) => s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

interface StagedResult {
  status: 'needs_routing';
  stagedPath: string;
  category: 'character' | 'location' | 'item' | 'faction' | 'scene_card' | 'inbox';
  name: string;
}

interface WrittenResult {
  status: 'written';
  path: string;
  reason: 'default-layout' | 'remembered';
}

/** Simulates the main-side BRAINSTORM_WRITE_NOTE handler. */
function writeNote(args: {
  userData: string;
  notesRoot: string;
  layoutMode: 'default' | 'blank' | 'imported';
  category: 'character' | 'location' | 'item' | 'faction' | 'scene_card' | 'inbox';
  name: string;
  content: string;
}): WrittenResult | StagedResult {
  const { notesRouting } = loadBrainstormSettings(args.userData);
  const resolution = resolveDestination(args.category, args.layoutMode, notesRouting);
  const safeName = args.name.replace(/[/\\:*?"<>|]/g, '-').trim() || 'unnamed';
  const fileName = `${safeName}.md`;
  const body = `---\nname: ${args.name}\ntype: ${args.category}\n---\n# ${args.name}\n\n${args.content}\n`;
  if (resolution.kind === 'resolved') {
    const rel = joinPosix(resolution.relativeDir, fileName);
    writeVaultFileAtomic(args.notesRoot, rel, body);
    return { status: 'written', path: rel, reason: resolution.reason };
  }
  const stagedRel = joinPosix(BLANK_MODE_STAGING_DIR, `id-${Date.now()}__${fileName}`);
  writeVaultFileAtomic(args.notesRoot, stagedRel, body);
  return { status: 'needs_routing', stagedPath: stagedRel, category: args.category, name: args.name };
}

/** Simulates the main-side BRAINSTORM_RESOLVE_ROUTING handler. */
function resolveRouting(args: {
  userData: string;
  notesRoot: string;
  stagedPath: string;
  category: 'character' | 'location' | 'item' | 'faction' | 'scene_card' | 'inbox';
  destination: string;
  remember: boolean;
}): { status: 'written'; path: string } {
  const destination = normalizeRoutingDestination(args.destination);
  const fileName = path.posix.basename(args.stagedPath).replace(/^id-\d+__/, '');
  const targetRel = joinPosix(destination, fileName);
  moveVaultFile(args.notesRoot, args.stagedPath, targetRel);
  if (args.remember) setCategoryRouting(args.userData, args.category, destination);
  return { status: 'written', path: targetRel };
}

describe('Brainstorm routing — staging + resolve flow', () => {
  let userData: string;
  let notesRoot: string;

  beforeEach(() => {
    userData = makeTmp('mythos-bsr-ud-');
    notesRoot = makeTmp('mythos-bsr-notes-');
  });
  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(notesRoot, { recursive: true, force: true });
  });

  it('default mode writes the file straight to the seeded category folder', () => {
    const result = writeNote({
      userData, notesRoot, layoutMode: 'default',
      category: 'character', name: 'Aria Voss', content: 'A sorceress.',
    });
    expect(result.status).toBe('written');
    if (result.status !== 'written') throw new Error('unreachable');
    expect(result.reason).toBe('default-layout');
    expect(result.path).toMatch(/Universes\/My First Universe\/Characters\/Aria Voss\.md$/);
    expect(fs.existsSync(path.join(notesRoot, result.path))).toBe(true);
  });

  it('blank mode + no memory stages the file and asks for routing', () => {
    const result = writeNote({
      userData, notesRoot, layoutMode: 'blank',
      category: 'character', name: 'Aria Voss', content: 'A sorceress.',
    });
    expect(result.status).toBe('needs_routing');
    if (result.status !== 'needs_routing') throw new Error('unreachable');
    // The file should be physically on disk under the staging dir so a crash
    // before the user picks doesn't lose the note.
    expect(fs.existsSync(path.join(notesRoot, result.stagedPath))).toBe(true);
    expect(result.stagedPath.startsWith(BLANK_MODE_STAGING_DIR + '/')).toBe(true);
  });

  it('resolveRouting moves the staged file and remembers the choice when remember=true', () => {
    const staged = writeNote({
      userData, notesRoot, layoutMode: 'blank',
      category: 'character', name: 'Aria Voss', content: 'A sorceress.',
    });
    if (staged.status !== 'needs_routing') throw new Error('expected staged');
    const resolved = resolveRouting({
      userData, notesRoot,
      stagedPath: staged.stagedPath,
      category: 'character',
      destination: 'Worldbuilding/People',
      remember: true,
    });
    expect(resolved.path).toBe('Worldbuilding/People/Aria Voss.md');
    expect(fs.existsSync(path.join(notesRoot, resolved.path))).toBe(true);
    expect(fs.existsSync(path.join(notesRoot, staged.stagedPath))).toBe(false);
    expect(loadBrainstormSettings(userData).notesRouting.character).toBe('Worldbuilding/People');
  });

  it('second note of the same category routes silently with no prompt', () => {
    const first = writeNote({
      userData, notesRoot, layoutMode: 'blank',
      category: 'character', name: 'Aria', content: 'First.',
    });
    if (first.status !== 'needs_routing') throw new Error('expected staged');
    resolveRouting({
      userData, notesRoot,
      stagedPath: first.stagedPath,
      category: 'character',
      destination: 'Chars',
      remember: true,
    });

    // SKY-20 AC3 — same-category note must NOT prompt again in this session.
    const second = writeNote({
      userData, notesRoot, layoutMode: 'blank',
      category: 'character', name: 'Kael', content: 'Second.',
    });
    expect(second.status).toBe('written');
    if (second.status !== 'written') throw new Error('unreachable');
    expect(second.reason).toBe('remembered');
    expect(second.path).toBe('Chars/Kael.md');
    expect(fs.existsSync(path.join(notesRoot, second.path))).toBe(true);
  });

  it('different category still prompts — memory is per-category', () => {
    // Set memory for character first.
    const c = writeNote({
      userData, notesRoot, layoutMode: 'blank',
      category: 'character', name: 'Aria', content: '.',
    });
    if (c.status !== 'needs_routing') throw new Error('expected staged');
    resolveRouting({
      userData, notesRoot, stagedPath: c.stagedPath,
      category: 'character', destination: 'Chars', remember: true,
    });
    // Location should still prompt.
    const loc = writeNote({
      userData, notesRoot, layoutMode: 'blank',
      category: 'location', name: 'Tarsel', content: '.',
    });
    expect(loc.status).toBe('needs_routing');
  });

  it('remember=false routes the file but does not poison memory', () => {
    const first = writeNote({
      userData, notesRoot, layoutMode: 'blank',
      category: 'character', name: 'Aria', content: '.',
    });
    if (first.status !== 'needs_routing') throw new Error('expected staged');
    resolveRouting({
      userData, notesRoot, stagedPath: first.stagedPath,
      category: 'character', destination: 'OneOff', remember: false,
    });
    expect(loadBrainstormSettings(userData).notesRouting.character).toBeUndefined();
    // Next note prompts again.
    const second = writeNote({
      userData, notesRoot, layoutMode: 'blank',
      category: 'character', name: 'Kael', content: '.',
    });
    expect(second.status).toBe('needs_routing');
  });

  it('resolution preserves the original note body — the move is a rename, not a rewrite', () => {
    const original = writeNote({
      userData, notesRoot, layoutMode: 'blank',
      category: 'location', name: 'Tarsel', content: 'A city of bells.',
    });
    if (original.status !== 'needs_routing') throw new Error('expected staged');
    const stagedBody = readVaultFile(notesRoot, original.stagedPath).content;
    const resolved = resolveRouting({
      userData, notesRoot,
      stagedPath: original.stagedPath,
      category: 'location', destination: 'Places', remember: true,
    });
    const finalBody = readVaultFile(notesRoot, resolved.path).content;
    expect(finalBody).toBe(stagedBody);
  });

  it('default mode ignores any memory the user accumulated before switching', () => {
    setCategoryRouting(userData, 'character', 'OldChoice');
    const result = writeNote({
      userData, notesRoot, layoutMode: 'default',
      category: 'character', name: 'Aria', content: '.',
    });
    expect(result.status).toBe('written');
    if (result.status !== 'written') throw new Error('unreachable');
    expect(result.reason).toBe('default-layout');
    expect(result.path).not.toMatch(/OldChoice/);
  });
});
