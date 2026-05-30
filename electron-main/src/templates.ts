// Project Templates — bundled and user-saved vault structure presets.
// No Electron dependency; fully testable in Node.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TemplateNode {
  name: string;
  children?: TemplateNode[];
  /** Filename stem for a starter .md note created in this folder */
  starterNote?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  /** Story Vault folder tree */
  story: TemplateNode[];
  /** Notes Vault folder tree */
  notes: TemplateNode[];
  isUserTemplate?: boolean;
  savedAt?: string;
}

// ─── Bundled templates ───────────────────────────────────────────────────────

const NOVEL_3ACT: TemplateDefinition = {
  id: 'bundled:novel-3act',
  name: 'Novel (3-Act)',
  description:
    'Three-act structure for a full-length novel. Story Vault has per-act chapter folders; Notes Vault covers characters, locations, themes, and research.',
  story: [
    {
      name: 'Manuscript',
      children: [
        {
          name: 'Act 1 — Setup',
          children: [{ name: 'Chapter 1', starterNote: 'Scene 1 — Opening Hook' }],
        },
        {
          name: 'Act 2 — Confrontation',
          children: [{ name: 'Chapter 4', starterNote: 'Scene 1 — Rising Action' }],
        },
        {
          name: 'Act 3 — Resolution',
          children: [{ name: 'Chapter 8', starterNote: 'Scene 1 — Climax' }],
        },
      ],
    },
    {
      name: 'Planning',
      children: [
        { name: 'Outline', starterNote: 'Story Outline' },
        { name: 'Research', starterNote: 'Research Notes' },
      ],
    },
  ],
  notes: [
    { name: 'Characters', starterNote: 'Protagonist' },
    { name: 'Locations', starterNote: 'Key Setting' },
    { name: 'Themes', starterNote: 'Core Theme' },
    { name: 'Research', starterNote: 'Background Research' },
    { name: 'Inbox' },
  ],
};

const SHORT_STORY: TemplateDefinition = {
  id: 'bundled:short-story',
  name: 'Short Story',
  description:
    'Minimal setup for a single short story. Story Vault has one manuscript folder; Notes Vault has characters and settings sections.',
  story: [
    {
      name: 'Manuscript',
      children: [{ name: 'My Short Story', starterNote: 'Opening Scene' }],
    },
    {
      name: 'Planning',
      children: [{ name: 'Notes', starterNote: 'Story Notes' }],
    },
  ],
  notes: [
    { name: 'Characters', starterNote: 'Main Character' },
    { name: 'Settings', starterNote: 'Primary Setting' },
    { name: 'Inbox' },
  ],
};

const WORLDBUILDING_BIBLE: TemplateDefinition = {
  id: 'bundled:worldbuilding-bible',
  name: 'World-building Bible',
  description:
    'Deep world-building foundation. Notes Vault is organized into geography, politics, magic systems, cultures, history, and technology.',
  story: [
    {
      name: 'Manuscript',
      children: [{ name: 'Draft', starterNote: 'Opening Chapter' }],
    },
  ],
  notes: [
    { name: 'World Overview', starterNote: 'World Overview' },
    {
      name: 'Geography',
      children: [
        { name: 'Regions', starterNote: 'Major Regions' },
        { name: 'Cities', starterNote: 'Major Cities' },
        { name: 'Landmarks', starterNote: 'Notable Landmarks' },
      ],
    },
    {
      name: 'Politics & Power',
      children: [
        { name: 'Factions', starterNote: 'Major Factions' },
        { name: 'Governments', starterNote: 'Political Systems' },
        { name: 'Conflicts', starterNote: 'Current Conflicts' },
      ],
    },
    {
      name: 'Magic & Systems',
      children: [
        { name: 'Magic System', starterNote: 'Magic System Overview' },
        { name: 'Technology', starterNote: 'Technology Level' },
      ],
    },
    {
      name: 'Cultures & Peoples',
      children: [
        { name: 'Races', starterNote: 'Races & Species' },
        { name: 'Religions', starterNote: 'Belief Systems' },
        { name: 'Customs', starterNote: 'Social Customs' },
      ],
    },
    { name: 'History', starterNote: 'Timeline of Major Events' },
    { name: 'Characters', starterNote: 'Key Characters' },
    { name: 'Inbox' },
  ],
};

