// #1765 — import hub IPC handlers: frame check, pick → preview → commit
// pipeline, token single-use, source-changed guard, no path leaks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';

type Handler = (...args: unknown[]) => unknown;
const handleMap = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => { handleMap.set(channel, fn); },
  },
}));

vi.mock('./htmlBlocks.js', () => ({ isGoogleDocsHtml: () => false }));

import { IPC_CHANNELS, UNTRUSTED_FRAME_REJECTION } from '../ipc.js';
import type { Manifest } from '../ipc.js';
import { defaultManifest, readManifest, writeManifest as writeManifestRaw } from '../vault.js';
import {
  IMPORT_NO_VAULT_REASON,
  IMPORT_SOURCE_CHANGED_ERROR,
  IMPORT_TOKEN_EXPIRED_ERROR,
  previewImportPath,
  registerImportHubIpc,
  type ImportHubDeps,
} from './importHubIpc.js';
import { _clearImportSessionsForTest } from './importPreview.js';
import type { ImportPlan, ImportPreviewResult } from './types.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'import-hub-ipc-')));
  handleMap.clear();
  _clearImportSessionsForTest();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function topEvent(): IpcMainInvokeEvent {
  const top: { top: unknown } = { top: null };
  top.top = top;
  return { senderFrame: top } as unknown as IpcMainInvokeEvent;
}

function nestedEvent(): IpcMainInvokeEvent {
  const top: { top: unknown } = { top: null };
  top.top = top;
  return { senderFrame: { top } } as unknown as IpcMainInvokeEvent;
}

function nullFrameEvent(): IpcMainInvokeEvent {
  return { senderFrame: null } as unknown as IpcMainInvokeEvent;
}

function planFor(name: string): ImportPlan {
  return {
    source: { kind: 'markdown', name },
    story: {
      title: 'Imported Tale',
      partCount: 0,
      structure: 'headings',
      chapters: [{ title: 'One', order: 0, scenes: [{ title: 'Opening', order: 0, prose: 'Once upon a time.' }] }],
    },
    notes: [],
    warnings: [`Read ${path.join(tmp, 'deep', 'secret', 'file.md')} fine`],
  };
}

interface Harness {
  deps: ImportHubDeps;
  vaultRoot: string;
  manifestPath: string;
}

function harness(opts: { vault?: boolean } = {}): Harness {
  const vaultRoot = path.join(tmp, 'Vault');
  const manifestPath = path.join(vaultRoot, 'manifest.json');
  if (opts.vault !== false) {
    fs.mkdirSync(vaultRoot, { recursive: true });
    writeManifestRaw(manifestPath, defaultManifest(vaultRoot));
  }
  const notesRoot = path.join(tmp, 'Notes');
  fs.mkdirSync(notesRoot, { recursive: true });
  const deps: ImportHubDeps = {
    getStoryVaultRoot: () => (opts.vault === false ? null : vaultRoot),
    isV2StoryVault: () => false,
    getManifestPath: () => manifestPath,
    readManifest: (p) => readManifest(p),
    writeManifest: (p: string, m: Manifest) => {
      writeManifestRaw(p, m);
    },
    getNotesVaultRoot: () => notesRoot,
    ensureNotesVaultDir: () => {},
    notifyNotesWritten: vi.fn(),
    notifyStoriesChanged: vi.fn(),
    flushRenderer: vi.fn(async () => {}),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    defaultImportDir: () => '/home/writer/Documents',
    rememberImportDir: vi.fn(),
    buildPlan: vi.fn(async (_realPath: string, _kind, assessed) => planFor(assessed.name)),
  };
  return { deps, vaultRoot, manifestPath };
}

function source(name = 'Tale.md', body = '# One\n\nOnce upon a time.'): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body);
  return p;
}

