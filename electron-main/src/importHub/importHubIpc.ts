// #1765 — Import hub IPC: import:pick / import:preview / import:commit.
//
// pick/preview: path → importSafety (deny-list + sniff) → detect → the
// injected buildPlan → cached plan + path-free preview behind a single-use
// token. commit: token → cached plan → re-stat the source (it must not have
// changed since the preview) → commitImportPlan. The renderer never names a
// path at commit time, and errors carry at most the source's basename.

import fs from 'node:fs';
import { ipcMain, type OpenDialogOptions } from 'electron';
import { IPC_CHANNELS, isFromTopFrame, UNTRUSTED_FRAME_REJECTION } from '../ipc.js';
import { wrapIpcHandler } from '../ipcErrors.js';
import type {
  ImportCommitOptions,
  ImportCommitResult,
  ImportPlan,
  ImportPreviewResult,
  ImportSourceKind,
} from './types.js';
import { assessImportPath, SUPPORTED_IMPORT_EXTENSIONS, type AssessedImportPath } from './importSafety.js';
import { detectImportSource } from './importDetect.js';
import {
  claimImportSession,
  createImportSession,
  finishImportSession,
  releaseImportSession,
  scrubAbsolutePaths,
} from './importPreview.js';
import { commitImportPlan, type ImportCommitDeps } from './importCommit.js';
import { ImportUserError } from './importErrors.js';

export interface ImportHubDeps extends ImportCommitDeps {
  showOpenDialog(opts: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
  defaultImportDir?(): string | undefined;
  rememberImportDir?(picked: { canceled: boolean; filePaths: string[] }): void;
  /** Injected by the integrator: dispatches to the importer for `kind`. */
  buildPlan(realPath: string, kind: ImportSourceKind, assessed: AssessedImportPath): Promise<ImportPlan>;
}

export interface ImportPickPayload {
  mode?: unknown;
}

export interface ImportPreviewPayload {
  path?: unknown;
}

export interface ImportCommitPayload {
  token?: unknown;
  options?: unknown;
}

export const IMPORT_NO_VAULT_REASON =
  'Open or create a Mythos vault first (Settings → Vault & Files → New vault…).';
export const IMPORT_SOURCE_CHANGED_ERROR = 'The file changed since the preview — drop it again.';
export const IMPORT_TOKEN_EXPIRED_ERROR = 'This preview has expired — drop the file again.';
export const IMPORT_ALREADY_RUNNING_ERROR = 'This import is already running.';

type VaultProbeDeps = Pick<ImportCommitDeps, 'getStoryVaultRoot' | 'isV2StoryVault' | 'getManifestPath'>;

function canCommitNow(deps: VaultProbeDeps): { canCommit: boolean; commitBlockedReason?: string } {
  try {
    const root = deps.getStoryVaultRoot();
    if (root && fs.existsSync(root)) {
      if (deps.isV2StoryVault(root) || fs.existsSync(deps.getManifestPath())) return { canCommit: true };
    }
  } catch {
    /* fall through to blocked */
  }
  return { canCommit: false, commitBlockedReason: IMPORT_NO_VAULT_REASON };
}

/**
 * The full preview pipeline for one path. Pure apart from fs + the injected
 * deps, so it is unit-testable without Electron.
 */
export async function previewImportPath(
  inputPath: unknown,
  deps: Pick<ImportHubDeps, 'buildPlan'> & VaultProbeDeps,
): Promise<ImportPreviewResult> {
  const assessed = assessImportPath(inputPath);
  if (!assessed.ok) {
    const name = assessed.name ? { name: assessed.name } : {};
    return assessed.refused
      ? { ok: false, refused: true, reason: assessed.reason, ...name }
      : { ok: false, refused: false, error: assessed.reason, ...name };
  }
  const detected = detectImportSource(assessed);
  if (!detected.ok) return { ok: false, refused: false, error: detected.error, name: assessed.name };

  let plan: ImportPlan;
  try {
    plan = await deps.buildPlan(assessed.realPath, detected.kind, assessed);
  } catch (err) {
    return {
      ok: false,
      refused: false,
      // Importers phrase known failures for the writer (ImportUserError);
      // anything else is unexpected and never leaks its message or a path.
      error: err instanceof ImportUserError
        ? scrubAbsolutePaths(err.userMessage)
        : 'Mythos couldn\'t read this file — it may be damaged or saved in a way Mythos doesn\'t understand yet.',
      name: assessed.name,
    };
  }
  // The plan carries only the basename, whatever the importer put there.
  const safePlan: ImportPlan = {
    ...plan,
    source: { kind: detected.kind, name: assessed.name },
    warnings: (plan.warnings ?? []).map((w) => scrubAbsolutePaths(String(w))),
  };
  const preview = createImportSession(
    safePlan,
    { realPath: assessed.realPath, size: assessed.size, mtimeMs: assessed.mtimeMs },
    canCommitNow(deps),
  );
  return { ok: true, preview };
}

function parseCommitOptions(raw: unknown): ImportCommitOptions {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    ...(typeof o.story === 'boolean' ? { story: o.story } : {}),
    ...(typeof o.notes === 'boolean' ? { notes: o.notes } : {}),
  };
}

