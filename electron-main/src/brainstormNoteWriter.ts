import fs from 'fs';
import path from 'path';
import type { FactType, NoteProposal } from './brainstormAgent.js';
import { getDb } from './db.js';

export const STORY_VAULT_GUARD_ERROR = 'STORY_VAULT_GUARD_ERROR';

type WorldKind = Extract<FactType, 'character' | 'location' | 'item' | 'faction'>;

const WORLD_KIND_DIR: Record<WorldKind, string> = {
  character: 'Characters',
  location: 'Locations',
  item: 'Items',
  faction: 'Factions',
};

export type ProposalDestinationResolution =
  | { status: 'resolved'; destinationPath: string; suggestedDestination?: string }
  | { status: 'disambiguation_needed'; context: 'universe'; options: string[] };

export interface ResolveProposalDestinationArgs {
  kind: FactType;
  title: string;
  notesVaultRoot: string;
  activeUniverse?: string | null;
  activeStory?: string | null;
}

export interface WriteNoteProposalArgs {
  proposal: NoteProposal;
  notesVaultRoot: string;
  storyVaultRoot: string;
  now?: string;
  suggestedDestination?: string;
}

function sanitizeFileName(title: string): string {
  return title.replace(/[/\\:*?"<>|]/g, '-').trim() || 'unnamed';
}

function joinPosix(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function listChildDirectories(root: string, relativeDir: string): string[] {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  return fs
    .readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function resolveUniverse(notesVaultRoot: string, activeUniverse?: string | null):
  | { status: 'resolved'; universe: string }
  | { status: 'disambiguation_needed'; options: string[] } {
  if (activeUniverse?.trim()) return { status: 'resolved', universe: activeUniverse.trim() };
  const options = listChildDirectories(notesVaultRoot, 'Universes');
  if (options.length === 1) return { status: 'resolved', universe: options[0] };
  return { status: 'disambiguation_needed', options };
}

function resolveStory(notesVaultRoot: string, activeStory?: string | null): string | null {
  if (activeStory?.trim()) return activeStory.trim();
  const options = listChildDirectories(notesVaultRoot, 'Stories');
  return options.length === 1 ? options[0] : null;
}

export function resolveProposalDestination(args: ResolveProposalDestinationArgs): ProposalDestinationResolution {
  const fileName = `${sanitizeFileName(args.title)}.md`;

  if (args.kind === 'inbox') {
    return { status: 'resolved', destinationPath: joinPosix('Inbox', fileName) };
  }

  if (args.kind === 'scene_card') {
    const story = resolveStory(args.notesVaultRoot, args.activeStory);
    if (story) {
      return { status: 'resolved', destinationPath: joinPosix('Stories', story, fileName) };
    }
    return {
      status: 'resolved',
      destinationPath: joinPosix('Inbox', fileName),
      suggestedDestination: joinPosix('Stories', '<active-story>', fileName),
    };
  }

  const universe = resolveUniverse(args.notesVaultRoot, args.activeUniverse);
  if (universe.status === 'disambiguation_needed') {
    return { status: 'disambiguation_needed', context: 'universe', options: universe.options };
  }

  return {
    status: 'resolved',
    destinationPath: joinPosix('Universes', universe.universe, WORLD_KIND_DIR[args.kind], fileName),
  };
}

function isEmptyFrontmatterValue(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

export function buildFrontmatter(
  proposal: NoteProposal,
  now = new Date().toISOString(),
  suggestedDestination?: string,
): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(proposal.frontmatter ?? {})) {
    if (!isEmptyFrontmatterValue(value)) frontmatter[key] = value;
  }
  if (suggestedDestination && !frontmatter.suggested_destination) {
    frontmatter.suggested_destination = suggestedDestination;
  }
  frontmatter.created_by = 'brainstorm_agent';
  frontmatter.created_at = now;
  frontmatter.source_turn_id = proposal.sourceConversationTurnId;
  return frontmatter;
}

function yamlScalar(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value);
  if (/^[A-Za-z0-9_./<> -]+$/.test(text) && text.trim() === text) return text;
  return JSON.stringify(text);
}

function renderYaml(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  return lines.join('\n');
}

export function renderProposalMarkdown(
  proposal: NoteProposal,
  now = new Date().toISOString(),
  suggestedDestination?: string,
): string {
  const frontmatter = buildFrontmatter(proposal, now, suggestedDestination);
  return [
    '---',
    renderYaml(frontmatter),
    '---',
    `# ${proposal.title}`,
    '',
    proposal.body,
    '',
  ].join('\n');
}

function assertWriteTarget(notesVaultRoot: string, storyVaultRoot: string, destinationPath: string): string {
  const notesRoot = path.resolve(notesVaultRoot);
  const storyRoot = path.resolve(storyVaultRoot);
  const target = path.resolve(notesRoot, destinationPath);

  if (target === storyRoot || target.startsWith(`${storyRoot}${path.sep}`)) {
    throw new Error(STORY_VAULT_GUARD_ERROR);
  }
  if (target !== notesRoot && !target.startsWith(`${notesRoot}${path.sep}`)) {
    throw new Error(`Invalid Notes Vault destination: ${destinationPath}`);
  }
  return target;
}

export function writeNoteProposal(args: WriteNoteProposalArgs): { status: 'written'; path: string } {
  const now = args.now ?? new Date().toISOString();
  const target = assertWriteTarget(args.notesVaultRoot, args.storyVaultRoot, args.proposal.destinationPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderProposalMarkdown(args.proposal, now, args.suggestedDestination), 'utf-8');
  return { status: 'written', path: args.proposal.destinationPath };
}

export function dismissPendingBrainstormProposals(now = new Date().toISOString()): { rejectedCount: number } {
  const result = getDb()
    .prepare(
      `UPDATE suggestions
          SET status = 'rejected', applied_at = ?
        WHERE source_agent = 'brainstorm'
          AND status = 'proposed'
          AND note_kind IS NOT NULL`,
    )
    .run(now) as unknown as { changes?: number };
  return { rejectedCount: result.changes ?? 0 };
}