describe('registerImportHubIpc — frame checks', () => {
  it('registers pick/preview/commit and rejects nested or frameless senders without touching deps', async () => {
    const { deps } = harness();
    registerImportHubIpc(deps);
    const channels = [IPC_CHANNELS.IMPORT_PICK, IPC_CHANNELS.IMPORT_PREVIEW, IPC_CHANNELS.IMPORT_COMMIT];
    expect(channels).toEqual(['import:pick', 'import:preview', 'import:commit']);
    for (const ch of channels) {
      const fn = handleMap.get(ch);
      expect(fn, ch).toBeTypeOf('function');
      expect(await fn!(nestedEvent(), { mode: 'file', path: source(), token: 'x' })).toBe(UNTRUSTED_FRAME_REJECTION);
      expect(await fn!(nullFrameEvent(), { mode: 'file', path: source(), token: 'x' })).toBe(UNTRUSTED_FRAME_REJECTION);
    }
    expect(deps.showOpenDialog).not.toHaveBeenCalled();
    expect(deps.buildPlan).not.toHaveBeenCalled();
    expect(deps.flushRenderer).not.toHaveBeenCalled();
  });
});

describe('import:preview', () => {
  it('runs assess → detect → buildPlan and returns a path-free preview', async () => {
    const { deps } = harness();
    registerImportHubIpc(deps);
    const p = source();
    const r = (await handleMap.get(IPC_CHANNELS.IMPORT_PREVIEW)!(topEvent(), { path: p })) as ImportPreviewResult;
    expect(r.ok).toBe(true);
    if (!r.ok || !('preview' in r)) return;
    expect(deps.buildPlan).toHaveBeenCalledWith(p, 'markdown', expect.objectContaining({ name: 'Tale.md', ok: true }));
    expect(r.preview.source).toEqual({ kind: 'markdown', label: 'Markdown file', name: 'Tale.md' });
    expect(r.preview.canCommit).toBe(true);
    expect(JSON.stringify(r)).not.toContain(tmp);
    expect(r.preview.warnings).toEqual(['Read file.md fine']);
  });

  it('refuses a dangerous file without calling the importer', async () => {
    const { deps } = harness();
    const r = await previewImportPath(source('Chapter 1.docx.exe', 'x'), deps);
    expect(r).toMatchObject({ ok: false, refused: true, name: 'Chapter 1.docx.exe' });
    expect(deps.buildPlan).not.toHaveBeenCalled();
  });

  it('reports an unsupported file as an error, not a refusal', async () => {
    const { deps } = harness();
    const r = await previewImportPath(source('notes.xyz', 'x'), deps);
    expect(r).toMatchObject({ ok: false, refused: false, name: 'notes.xyz' });
  });

  it('hides importer exceptions (no stack, no path)', async () => {
    const { deps } = harness();
    deps.buildPlan = vi.fn(async () => {
      throw new Error(`ENOENT: no such file ${tmp}/x\n    at Object.openSync (node:fs:1)`);
    });
    const r = await previewImportPath(source(), deps);
    expect(r.ok).toBe(false);
    const text = JSON.stringify(r);
    expect(text).not.toContain(tmp);
    expect(text).not.toMatch(/ENOENT|openSync|at Object/);
  });

  it('marks the preview not committable when no vault is open', async () => {
    const { deps } = harness({ vault: false });
    const r = await previewImportPath(source(), deps);
    expect(r.ok).toBe(true);
    if (r.ok && 'preview' in r) {
      expect(r.preview.canCommit).toBe(false);
      expect(r.preview.commitBlockedReason).toBe(IMPORT_NO_VAULT_REASON);
    }
  });
});