/**
 * Commit the plan behind `token`. Pure apart from fs + deps (unit-testable).
 *
 * The token is spent only by a successful commit (or one a retry can't fix:
 * the source changed, or the writer threw part-way). commitImportPlan's
 * ok:false results all return before writing or roll back what they wrote,
 * so those keep the preview alive and the writer's "Try again" works.
 */
export async function commitImportToken(
  token: unknown,
  rawOptions: unknown,
  deps: ImportCommitDeps,
): Promise<ImportCommitResult> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    return { ok: false, error: IMPORT_TOKEN_EXPIRED_ERROR };
  }
  const claim = claimImportSession(token);
  if (claim.status === 'busy') return { ok: false, error: IMPORT_ALREADY_RUNNING_ERROR };
  if (claim.status === 'missing') return { ok: false, error: IMPORT_TOKEN_EXPIRED_ERROR };
  let sourceUnchanged = false;
  try {
    const st = fs.statSync(claim.source.realPath);
    sourceUnchanged = st.size === claim.source.size && st.mtimeMs === claim.source.mtimeMs;
  } catch {
    sourceUnchanged = false;
  }
  if (!sourceUnchanged) {
    finishImportSession(token);
    return { ok: false, error: IMPORT_SOURCE_CHANGED_ERROR };
  }
  let result: ImportCommitResult;
  try {
    result = await commitImportPlan(claim.plan, deps, parseCommitOptions(rawOptions));
  } catch {
    // Unexpected: something may already be on disk, so a retry could duplicate it.
    finishImportSession(token);
    return { ok: false, error: 'Mythos couldn\'t finish the import. Check your vault before importing again.' };
  }
  if (result.ok) finishImportSession(token);
  else releaseImportSession(token);
  return result;
}

export function registerImportHubIpc(deps: ImportHubDeps): void {
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PICK,
    wrapIpcHandler(IPC_CHANNELS.IMPORT_PICK, async (event, payload: ImportPickPayload) => {
      if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
      const mode = payload?.mode;
      if (mode !== 'file' && mode !== 'folder') {
        return { ok: false, refused: false, error: 'Choose a file or a folder to import.' } satisfies ImportPreviewResult;
      }
      const defaultPath = deps.defaultImportDir?.();
      const picked = await deps.showOpenDialog({
        title: mode === 'file' ? 'Import a story or notes' : 'Import a folder',
        ...(defaultPath ? { defaultPath } : {}),
        ...(mode === 'file'
          ? {
              filters: [
                { name: 'Stories and notes', extensions: [...SUPPORTED_IMPORT_EXTENSIONS] },
                { name: 'All files', extensions: ['*'] },
              ],
              properties: ['openFile'],
            }
          : { properties: ['openDirectory'] }),
      });
      deps.rememberImportDir?.(picked);
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: false, cancelled: true } satisfies ImportPreviewResult;
      }
      return previewImportPath(picked.filePaths[0], deps);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PREVIEW,
    wrapIpcHandler(IPC_CHANNELS.IMPORT_PREVIEW, async (event, payload: ImportPreviewPayload) => {
      if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
      return previewImportPath(payload?.path, deps);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_COMMIT,
    wrapIpcHandler(IPC_CHANNELS.IMPORT_COMMIT, async (event, payload: ImportCommitPayload) => {
      if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
      return commitImportToken(payload?.token, payload?.options, deps);
    }),
  );
}