const SERIES_BIBLE: TemplateDefinition = {
  id: 'bundled:series-bible',
  name: 'Series Bible',
  description:
    'Multi-book series planning. Story Vault has per-book chapter folders; Notes Vault has series-level overview, world, character, and timeline sections.',
  story: [
    {
      name: 'Manuscript',
      children: [
        {
          name: 'Book 1',
          children: [{ name: 'Chapter 1', starterNote: 'Opening Scene' }],
        },
        {
          name: 'Book 2',
          children: [{ name: 'Chapter 1', starterNote: 'Opening Scene' }],
        },
        {
          name: 'Book 3',
          children: [{ name: 'Chapter 1', starterNote: 'Opening Scene' }],
        },
      ],
    },
    {
      name: 'Planning',
      children: [
        { name: 'Series Arc', starterNote: 'Series Overview' },
        { name: 'Book Synopses', starterNote: 'Book Summaries' },
      ],
    },
  ],
  notes: [
    { name: 'Series Overview', starterNote: 'Series Pitch & Vision' },
    {
      name: 'Books',
      children: [
        { name: 'Book 1', starterNote: 'Book 1 Notes' },
        { name: 'Book 2', starterNote: 'Book 2 Notes' },
        { name: 'Book 3', starterNote: 'Book 3 Notes' },
      ],
    },
    {
      name: 'Characters',
      children: [
        { name: 'Protagonists', starterNote: 'Main Characters' },
        { name: 'Antagonists', starterNote: 'Villains & Rivals' },
        { name: 'Supporting', starterNote: 'Supporting Cast' },
      ],
    },
    { name: 'World', starterNote: 'World Overview' },
    { name: 'Timeline', starterNote: 'Series Timeline' },
    { name: 'Inbox' },
  ],
};

export const BUNDLED_TEMPLATES: TemplateDefinition[] = [
  NOVEL_3ACT,
  SHORT_STORY,
  WORLDBUILDING_BIBLE,
  SERIES_BIBLE,
];

// ─── User templates ───────────────────────────────────────────────────────────

export function userTemplatesDir(appDataPath: string): string {
  return path.join(appDataPath, 'templates');
}

export function loadUserTemplates(appDataPath: string): TemplateDefinition[] {
  const dir = userTemplatesDir(appDataPath);
  if (!fs.existsSync(dir)) return [];
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const results: TemplateDefinition[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
      const parsed = JSON.parse(raw) as TemplateDefinition;
      results.push({ ...parsed, isUserTemplate: true });
    } catch {
      // Skip malformed files
    }
  }
  return results;
}

export function listTemplates(appDataPath: string): TemplateDefinition[] {
  return [...BUNDLED_TEMPLATES, ...loadUserTemplates(appDataPath)];
}

// ─── Scaffolding ─────────────────────────────────────────────────────────────

function starterNoteContent(folderName: string, noteName: string): string {
  return [
    '---',
    `title: "${noteName}"`,
    `folder: "${folderName}"`,
    '---',
    '',
    `# ${noteName}`,
    '',
    '',
  ].join('\n');
}

export function scaffoldNodes(root: string, nodes: TemplateNode[]): void {
  for (const node of nodes) {
    const dirPath = path.join(root, node.name);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    if (node.starterNote) {
      const notePath = path.join(dirPath, `${node.starterNote}.md`);
      if (!fs.existsSync(notePath)) {
        fs.writeFileSync(notePath, starterNoteContent(node.name, node.starterNote), 'utf-8');
      }
    }
    if (node.children && node.children.length > 0) {
      scaffoldNodes(dirPath, node.children);
    }
  }
}

/**
 * Create a new vault pair from a template. Both roots are created (recursive)
 * and the template's folder tree + starter notes are written into each.
 * Existing files are never overwritten — idempotent for re-runs.
 */
export function scaffoldFromTemplate(
  storyVaultRoot: string,
  notesVaultRoot: string,
  template: TemplateDefinition,
): void {
  fs.mkdirSync(storyVaultRoot, { recursive: true });
  fs.mkdirSync(notesVaultRoot, { recursive: true });
  scaffoldNodes(storyVaultRoot, template.story);
  scaffoldNodes(notesVaultRoot, template.notes);
}

// ─── Save as template ─────────────────────────────────────────────────────────

function buildTree(dirPath: string): TemplateNode[] {
  const nodes: TemplateNode[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return nodes;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      const children = buildTree(path.join(dirPath, entry.name));
      nodes.push({
        name: entry.name,
        children: children.length > 0 ? children : undefined,
      });
    }
  }
  return nodes;
}

/**
 * Snapshot the current Story Vault + Notes Vault directory structure (no content)
 * as a user template and persist it as a JSON file under appDataPath/templates/.
 * Returns the generated template id.
 */
export function saveAsTemplate(
  storyVaultRoot: string,
  notesVaultRoot: string,
  name: string,
  appDataPath: string,
): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template';
  const id = `user:${slug}-${crypto.randomBytes(4).toString('hex')}`;
  const savedAt = new Date().toISOString();
  const template: TemplateDefinition = {
    id,
    name,
    description: `User template saved from current project on ${savedAt.slice(0, 10)}.`,
    story: buildTree(storyVaultRoot),
    notes: buildTree(notesVaultRoot),
    isUserTemplate: true,
    savedAt,
  };

  const dir = userTemplatesDir(appDataPath);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${slug}-${id.slice(-8)}.json`;
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(template, null, 2), 'utf-8');
  return id;
}
