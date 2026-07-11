// Beta 4 M5 — MythosVault v2 scene file layout + frontmatter codec.
//
// Scene files live at `Story Vault/<Story>/Part N/Chapter NN/Scene NN.md`
// with frontmatter `{title, status, pov, when}` (FULL-SPEC §2):
//   - status: todo | draft | done
//   - pov:    POV character name (optional)
//   - when:   timeline date as a year×10 float (§8.2; optional)
// plus machine keys the reader needs for stable identity (`id`, `updatedAt`).
// Unknown frontmatter keys are preserved verbatim (lossless round-trip, CF-11).
//
// Pure Node.

import path from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from '../vault.js';

export type SceneStatus = 'todo' | 'draft' | 'done';

export const SCENE_STATUSES: readonly SceneStatus[] = ['todo', 'draft', 'done'] as const;

/** Legacy Manifest draftState ←→ v2 status mapping (deterministic, documented). */
export function draftStateToStatus(
  draftState: 'in-progress' | 'review' | 'final' | undefined,
  hasProse: boolean,
): SceneStatus {
  if (draftState === 'final') return 'done';
  if (draftState === 'in-progress' || draftState === 'review') return 'draft';
  return hasProse ? 'draft' : 'todo';
}

export function statusToDraftState(
  status: SceneStatus,
): 'in-progress' | 'final' | undefined {
  if (status === 'done') return 'final';
  if (status === 'draft') return 'in-progress';
  return undefined; // todo — legacy manifest has no equivalent state
}

// ─── Canonical directory / file naming ──────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

export function partDirName(partNumber: number): string {
  return `Part ${partNumber}`;
}

export function chapterDirName(chapterNumber: number): string {
  return `Chapter ${pad2(chapterNumber)}`;
}

export function sceneFileName(sceneNumber: number): string {
  return `Scene ${pad2(sceneNumber)}.md`;
}

/** Parse the trailing integer out of "Part 3" / "Chapter 07" / "Scene 12.md". Null when absent. */
export function parseOrdinal(name: string): number | null {
  const m = /(\d+)(?:\.md)?$/.exec(name.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function isPartDirName(name: string): boolean {
  return /^Part \d+$/.test(name);
}

export function isChapterDirName(name: string): boolean {
  return /^Chapter \d+$/.test(name);
}

export function isSceneFileName(name: string): boolean {
  return /^Scene \d+\.md$/.test(name);
}

/** POSIX-style relative path of a scene inside its story folder. */
export function sceneRelPath(part: number, chapter: number, scene: number): string {
  return `${partDirName(part)}/${chapterDirName(chapter)}/${sceneFileName(scene)}`;
}

// ─── Frontmatter codec ───────────────────────────────────────────────────────

export interface V2SceneFile {
  id: string;
  title: string;
  status: SceneStatus;
  pov?: string;
  /** Timeline date — year×10 float per FULL-SPEC §8.2. */
  when?: number;
  updatedAt?: string;
  /** Every frontmatter key this codec does not own, preserved verbatim. */
  extraFrontmatter?: Record<string, unknown>;
  prose: string;
}

/** Frontmatter keys owned by the v2 scene codec. */
const V2_SCENE_KEYS = new Set(['id', 'title', 'status', 'pov', 'when', 'updatedAt']);

export function serializeV2SceneFile(scene: V2SceneFile): string {
  const fm: Record<string, string | number | boolean | string[]> = {
    id: scene.id,
    title: scene.title,
    status: scene.status,
    ...(scene.pov ? { pov: scene.pov } : {}),
    ...(scene.when !== undefined && Number.isFinite(scene.when) ? { when: scene.when } : {}),
  };
  if (scene.extraFrontmatter) {
    for (const [k, v] of Object.entries(scene.extraFrontmatter)) {
      if (V2_SCENE_KEYS.has(k) || v === undefined || v === null || v === '') continue;
      fm[k] = v as string | number | boolean | string[];
    }
  }
  fm.updatedAt = scene.updatedAt ?? new Date().toISOString();
  return serializeFrontmatter(fm, scene.prose);
}

export function parseV2SceneFile(content: string, fallbackName = 'Untitled Scene'): V2SceneFile {
  const { frontmatter, prose } = parseFrontmatter(content);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!V2_SCENE_KEYS.has(k)) extra[k] = v;
  }
  const statusRaw = typeof frontmatter.status === 'string' ? frontmatter.status : '';
  const status: SceneStatus = (SCENE_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as SceneStatus)
    : prose.trim().length > 0
      ? 'draft'
      : 'todo';
  const whenRaw = frontmatter.when;
  const when =
    typeof whenRaw === 'number' && Number.isFinite(whenRaw)
      ? whenRaw
      : undefined;
  return {
    id: typeof frontmatter.id === 'string' && frontmatter.id ? frontmatter.id : '',
    title:
      typeof frontmatter.title === 'string' && frontmatter.title
        ? frontmatter.title
        : path.basename(fallbackName, '.md'),
    status,
    ...(typeof frontmatter.pov === 'string' && frontmatter.pov ? { pov: frontmatter.pov } : {}),
    ...(when !== undefined ? { when } : {}),
    ...(typeof frontmatter.updatedAt === 'string' && frontmatter.updatedAt
      ? { updatedAt: frontmatter.updatedAt }
      : {}),
    ...(Object.keys(extra).length > 0 ? { extraFrontmatter: extra } : {}),
    prose,
  };
}

// ─── Story folder naming ─────────────────────────────────────────────────────

/**
 * Human-readable, filesystem-safe story folder name. Unlike toSlug this keeps
 * capitalization and spaces ("The Last City of Veynn"), because the folder IS
 * the user-facing story name in Finder/Obsidian. Windows-illegal characters
 * and path separators are stripped; empty results fall back to "Untitled Story".
 */
export function storyFolderName(title: string): string {
  const cleaned = title
    .replace(/[\\/<>:"|?*\0]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows: no trailing dots or spaces on directory names.
    .replace(/[. ]+$/g, '');
  return cleaned || 'Untitled Story';
}