describe('import:commit', () => {
  async function previewToken(deps: ImportHubDeps, p: string): Promise<string> {
    const r = await previewImportPath(p, deps);
    if (!r.ok || !('preview' in r)) throw new Error('preview failed');
    return r.preview.token;
  }

  it('commits the cached plan once; the token is single-use', async () => {
    const { deps, manifestPath } = harness();
    registerImportHubIpc(deps);
    const token = await previewToken(deps, source());
    const commit = handleMap.get(IPC_CHANNELS.IMPORT_COMMIT)!;
    const r = await commit(topEvent(), { token, options: { story: true, notes: 'yes' } });
    expect(r).toMatchObject({ ok: true, storyTitle: 'Imported Tale', chapterCount: 1, sceneCount: 1 });
    expect(readManifest(manifestPath).stories).toHaveLength(1);
    expect(deps.flushRenderer).toHaveBeenCalledTimes(1);
    expect(await commit(topEvent(), { token })).toEqual({ ok: false, error: IMPORT_TOKEN_EXPIRED_ERROR });
    expect(readManifest(manifestPath).stories).toHaveLength(1);
  });

  it('refuses when the source changed since the preview', async () => {
    const { deps, manifestPath } = harness();
    registerImportHubIpc(deps);
    const p = source();
    const token = await previewToken(deps, p);
    fs.writeFileSync(p, '# One\n\nOnce upon a time — and then much more text was added.');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(p, future, future);
    const r = await handleMap.get(IPC_CHANNELS.IMPORT_COMMIT)!(topEvent(), { token });
    expect(r).toEqual({ ok: false, error: IMPORT_SOURCE_CHANGED_ERROR });
    expect(readManifest(manifestPath).stories).toHaveLength(0);
    expect(deps.flushRenderer).not.toHaveBeenCalled();
  });

  it('rejects junk tokens', async () => {
    const { deps } = harness();
    registerImportHubIpc(deps);
    const commit = handleMap.get(IPC_CHANNELS.IMPORT_COMMIT)!;
    for (const token of [undefined, 42, '', 'x'.repeat(1000), 'not-a-real-token']) {
      expect(await commit(topEvent(), { token })).toEqual({ ok: false, error: IMPORT_TOKEN_EXPIRED_ERROR });
    }
  });
});

describe('import:pick', () => {
  it('opens a file dialog with the supported filters, and reports cancel', async () => {
    const { deps } = harness();
    registerImportHubIpc(deps);
    const r = await handleMap.get(IPC_CHANNELS.IMPORT_PICK)!(topEvent(), { mode: 'file' });
    expect(r).toEqual({ ok: false, cancelled: true });
    const opts = (deps.showOpenDialog as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts.properties).toEqual(['openFile']);
    expect(opts.defaultPath).toBe('/home/writer/Documents');
    expect(opts.filters[0].extensions).toEqual(expect.arrayContaining(['docx', 'md', 'epub', 'scrivx', 'rtf', 'txt', 'html']));
    expect(opts.filters[1]).toEqual({ name: 'All files', extensions: ['*'] });
    expect(deps.rememberImportDir).toHaveBeenCalledWith({ canceled: true, filePaths: [] });
  });

  it('opens a folder dialog and previews the picked folder', async () => {
    const { deps } = harness();
    const folder = path.join(tmp, 'My Notes');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'Mira.md'), '# Mira');
    deps.showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [folder] }));
    registerImportHubIpc(deps);
    const r = (await handleMap.get(IPC_CHANNELS.IMPORT_PICK)!(topEvent(), { mode: 'folder' })) as ImportPreviewResult;
    expect((deps.showOpenDialog as ReturnType<typeof vi.fn>).mock.calls[0][0].properties).toEqual(['openDirectory']);
    expect(deps.buildPlan).toHaveBeenCalledWith(folder, 'markdown-folder', expect.anything());
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown mode without opening a dialog', async () => {
    const { deps } = harness();
    registerImportHubIpc(deps);
    const r = await handleMap.get(IPC_CHANNELS.IMPORT_PICK)!(topEvent(), { mode: 'anything' });
    expect(r).toMatchObject({ ok: false, refused: false });
    expect(deps.showOpenDialog).not.toHaveBeenCalled();
  });
});
