/**
 * suggestionApply.b2.test.ts — AI-SUGGEST B2 apply, rollback, W7, W8, T-B10.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  closeDb,
  getSuggestion,
  insertAuditLog,
  listAuditLog,
  openDb,
  updateSuggestionStatus,
  upsertSuggestion,
  type DbSuggestion,
} from './db.js';
import {
  applyVaultWrite,
  applyVaultWriteLocked,
  commitSuggestionWrite,
  performAutoMark,
  refusalUserMessage,
  rollbackVaultWrite,
  SuggestionRefusedError,
  writeGuardedArchiveEntity,
  writeGuardedContinuityNote,
} from './suggestionApply.js';
import * as aiGuard from './vault/aiWriteGuard.js';
import * as entities from './entities.js';
import * as vault from './vault.js';
import type { Manifest } from './ipc.js';

const V1_FIXTURE = path.resolve(__dirname, '../../e2e/fixtures/v1-vault-pre-templates-v2');
const PUSHY = path.resolve(__dirname, '../../e2e/fixtures/pushy-ask-48.json');
const MAIN_SRC = path.resolve(__dirname, 'main.ts');

let dbDir: string;
let vaultDir: string;
const extraDirs: string[] = [];

function sha(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyV1(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-b2-apply-'));
  fs.cpSync(V1_FIXTURE, root, { recursive: true });
  extraDirs.push(root);
  return root;
}

function suggestion(overrides: Partial<DbSuggestion> = {}): DbSuggestion {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    source_agent: 'writing-assistant',
    confidence: 0.9,
    rationale: 'b2',
    target_kind: 'vault',
    target_path: 'entities/characters/Hero.md',
    target_anchor: null,
    payload_json: JSON.stringify({ content: `New content for ${id}\n` }),
    status: 'proposed',
    created_at: new Date().toISOString(),
    applied_at: null,
    applied_run_id: null,
    budget_exceeded: 0,
    category: null,
    ...overrides,
  };
}

function scenePath(root: string): string {
  return path.join(root, 'stories/story-1/chapters/chapter-1/scenes/Opening.md');
}

beforeEach(() => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-b2-db-'));
  vaultDir = copyV1();
  openDb(dbDir);
});

afterEach(() => {
  closeDb();
  fs.rmSync(dbDir, { recursive: true, force: true });
  while (extraDirs.length > 0) {
    const dir = extraDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('T-B1 negatives', () => {
  it('refuses a vault-kind row aimed at a scene and leaves the row proposed', () => {
    const root = vaultDir;
    const scene = scenePath(root);
    const before = sha(scene);
    const row = suggestion({
      target_path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md',
      payload_json: JSON.stringify({ content: 'AI manuscript\n' }),
    });
    upsertSuggestion(row);
    const writeSpy = vi.spyOn(aiGuard, 'writeAiCanonical');
    const result = applyVaultWrite(row, root, new Date().toISOString());
    expect(result).toEqual({ ok: false, reason: 'manuscript_target' });
    expect(writeSpy).not.toHaveBeenCalled();
    expect(sha(scene)).toBe(before);
    expect(() => commitSuggestionWrite(row.id, result, new Date().toISOString(), 'user', crypto.randomUUID())).toThrow(SuggestionRefusedError);
    expect(getSuggestion(row.id)!.status).toBe('proposed');
    const audit = listAuditLog(row.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('refuse');
    expect(audit[0].snapshot_path).toBeNull();
    expect(refusalUserMessage('manuscript_target')).toBe("AI can't edit your manuscript. Make this change yourself.");
  });

  it('refuses unknown payload.kind including vault-content and does not write', () => {
    const scene = scenePath(vaultDir);
    const before = sha(scene);
    for (const kind of ['vault-content', 'inconsistency', 'continuity_story_change', 'story-change', 'character', 'scene_crafter_card']) {
      const row = suggestion({ payload_json: JSON.stringify({ kind, content: 'nope' }) });
      upsertSuggestion(row);
      const result = applyVaultWrite(row, vaultDir, new Date().toISOString());
      expect(result).toEqual({ ok: false, reason: 'unknown_kind' });
    }
    expect(sha(scene)).toBe(before);
    expect(refusalUserMessage('unknown_kind')).toBe("1 note suggestion couldn't be saved. It's waiting for you to review.");
  });

  it('marks unknown target_kind accepted with a refuse audit and zero writes (T-B1K)', () => {
    const hero = path.join(vaultDir, 'entities/characters/Hero.md');
    const before = sha(hero);
    for (const target_kind of ['VAULT', 'scene', '']) {
      const row = suggestion({
        target_kind: target_kind as DbSuggestion['target_kind'],
        id: `unk-${target_kind || 'empty'}`,
      });
      upsertSuggestion(row);
      const result = applyVaultWrite(row, vaultDir, new Date().toISOString());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.finalStatus).toBe('accepted');
      expect(result.refuseAudit).toBe(true);
      commitSuggestionWrite(row.id, result, new Date().toISOString(), 'user', crypto.randomUUID());
      expect(getSuggestion(row.id)!.status).toBe('accepted');
      expect(listAuditLog(row.id).some((entry) => entry.action === 'refuse')).toBe(true);
    }
    expect(sha(hero)).toBe(before);
  });

  it('refuses a typed-relation when either side points at a scene and writes nothing', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(vaultDir, 'manifest.json'), 'utf8')) as {
      entities: Array<{ id: string; path: string }>;
    };
    manifest.entities[1].path = 'stories/story-1/chapters/chapter-1/scenes/Opening.md';
    fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest));
    const hero = path.join(vaultDir, 'entities/characters/Hero.md');
    const before = sha(hero);
    const row = suggestion({
      payload_json: JSON.stringify({
        kind: 'typed-relation',
        relationType: 'knows',
        sourceEntityId: 'entity-001',
        targetEntityId: 'entity-002',
      }),
    });
    upsertSuggestion(row);
    const updateSpy = vi.spyOn(entities, 'updateEntity');
    const manifestSpy = vi.spyOn(vault, 'writeManifest');
    const result = applyVaultWrite(row, vaultDir, new Date().toISOString());
    expect(result).toEqual({ ok: false, reason: 'manuscript_target' });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(manifestSpy).not.toHaveBeenCalled();
    expect(sha(hero)).toBe(before);
    expect(listAuditLog(row.id)).toHaveLength(0);
  });

  it('returns unresolved_relation when an id is absent and takes no snapshot', () => {
    const row = suggestion({
      payload_json: JSON.stringify({
        kind: 'typed-relation',
        relationType: 'knows',
        sourceEntityId: 'missing',
        targetEntityId: 'entity-002',
      }),
    });
    const result = applyVaultWrite(row, vaultDir, new Date().toISOString());
    expect(result).toEqual({ ok: false, reason: 'unresolved_relation' });
    expect(fs.existsSync(path.join(vaultDir, '.mythos', 'suggestion-snapshots'))).toBe(false);
  });

  it('refuses rollback when the snapshot path is not the row target', () => {
    const row = suggestion();
    upsertSuggestion(row);
    const rel = path.join('.mythos', 'suggestion-snapshots', `${row.id}.json`);
    fs.mkdirSync(path.dirname(path.join(vaultDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, rel), JSON.stringify({
      originalContent: 'tampered\n',
      path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md',
    }));
    const before = sha(scenePath(vaultDir));
    expect(() => rollbackVaultWrite(row.id, vaultDir, rel)).toThrow(SuggestionRefusedError);
    expect(sha(scenePath(vaultDir))).toBe(before);
  });

  it('returns resolve_failed and the note string when the entity realpath throws (T-B1R)', () => {
    const native = fs.realpathSync.native;
    vi.spyOn(fs.realpathSync, 'native').mockImplementation((target) => {
      if (String(target).includes(`${path.sep}Hero.md`)) {
        const err = new Error('EACCES') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return native(target);
    });
    const row = suggestion();
    const result = applyVaultWrite(row, vaultDir, new Date().toISOString());
    expect(result).toEqual({ ok: false, reason: 'resolve_failed' });
    expect(refusalUserMessage('resolve_failed')).toBe("1 note suggestion couldn't be saved. It's waiting for you to review.");
  });

  it('refuses content and typed-relation writes when the manifest is unreadable, and still accepts a manuscript row (T-B1M)', () => {
    fs.writeFileSync(path.join(vaultDir, 'manifest.json'), '{', 'utf8');
    const content = suggestion();
    const relation = suggestion({
      id: 'rel-corrupt',
      payload_json: JSON.stringify({
        kind: 'typed-relation',
        relationType: 'knows',
        sourceEntityId: 'entity-001',
        targetEntityId: 'entity-002',
      }),
    });
    expect(applyVaultWrite(content, vaultDir, new Date().toISOString())).toEqual({ ok: false, reason: 'no_manifest' });
    expect(applyVaultWrite(relation, vaultDir, new Date().toISOString())).toEqual({ ok: false, reason: 'no_manifest' });
    const manuscript = suggestion({ id: 'ms', target_kind: 'manuscript', target_path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md' });
    upsertSuggestion(manuscript);
    const marked = applyVaultWrite(manuscript, vaultDir, new Date().toISOString());
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    commitSuggestionWrite(manuscript.id, marked, new Date().toISOString(), 'user', crypto.randomUUID());
    expect(getSuggestion(manuscript.id)!.status).toBe('accepted');
    expect(refusalUserMessage('no_manifest')).toContain("Couldn't read your story's index");
  });
});

describe('T-B1L NULL rows', () => {
  it('does not promote a NULL content row and status-marks continuity and scene paths', () => {
    const hero = path.join(vaultDir, 'entities/characters/Hero.md');
    const scene = scenePath(vaultDir);
    const heroBefore = sha(hero);
    const sceneBefore = sha(scene);
    const content = suggestion({
      target_kind: null,
      payload_json: JSON.stringify({ content: 'should not land\n' }),
    });
    upsertSuggestion(content);
    const contentResult = applyVaultWrite(content, vaultDir, new Date().toISOString());
    expect(contentResult.ok).toBe(true);
    if (contentResult.ok) {
      commitSuggestionWrite(content.id, contentResult, new Date().toISOString(), 'user', crypto.randomUUID());
    }
    expect(getSuggestion(content.id)!.status).toBe('accepted');
    expect(sha(hero)).toBe(heroBefore);

    const continuity = suggestion({
      id: 'null-cont',
      target_kind: null,
      target_path: null,
      payload_json: JSON.stringify({ kind: 'continuity_story_change', content: 'nope' }),
    });
    expect(applyVaultWrite(continuity, vaultDir, new Date().toISOString())).toMatchObject({
      ok: true,
      finalStatus: 'accepted',
    });

    const sceneRow = suggestion({
      id: 'null-scene',
      target_kind: null,
      target_path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md',
      payload_json: JSON.stringify({ content: 'nope' }),
    });
    expect(applyVaultWrite(sceneRow, vaultDir, new Date().toISOString())).toMatchObject({
      ok: true,
      finalStatus: 'accepted',
    });
    expect(sha(scene)).toBe(sceneBefore);
  });

  it('guards a NULL typed-relation and refuses a scene-pointing side', () => {
    const badManifest = JSON.parse(fs.readFileSync(path.join(vaultDir, 'manifest.json'), 'utf8')) as {
      entities: Array<{ path: string }>;
    };
    badManifest.entities[1].path = 'stories/story-1/chapters/chapter-1/scenes/Opening.md';
    fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(badManifest));
    const refused = suggestion({
      target_kind: null,
      payload_json: JSON.stringify({
        kind: 'typed-relation',
        relationType: 'knows',
        sourceEntityId: 'entity-001',
        targetEntityId: 'entity-002',
      }),
    });
    expect(applyVaultWrite(refused, vaultDir, new Date().toISOString())).toEqual({
      ok: false,
      reason: 'manuscript_target',
    });

    fs.cpSync(path.join(V1_FIXTURE, 'manifest.json'), path.join(vaultDir, 'manifest.json'));
    const good = suggestion({
      id: 'null-rel-good',
      target_kind: null,
      payload_json: JSON.stringify({
        kind: 'typed-relation',
        relationType: 'knows',
        sourceEntityId: 'entity-001',
        targetEntityId: 'entity-002',
      }),
    });
    const applied = applyVaultWrite(good, vaultDir, new Date().toISOString());
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.finalStatus).toBe('applied');
  });

  it('accepts a manuscript-kind typed-relation with zero writes (T-B1T)', () => {
    const before = fs.readFileSync(path.join(vaultDir, 'manifest.json'), 'utf8');
    const row = suggestion({
      target_kind: 'manuscript',
      payload_json: JSON.stringify({
        kind: 'typed-relation',
        relationType: 'knows',
        sourceEntityId: 'entity-001',
        targetEntityId: 'entity-002',
      }),
    });
    const result = applyVaultWrite(row, vaultDir, new Date().toISOString());
    expect(result).toMatchObject({ ok: true, finalStatus: 'accepted', snapshotPath: null });
    expect(fs.readFileSync(path.join(vaultDir, 'manifest.json'), 'utf8')).toBe(before);
  });
});

describe('T-B1n positives', () => {
  it('applies an entity note and a brand-new entity file, then rollback restores the snapshot', () => {
    const heroId = '4a1b0c2d-e3f4-4123-8abc-1234567890b1';
    const existing = suggestion({ id: heroId });
    upsertSuggestion(existing);
    const applied = applyVaultWrite(existing, vaultDir, new Date().toISOString());
    if (!applied.ok) throw new Error(applied.reason);
    expect(applied.finalStatus).toBe('applied');
    expect(fs.readFileSync(path.join(vaultDir, 'entities/characters/Hero.md'), 'utf8')).toContain(`New content for ${heroId}`);
    updateSuggestionStatus(existing.id, 'applied', new Date().toISOString());
    insertAuditLog({
      id: crypto.randomUUID(),
      suggestion_id: existing.id,
      action: 'apply',
      snapshot_path: applied.snapshotPath,
      actor: 'user',
      created_at: new Date().toISOString(),
    });
    const restored = rollbackVaultWrite(existing.id, vaultDir, applied.snapshotPath);
    expect(restored).toBe('entities/characters/Hero.md');
    expect(fs.readFileSync(path.join(vaultDir, 'entities/characters/Hero.md'), 'utf8')).not.toContain(`New content for ${heroId}`);

    const created = suggestion({ id: '4a1b0c2d-e3f4-4123-8abc-1234567890b2', target_path: 'entities/characters/brand-new.md' });
    const createdResult = applyVaultWrite(created, vaultDir, new Date().toISOString());
    if (!createdResult.ok) throw new Error(createdResult.reason);
    expect(fs.existsSync(path.join(vaultDir, 'entities/characters/brand-new.md'))).toBe(true);
  });

  it('writes the canonical absolute path, which differs from a symlinked vault root (M-B2h)', () => {
    const link = path.join(os.tmpdir(), `mythos-b2-link-${crypto.randomUUID()}`);
    extraDirs.push(link);
    try {
      fs.symlinkSync(vaultDir, link);
    } catch (err) {
      console.log(`symlink skipped: ${(err as Error).message}`);
      return;
    }
    const row = suggestion({ id: '4a1b0c2d-e3f4-4123-8abc-1234567890b6' });
    const guard = aiGuard.assertAiWritable(link, row.target_path!);
    if (!guard.ok) throw new Error(guard.reason);
    const spy = vi.spyOn(aiGuard, 'writeAiCanonical');
    const result = applyVaultWrite(row, link, new Date().toISOString());
    if (!result.ok) throw new Error(result.reason);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBe(guard.abs);
    expect(spy.mock.calls[0][0]).not.toBe(path.resolve(link, row.target_path!));
  });

  it('applies one row per producer shape that is allowlisted', () => {
    const relation = suggestion({
      id: 'producer-relation',
      target_path: 'entities/characters/Hero.md',
      payload_json: JSON.stringify({
        kind: 'typed-relation',
        relationType: 'knows',
        sourceEntityId: 'entity-001',
        targetEntityId: 'entity-002',
      }),
    });
    const applied = applyVaultWrite(relation, vaultDir, new Date().toISOString());
    expect(applied.ok).toBe(true);
  });
});

describe('T-B1c reject and ignore after refusal', () => {
  it('clears a refused row with reject and ignore and does not write the scene', () => {
    const scene = scenePath(vaultDir);
    const before = sha(scene);
    const rejected = suggestion({
      id: 'after-reject',
      target_path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md',
    });
    const ignored = suggestion({
      id: 'after-ignore',
      target_path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md',
    });
    upsertSuggestion(rejected);
    upsertSuggestion(ignored);
    expect(applyVaultWrite(rejected, vaultDir, new Date().toISOString()).ok).toBe(false);
    updateSuggestionStatus(rejected.id, 'rejected');
    updateSuggestionStatus(ignored.id, 'ignored');
    expect(getSuggestion(rejected.id)!.status).toBe('rejected');
    expect(getSuggestion(ignored.id)!.status).toBe('ignored');
    expect(sha(scene)).toBe(before);
  });
});

describe('batch and locks', () => {
  it('applies the allowlisted row and records the refused reason code', async () => {
    const bad = suggestion({
      id: 'batch-bad',
      target_path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md',
    });
    const good = suggestion({ id: '4a1b0c2d-e3f4-4123-8abc-1234567890b3', target_path: 'entities/characters/brand-new.md' });
    upsertSuggestion(bad);
    upsertSuggestion(good);
    const failed: Array<{ id: string; reason: string }> = [];
    const succeeded: string[] = [];
    for (const row of [bad, good].sort((a, b) => (a.target_path ?? '').localeCompare(b.target_path ?? ''))) {
      try {
        const result = await applyVaultWriteLocked(row, vaultDir, new Date().toISOString());
        commitSuggestionWrite(row.id, result, new Date().toISOString(), 'user', crypto.randomUUID());
        succeeded.push(row.id);
      } catch (err) {
        failed.push({
          id: row.id,
          reason: err instanceof SuggestionRefusedError ? err.reason : 'unknown',
        });
      }
    }
    expect(failed).toEqual([{ id: 'batch-bad', reason: 'manuscript_target' }]);
    expect(succeeded).toEqual(['4a1b0c2d-e3f4-4123-8abc-1234567890b3']);
    expect(getSuggestion('batch-bad')!.status).toBe('proposed');
    expect(getSuggestion('4a1b0c2d-e3f4-4123-8abc-1234567890b3')!.status).toBe('applied');
  });

  it('parallel accepts of one path leave one complete payload', async () => {
    const rel = 'entities/characters/Hero.md';
    const a = suggestion({ id: '4a1b0c2d-e3f4-4123-8abc-1234567890b4', payload_json: JSON.stringify({ content: 'PAYLOAD_ALPHA_COMPLETE\n' }) });
    const b = suggestion({ id: '4a1b0c2d-e3f4-4123-8abc-1234567890b5', payload_json: JSON.stringify({ content: 'PAYLOAD_BETA_COMPLETE\n' }) });
    const [first, second] = await Promise.all([
      applyVaultWriteLocked(a, vaultDir, new Date().toISOString()),
      applyVaultWriteLocked(b, vaultDir, new Date().toISOString()),
    ]);
    expect(first.ok && second.ok).toBe(true);
    const written = fs.readFileSync(path.join(vaultDir, rel), 'utf8');
    const alpha = written.includes('PAYLOAD_ALPHA_COMPLETE');
    const beta = written.includes('PAYLOAD_BETA_COMPLETE');
    expect(alpha !== beta).toBe(true);
  });
});

describe('T-B2 auto-mark', () => {
  it('marks only manuscript rows and the upsert handler does not call applyVaultWrite', () => {
    const kinds = ['vault', 'manuscript', null, 'VAULT'] as const;
    const payloads = [undefined, 'content', 'typed-relation', 'inconsistency'] as const;
    for (const target_kind of kinds) {
      for (const kind of payloads) {
        const mark = performAutoMark({ target_kind });
        expect(mark.markAccepted).toBe(target_kind === 'manuscript');
      }
    }
    const src = fs.readFileSync(MAIN_SRC, 'utf8');
    const start = src.indexOf('[IPC_CHANNELS.SUGGESTIONS_UPSERT]');
    const end = src.indexOf('[IPC_CHANNELS.SUGGESTIONS_ACCEPT]');
    const slice = src.slice(start, end);
    expect(slice).toContain('performAutoMark');
    expect(slice).not.toContain('applyVaultWrite');
    const accept = src.slice(end, src.indexOf('[IPC_CHANNELS.SUGGESTIONS_APPLY]'));
    expect(accept).toContain('ensureVaultDir');
    expect(accept).toContain('applyVaultWriteLocked');
    expect(accept).not.toContain('writeSceneFileAtomic');
  });
});

describe('W7 and W8', () => {
  it('refuses a scene note and patches a class C note (T-B1W7)', () => {
    const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-b2-w7-'));
    extraDirs.push(notes);
    const rel = path.join('Universes', 'Realm', 'Characters', 'hero.md');
    fs.mkdirSync(path.dirname(path.join(notes, rel)), { recursive: true });
    fs.writeFileSync(path.join(notes, rel), 'hair: blonde\n');
    const sceneRel = 'stories/story-1/chapters/chapter-1/scenes/Opening.md';
    const before = sha(scenePath(vaultDir));
    expect(writeGuardedContinuityNote({
      storyRoot: vaultDir,
      notesRoot: notes,
      foundRoot: vaultDir,
      relPath: sceneRel,
      nextContent: 'AI scene\n',
    })).toEqual({ ok: false, reason: 'manuscript_target' });
    expect(sha(scenePath(vaultDir))).toBe(before);
    expect(writeGuardedContinuityNote({
      storyRoot: vaultDir,
      notesRoot: notes,
      foundRoot: notes,
      relPath: rel,
      nextContent: 'hair: black\n',
    })).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(notes, rel), 'utf8')).toBe('hair: black\n');
    expect(writeGuardedContinuityNote({
      storyRoot: vaultDir,
      notesRoot: notes,
      foundRoot: notes,
      relPath: path.join('Daily Notes', 'j.md'),
      nextContent: 'nope\n',
    })).toEqual({ ok: false, reason: 'not_allowlisted' });
  });

  it('refuses W8 when the entity path is a scene and writes an allowlisted entity', () => {
    const sceneRel = 'stories/story-1/chapters/chapter-1/scenes/Opening.md';
    const before = sha(scenePath(vaultDir));
    const manifest = JSON.parse(fs.readFileSync(path.join(vaultDir, 'manifest.json'), 'utf8')) as Manifest;
    const sceneEntity = {
      ...manifest.entities[0],
      id: 'scene-entity',
      path: sceneRel,
    };
    const refused = writeGuardedArchiveEntity(vaultDir, { ...manifest, entities: [...manifest.entities, sceneEntity] }, 'scene-entity', {
      hair: 'from the scene',
    });
    expect(refused).toEqual({ ok: false, reason: 'manuscript_target' });
    expect(sha(scenePath(vaultDir))).toBe(before);

    const written = writeGuardedArchiveEntity(vaultDir, manifest, 'entity-001', { hair: 'black' });
    expect(written).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(vaultDir, 'entities/characters/Hero.md'), 'utf8')).toContain('black');
  });

  it('handlers call ensureVaultDir and the guarded writers', () => {
    const src = fs.readFileSync(MAIN_SRC, 'utf8');
    const start = src.indexOf('export async function resolveContinuityItemById');
    const fn = src.slice(start, src.indexOf('function registerArchiveContinuityHandlers'));
    expect(fn.indexOf("action === 'suggest_story_change'")).toBeLessThan(fn.indexOf('ensureVaultDir()'));
    expect(fn).toContain('writeGuardedContinuityNote');
    const archiveStart = src.indexOf('[IPC_CHANNELS.ARCHIVE_CONFIRM]');
    const archive = src.slice(archiveStart, archiveStart + 8000);
    expect(archive.indexOf("action === 'suggest_story_change'")).toBeLessThan(archive.indexOf('ensureVaultDir()'));
    expect(archive).toContain('writeGuardedArchiveEntity');
  });
});

describe('W9 removal', () => {
  it('acceptWikiLink and the editor accept path do not write a scene', () => {
    const wiki = fs.readFileSync(path.resolve(__dirname, 'wikiLinks.ts'), 'utf8');
    const acceptStart = wiki.indexOf('export function acceptWikiLink');
    const acceptEnd = wiki.indexOf('export function', acceptStart + 10);
    const accept = wiki.slice(acceptStart, acceptEnd === -1 ? wiki.length : acceptEnd);
    expect(accept).not.toContain('writeSceneFileAtomic');
    expect(accept).toContain('accepted');
    const shell = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/DesktopShell.tsx'), 'utf8');
    expect(shell).not.toContain('insertWikiLink');
    const editor = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/BlockEditor.tsx'), 'utf8');
    expect(editor).not.toContain('insertWikiLink');
  });
});

describe('T-B10 pushy-ask fixture', () => {
  it('keeps scene bytes identical for every recorded reply', () => {
    const fixture = JSON.parse(fs.readFileSync(PUSHY, 'utf8')) as {
      source: string;
      pasteReadyRegex: string;
      items: Array<{ id: string; reply: string; source: string }>;
    };
    expect(fixture.items).toHaveLength(48);
    expect(fixture.source).toBe('hand-written');
    const ready = new RegExp(fixture.pasteReadyRegex);
    expect(fixture.items.some((item) => ready.test(item.reply))).toBe(true);
    const scene = scenePath(vaultDir);
    const before = sha(scene);
    const spy = vi.spyOn(aiGuard, 'writeAiCanonical');
    const sceneRel = 'stories/story-1/chapters/chapter-1/scenes/Opening.md';
    const manifest = JSON.parse(fs.readFileSync(path.join(vaultDir, 'manifest.json'), 'utf8')) as Manifest;
    const sceneManifest: Manifest = {
      ...manifest,
      entities: manifest.entities.map((entity, index) => (
        index === 1 ? { ...entity, path: sceneRel } : entity
      )),
    };
    fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(sceneManifest));

    for (const item of fixture.items) {
      expect(performAutoMark({ target_kind: 'manuscript' }).markAccepted).toBe(true);
      expect(performAutoMark({ target_kind: 'vault' }).markAccepted).toBe(false);
      const vaultRow = suggestion({
        id: `pushy-vault-${item.id}`,
        target_path: sceneRel,
        payload_json: JSON.stringify({ content: item.reply }),
      });
      const manuscriptRow = suggestion({
        id: `pushy-ms-${item.id}`,
        target_kind: 'manuscript',
        target_path: sceneRel,
        payload_json: JSON.stringify({ content: item.reply }),
      });
      const relationRow = suggestion({
        id: `pushy-rel-${item.id}`,
        payload_json: JSON.stringify({
          kind: 'typed-relation',
          relationType: 'knows',
          sourceEntityId: 'entity-001',
          targetEntityId: 'entity-002',
        }),
      });
      expect(applyVaultWrite(vaultRow, vaultDir, new Date().toISOString())).toEqual({ ok: false, reason: 'manuscript_target' });
      expect(applyVaultWrite(manuscriptRow, vaultDir, new Date().toISOString())).toMatchObject({ ok: true, finalStatus: 'accepted' });
      expect(applyVaultWrite(relationRow, vaultDir, new Date().toISOString())).toEqual({ ok: false, reason: 'manuscript_target' });
      expect(writeGuardedContinuityNote({
        storyRoot: vaultDir,
        notesRoot: vaultDir,
        foundRoot: vaultDir,
        relPath: sceneRel,
        nextContent: item.reply,
      })).toEqual({ ok: false, reason: 'manuscript_target' });
      upsertSuggestion(suggestion({
        id: `pushy-rb-${item.id}`,
        target_path: sceneRel,
        status: 'applied',
      }));
      const snapRel = path.join('.mythos', 'suggestion-snapshots', `pushy-${item.id}.json`);
      fs.mkdirSync(path.dirname(path.join(vaultDir, snapRel)), { recursive: true });
      fs.writeFileSync(path.join(vaultDir, snapRel), JSON.stringify({ originalContent: item.reply, path: sceneRel }));
      expect(() => rollbackVaultWrite(`pushy-rb-${item.id}`, vaultDir, snapRel)).toThrow(SuggestionRefusedError);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(sha(scene)).toBe(before);
    expect(fs.readFileSync(scene, 'utf8')).not.toContain(fixture.items[0].id);
  });
});
