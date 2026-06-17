// Scene Crafter board — Obsidian Kanban-compatible markdown parser + serializer.
// Format spec: plans/SCENE_CRAFTER_FORMAT.md
import { parseFrontmatter, serializeFrontmatter } from './vault.js';

// ─── Types ───

export interface BoardCard {
  wikilink: string;   // vault-relative path, no .md
  title: string;      // display title after the | in [[path|title]]
  done: boolean;
  tags: string[];     // tag names without leading #
  raw: string;        // original line (preserved for round-trip)
}

export interface BoardLane {
  name: string;
  cards: BoardCard[];
}

export interface SceneCrafterBoard {
  storyId: string;
  lastModified: string;
  lanes: BoardLane[];
  /** Any extra frontmatter keys the parser doesn't recognise. */
  extraFrontmatter: Record<string, unknown>;
  /** Preserved kanban:settings block content (between %% markers). */
  kanbanSettings: string;
}

// ─── Regex constants ───

const LANE_RE = /^## (.+)$/;
// Title group is optional to support bare [[path]] wikilinks (no |alias).
const CARD_RE = /^- \[([ x])\] \[\[([^\]|]+)(?:\|([^\]]+))?\]\](.*)/;
const TAG_RE = /#([\w/-]+)/g;
const SETTINGS_BLOCK_RE = /^%%\s*kanban:settings\n([\s\S]*?)\n%%\s*$/m;

// ─── Parser ───

export function parseBoardMarkdown(src: string): SceneCrafterBoard {
  src = src.replace(/\r\n?/g, '\n');

  let kanbanSettings = '{"kanban-plugin":"board"}';
  const settingsMatch = SETTINGS_BLOCK_RE.exec(src);
  if (settingsMatch) {
    kanbanSettings = settingsMatch[1].trim();
    src = src.slice(0, settingsMatch.index).trimEnd();
  }

  const { frontmatter: fm, prose } = parseFrontmatter(src);

  const storyId = (fm['story-id'] as string) ?? '';
  const lastModified = (fm['last-modified'] as string) ?? new Date().toISOString();
  // Pre-v1 migration guard: absent or 0 mythos-board-version is treated as v1.
  // The serializer unconditionally writes mythos-board-version: 1, so any pre-v1
  // board is upcasted on the next write with no extra state required.
  const extraFrontmatter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (k !== 'kanban-plugin' && k !== 'mythos-board-version' && k !== 'story-id' && k !== 'last-modified') {
      extraFrontmatter[k] = v;
    }
  }

  const lanes: BoardLane[] = [];
  let current: BoardLane | null = null;

  for (const line of prose.split('\n')) {
    const laneMatch = LANE_RE.exec(line);
    if (laneMatch) {
      current = { name: laneMatch[1], cards: [] };
      lanes.push(current);
      continue;
    }

    const cardMatch = CARD_RE.exec(line);
    if (cardMatch && current) {
      const [, checkbox, wikilink, rawTitle, rest] = cardMatch;
      const title = rawTitle ?? (wikilink.split('/').pop() ?? wikilink);
      const tags: string[] = [];
      let m: RegExpExecArray | null;
      TAG_RE.lastIndex = 0;
      while ((m = TAG_RE.exec(rest)) !== null) tags.push(m[1]);
      current.cards.push({ wikilink, title, done: checkbox === 'x', tags, raw: line });
    }
  }

  return { storyId, lastModified, lanes, extraFrontmatter, kanbanSettings };
}

// ─── Serializer ───

export function serializeBoardMarkdown(board: SceneCrafterBoard): string {
  const fm: Record<string, unknown> = {
    'kanban-plugin': 'board',
    'mythos-board-version': 1,
    'story-id': board.storyId,
    'last-modified': board.lastModified,
    ...board.extraFrontmatter,
  };

  const laneBlocks = board.lanes.map(lane => {
    const header = `## ${lane.name}`;
    const cards = lane.cards.map(card => {
      if (card.raw) return card.raw;
      const cb = card.done ? 'x' : ' ';
      const tags = card.tags.length ? ' ' + card.tags.map(t => `#${t}`).join(' ') : '';
      return `- [${cb}] [[${card.wikilink}|${card.title}]]${tags}`;
    });
    // Blank line between heading and cards (Obsidian Kanban convention).
    return cards.length ? `${header}\n\n${cards.join('\n')}` : header;
  });

  const settingsBlock = `%% kanban:settings\n${board.kanbanSettings}\n%%`;
  // Leading \n gives the blank line between frontmatter closing --- and first lane.
  const prose = '\n' + laneBlocks.join('\n\n') + '\n\n' + settingsBlock + '\n';

  return serializeFrontmatter(fm, prose);
}

// ─── Factory ───

export function createBoard(storyId: string): SceneCrafterBoard {
  const DEFAULT_LANES = ['Idea', 'Outline', 'Draft', 'Revision', 'Done'];
  return {
    storyId,
    lastModified: new Date().toISOString(),
    lanes: DEFAULT_LANES.map(name => ({ name, cards: [] })),
    extraFrontmatter: {},
    kanbanSettings: '{"kanban-plugin":"board"}',
  };
}

export function boardRelPath(storySlug: string): string {
  return `scenes/${storySlug}/board.md`;
}
