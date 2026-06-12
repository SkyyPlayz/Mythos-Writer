import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  BUNDLED_TEMPLATES,
  listTemplates,
  scaffoldFromTemplate,
  scaffoldNodes,
  saveAsTemplate,
  loadUserTemplates,
  userTemplatesDir,
  BUNDLED_NOTE_TEMPLATES,
  listNoteTemplates,
  getNoteTemplate,
  parseNoteTemplateFields,
  resolveNoteTemplate,
  renameTemplate,
  deleteTemplate,
  duplicateTemplate,
  importTemplate,
  exportTemplate,
  type TemplateDefinition,
  type TemplateNode,
  type NoteTemplate,
} from './templates.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-templates-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('BUNDLED_TEMPLATES', () => {
  it('exports exactly 4 bundled templates', () => {
    expect(BUNDLED_TEMPLATES).toHaveLength(4);
  });

  it('each bundled template has required fields', () => {
    for (const t of BUNDLED_TEMPLATES) {
      expect(t.id).toMatch(/^bundled:/);
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(Array.isArray(t.story)).toBe(true);
      expect(Array.isArray(t.notes)).toBe(true);
    }
  });

  it('bundled template ids are unique', () => {
    const ids = BUNDLED_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each template has at least one story folder and one notes folder', () => {
    for (const t of BUNDLED_TEMPLATES) {
      expect(t.story.length).toBeGreaterThan(0);
      expect(t.notes.length).toBeGreaterThan(0);
    }
  });
});

describe('scaffoldNodes', () => {
  it('creates top-level directories', () => {
    const nodes: TemplateNode[] = [{ name: 'Characters' }, { name: 'Locations' }];
    scaffoldNodes(tmpDir, nodes);
    expect(fs.existsSync(path.join(tmpDir, 'Characters'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Locations'))).toBe(true);
  });

  it('creates nested directories', () => {
    const nodes: TemplateNode[] = [
      {
        name: 'Manuscript',
        children: [{ name: 'Act 1', children: [{ name: 'Chapter 1' }] }],
      },
    ];
    scaffoldNodes(tmpDir, nodes);
    expect(fs.existsSync(path.join(tmpDir, 'Manuscript', 'Act 1', 'Chapter 1'))).toBe(true);
  });

  it('writes starter notes with .md extension', () => {
    const nodes: TemplateNode[] = [{ name: 'Characters', starterNote: 'Protagonist' }];
    scaffoldNodes(tmpDir, nodes);
    const notePath = path.join(tmpDir, 'Characters', 'Protagonist.md');
    expect(fs.existsSync(notePath)).toBe(true);
    const content = fs.readFileSync(notePath, 'utf-8');
    expect(content).toContain('# Protagonist');
    expect(content).toContain('title: "Protagonist"');
  });

  it('does not overwrite existing starter notes (idempotent)', () => {
    const nodes: TemplateNode[] = [{ name: 'Characters', starterNote: 'Protagonist' }];
    scaffoldNodes(tmpDir, nodes);
    const notePath = path.join(tmpDir, 'Characters', 'Protagonist.md');
    fs.writeFileSync(notePath, 'my custom content', 'utf-8');
    scaffoldNodes(tmpDir, nodes);
    expect(fs.readFileSync(notePath, 'utf-8')).toBe('my custom content');
  });

  it('does not overwrite existing directory contents', () => {
    const existingFile = path.join(tmpDir, 'Characters', 'Villain.md');
    fs.mkdirSync(path.join(tmpDir, 'Characters'), { recursive: true });
    fs.writeFileSync(existingFile, 'existing content', 'utf-8');
    const nodes: TemplateNode[] = [{ name: 'Characters' }];
    scaffoldNodes(tmpDir, nodes);
    expect(fs.readFileSync(existingFile, 'utf-8')).toBe('existing content');
  });
});

describe('scaffoldFromTemplate', () => {
  it('creates story and notes vault roots', () => {
    const storyRoot = path.join(tmpDir, 'Story Vault');
    const notesRoot = path.join(tmpDir, 'Notes Vault');
    const template = BUNDLED_TEMPLATES[0];
    scaffoldFromTemplate(storyRoot, notesRoot, template);
    expect(fs.existsSync(storyRoot)).toBe(true);
    expect(fs.existsSync(notesRoot)).toBe(true);
  });

  it('scaffolds Novel 3-act story folders', () => {
    const storyRoot = path.join(tmpDir, 'Story Vault');
    const notesRoot = path.join(tmpDir, 'Notes Vault');
    const novel = BUNDLED_TEMPLATES.find((t) => t.id === 'bundled:novel-3act')!;
    scaffoldFromTemplate(storyRoot, notesRoot, novel);
    expect(fs.existsSync(path.join(storyRoot, 'Manuscript'))).toBe(true);
    expect(fs.existsSync(path.join(storyRoot, 'Manuscript', 'Act 1 — Setup'))).toBe(true);
    expect(fs.existsSync(path.join(storyRoot, 'Manuscript', 'Act 2 — Confrontation'))).toBe(true);
    expect(fs.existsSync(path.join(storyRoot, 'Manuscript', 'Act 3 — Resolution'))).toBe(true);
  });

  it('scaffolds Novel 3-act notes folders', () => {
    const storyRoot = path.join(tmpDir, 'Story Vault');
    const notesRoot = path.join(tmpDir, 'Notes Vault');
    const novel = BUNDLED_TEMPLATES.find((t) => t.id === 'bundled:novel-3act')!;
    scaffoldFromTemplate(storyRoot, notesRoot, novel);
    expect(fs.existsSync(path.join(notesRoot, 'Characters'))).toBe(true);
    expect(fs.existsSync(path.join(notesRoot, 'Locations'))).toBe(true);
    expect(fs.existsSync(path.join(notesRoot, 'Inbox'))).toBe(true);
  });

  it('scaffolds all 4 bundled templates without throwing', () => {
    for (const template of BUNDLED_TEMPLATES) {
      const storyRoot = path.join(tmpDir, template.id, 'story');
      const notesRoot = path.join(tmpDir, template.id, 'notes');
      expect(() => scaffoldFromTemplate(storyRoot, notesRoot, template)).not.toThrow();
    }
  });

  it('is idempotent — calling twice does not corrupt files', () => {
    const storyRoot = path.join(tmpDir, 'Story Vault');
    const notesRoot = path.join(tmpDir, 'Notes Vault');
    const template = BUNDLED_TEMPLATES[1];
    scaffoldFromTemplate(storyRoot, notesRoot, template);
    const notePath = path.join(notesRoot, 'Characters', 'Main Character.md');
    fs.writeFileSync(notePath, 'custom', 'utf-8');
    scaffoldFromTemplate(storyRoot, notesRoot, template);
    expect(fs.readFileSync(notePath, 'utf-8')).toBe('custom');
  });
});

describe('saveAsTemplate', () => {
  it('creates a JSON file in the templates dir', () => {
    const storyRoot = path.join(tmpDir, 'story');
    const notesRoot = path.join(tmpDir, 'notes');
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(path.join(storyRoot, 'Manuscript'), { recursive: true });
    fs.mkdirSync(path.join(notesRoot, 'Characters'), { recursive: true });

    const id = saveAsTemplate(storyRoot, notesRoot, 'My Template', appData);
    const dir = userTemplatesDir(appData);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    expect(id).toMatch(/^user:/);
  });

  it('saved template captures folder structure', () => {
    const storyRoot = path.join(tmpDir, 'story');
    const notesRoot = path.join(tmpDir, 'notes');
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(path.join(storyRoot, 'Manuscript', 'Chapter 1'), { recursive: true });
    fs.mkdirSync(path.join(notesRoot, 'Characters'), { recursive: true });

    saveAsTemplate(storyRoot, notesRoot, 'My Template', appData);
    const dir = userTemplatesDir(appData);
    const file = fs.readdirSync(dir)[0];
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, file), 'utf-8'),
    ) as TemplateDefinition;

    expect(parsed.name).toBe('My Template');
    expect(parsed.isUserTemplate).toBe(true);
    expect(parsed.story.some((n) => n.name === 'Manuscript')).toBe(true);
    expect(parsed.notes.some((n) => n.name === 'Characters')).toBe(true);
  });

  it('does not save file content — only folder structure', () => {
    const storyRoot = path.join(tmpDir, 'story');
    const notesRoot = path.join(tmpDir, 'notes');
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(path.join(storyRoot, 'Manuscript'), { recursive: true });
    fs.writeFileSync(path.join(storyRoot, 'Manuscript', 'scene.md'), '# secret content', 'utf-8');
    fs.mkdirSync(notesRoot, { recursive: true });

    saveAsTemplate(storyRoot, notesRoot, 'My Template', appData);
    const dir = userTemplatesDir(appData);
    const file = fs.readdirSync(dir)[0];
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    expect(raw).not.toContain('secret content');
  });

  it('skips dot-files and dot-directories', () => {
    const storyRoot = path.join(tmpDir, 'story');
    const notesRoot = path.join(tmpDir, 'notes');
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(path.join(storyRoot, '.git'), { recursive: true });
    fs.mkdirSync(path.join(storyRoot, 'Manuscript'), { recursive: true });
    fs.mkdirSync(notesRoot, { recursive: true });

    saveAsTemplate(storyRoot, notesRoot, 'My Template', appData);
    const dir = userTemplatesDir(appData);
    const file = fs.readdirSync(dir)[0];
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, file), 'utf-8'),
    ) as TemplateDefinition;
    expect(parsed.story.every((n) => !n.name.startsWith('.'))).toBe(true);
  });
});

describe('listTemplates', () => {
  it('returns bundled templates when no user templates exist', () => {
    const appData = path.join(tmpDir, 'appdata');
    const templates = listTemplates(appData);
    expect(templates.length).toBe(BUNDLED_TEMPLATES.length);
    expect(templates.every((t) => t.id.startsWith('bundled:'))).toBe(true);
  });

  it('includes user templates after saveAsTemplate', () => {
    const storyRoot = path.join(tmpDir, 'story');
    const notesRoot = path.join(tmpDir, 'notes');
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(storyRoot, { recursive: true });
    fs.mkdirSync(notesRoot, { recursive: true });

    saveAsTemplate(storyRoot, notesRoot, 'My Custom Template', appData);
    const templates = listTemplates(appData);
    expect(templates.length).toBe(BUNDLED_TEMPLATES.length + 1);
    const userTemplate = templates.find((t) => t.isUserTemplate);
    expect(userTemplate).toBeDefined();
    expect(userTemplate!.name).toBe('My Custom Template');
  });

  it('bundled templates come before user templates', () => {
    const storyRoot = path.join(tmpDir, 'story');
    const notesRoot = path.join(tmpDir, 'notes');
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(storyRoot, { recursive: true });
    fs.mkdirSync(notesRoot, { recursive: true });

    saveAsTemplate(storyRoot, notesRoot, 'User One', appData);
    const templates = listTemplates(appData);
    const firstUser = templates.findIndex((t) => t.isUserTemplate);
    expect(firstUser).toBe(BUNDLED_TEMPLATES.length);
  });

  it('tolerates malformed user template JSON gracefully', () => {
    const appData = path.join(tmpDir, 'appdata');
    const dir = userTemplatesDir(appData);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bad.json'), 'not json{{{', 'utf-8');

    const templates = listTemplates(appData);
    expect(templates.length).toBe(BUNDLED_TEMPLATES.length);
  });
});

describe('loadUserTemplates', () => {
  it('returns empty array when directory does not exist', () => {
    const appData = path.join(tmpDir, 'nonexistent');
    expect(loadUserTemplates(appData)).toEqual([]);
  });
});

// ─── Note Template tests (SKY-190) ───────────────────────────────────────────

describe('BUNDLED_NOTE_TEMPLATES', () => {
  it('exports exactly 6 bundled note templates', () => {
    expect(BUNDLED_NOTE_TEMPLATES).toHaveLength(6);
  });

  it('each note template has required fields', () => {
    for (const t of BUNDLED_NOTE_TEMPLATES) {
      expect(t.id).toMatch(/^note:/);
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(typeof t.body).toBe('string');
      expect(t.body.length).toBeGreaterThan(0);
      expect(Array.isArray(t.fields)).toBe(true);
    }
  });

  it('note template ids are unique', () => {
    const ids = BUNDLED_NOTE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bundled note templates cover the expected kinds', () => {
    const kinds = BUNDLED_NOTE_TEMPLATES.map((t) => t.kind);
    expect(kinds).toContain('scene');
    expect(kinds).toContain('character');
    expect(kinds).toContain('location');
    expect(kinds).toContain('item');
    expect(kinds).toContain('chapter');
  });

  it('default-scene template has prompt and pick fields', () => {
    const scene = BUNDLED_NOTE_TEMPLATES.find((t) => t.id === 'note:default-scene')!;
    const prompts = scene.fields.filter((f) => f.kind === 'prompt');
    const picks = scene.fields.filter((f) => f.kind === 'pick');
    expect(prompts.length).toBeGreaterThan(0);
    expect(picks.length).toBeGreaterThan(0);
  });

  it('default-character template has pick field for archetype', () => {
    const char = BUNDLED_NOTE_TEMPLATES.find((t) => t.id === 'note:default-character')!;
    const archetype = char.fields.find((f) => f.key === 'archetype');
    expect(archetype).toBeDefined();
    expect(archetype?.kind).toBe('pick');
    expect(archetype?.entityType).toBe('character');
  });
});

describe('parseNoteTemplateFields', () => {
  it('parses a plain {{var}} as literal kind', () => {
    const fields = parseNoteTemplateFields('Hello {{name}}!');
    expect(fields).toHaveLength(1);
    expect(fields[0]).toEqual({ key: 'name', kind: 'literal', label: 'name' });
  });

  it('parses {{var | prompt(label)}} as prompt kind', () => {
    const fields = parseNoteTemplateFields('{{title | prompt(Scene Title)}}');
    expect(fields).toHaveLength(1);
    expect(fields[0].kind).toBe('prompt');
    expect(fields[0].key).toBe('title');
    expect(fields[0].label).toBe('Scene Title');
  });

  it('parses {{var | pick(Characters)}} as pick kind with character entity type', () => {
    const fields = parseNoteTemplateFields('{{archetype | pick(Characters)}}');
    expect(fields).toHaveLength(1);
    expect(fields[0].kind).toBe('pick');
    expect(fields[0].key).toBe('archetype');
    expect(fields[0].entityType).toBe('character');
  });

  it('parses {{var | pick(Locations)}} as pick kind with location entity type', () => {
    const fields = parseNoteTemplateFields('{{location | pick(Locations)}}');
    expect(fields[0].entityType).toBe('location');
  });

  it('parses {{var | pick(Items)}} as pick kind with item entity type', () => {
    const fields = parseNoteTemplateFields('{{item | pick(Items)}}');
    expect(fields[0].entityType).toBe('item');
  });

  it('deduplicates repeated keys', () => {
    const body = '# {{title | prompt(Title)}}\n\n## {{title}}';
    const fields = parseNoteTemplateFields(body);
    expect(fields.filter((f) => f.key === 'title')).toHaveLength(1);
  });

  it('falls back to prompt for unknown modifiers', () => {
    const fields = parseNoteTemplateFields('{{x | unknownModifier(foo)}}');
    expect(fields[0].kind).toBe('prompt');
  });

  it('parses empty body without throwing', () => {
    expect(parseNoteTemplateFields('')).toEqual([]);
  });

  it('parses body with no template expressions', () => {
    expect(parseNoteTemplateFields('# Static heading\n\nNo variables here.')).toEqual([]);
  });

  it('strips whitespace around keys and modifiers', () => {
    const fields = parseNoteTemplateFields('{{ title | prompt( My Label ) }}');
    expect(fields[0].key).toBe('title');
    expect(fields[0].label).toBe('My Label');
  });
});

describe('resolveNoteTemplate', () => {
  it('replaces {{var}} with the provided value', () => {
    const result = resolveNoteTemplate('Hello {{name}}!', { name: 'Aria' });
    expect(result).toBe('Hello Aria!');
  });

  it('replaces {{var | prompt(...)}} using the key', () => {
    const result = resolveNoteTemplate(
      '{{title | prompt(Title)}}',
      { title: 'The Opening' },
    );
    expect(result).toBe('The Opening');
  });

  it('replaces {{var | pick(...)}} using the key', () => {
    const result = resolveNoteTemplate(
      '{{location | pick(Locations)}}',
      { location: 'The Citadel' },
    );
    expect(result).toBe('The Citadel');
  });

  it('replaces multiple expressions in the same body', () => {
    const body = '# {{title | prompt(Title)}}\n\n**POV:** {{pov | prompt(POV)}}';
    const result = resolveNoteTemplate(body, { title: 'Dawn', pov: 'Aria' });
    expect(result).toBe('# Dawn\n\n**POV:** Aria');
  });

  it('leaves missing keys as empty string', () => {
    const result = resolveNoteTemplate('{{missing}}', {});
    expect(result).toBe('');
  });

  it('is idempotent — resolving an already-resolved string does nothing', () => {
    const body = 'Plain text, no variables.';
    expect(resolveNoteTemplate(body, {})).toBe(body);
  });
});

describe('listNoteTemplates', () => {
  it('returns all 6 templates when no kind filter is given', () => {
    expect(listNoteTemplates()).toHaveLength(6);
  });

  it('filters by kind correctly', () => {
    const scenes = listNoteTemplates('scene');
    expect(scenes.every((t) => t.kind === 'scene')).toBe(true);
    expect(scenes.length).toBeGreaterThan(0);
  });

  it('returns empty array for unknown kind', () => {
    expect(listNoteTemplates('nonexistent')).toEqual([]);
  });
});

describe('getNoteTemplate', () => {
  it('returns the correct template by id', () => {
    const t = getNoteTemplate('note:default-scene');
    expect(t).toBeDefined();
    expect(t!.id).toBe('note:default-scene');
  });

  it('returns undefined for unknown id', () => {
    expect(getNoteTemplate('note:does-not-exist')).toBeUndefined();
  });
});


// ─── template:saveAs IPC handler — name length validation (SEC-11) ───────────
// Inline replicas of the guard conditions from the main.ts TEMPLATE_SAVE_AS
// handler. No Electron or real vault required.

const TEMPLATE_NAME_MAX_LENGTH = 255;

function validateTemplateSaveAsName(rawName: unknown): string {
  const name = (typeof rawName === 'string' ? rawName : '').trim();
  if (!name) throw new Error('Template name is required');
  if (name.length > TEMPLATE_NAME_MAX_LENGTH)
    throw new Error(`Template name must be ${TEMPLATE_NAME_MAX_LENGTH} characters or less`);
  return name;
}

describe('template:saveAs IPC handler — name length cap (SEC-11)', () => {
  it('rejects names longer than 255 chars', () => {
    expect(() => validateTemplateSaveAsName('a'.repeat(256))).toThrow(
      'Template name must be 255 characters or less',
    );
  });

  it('accepts names at exactly 255 chars (boundary)', () => {
    const atLimit = 'a'.repeat(255);
    expect(() => validateTemplateSaveAsName(atLimit)).not.toThrow();
    expect(validateTemplateSaveAsName(atLimit)).toBe(atLimit);
  });

  it('accepts ordinary names', () => {
    expect(validateTemplateSaveAsName('My Template')).toBe('My Template');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(() => validateTemplateSaveAsName('')).toThrow('Template name is required');
    expect(() => validateTemplateSaveAsName('   ')).toThrow('Template name is required');
  });
});

// ─── SKY-1399: rename / delete / duplicate ───────────────────────────────────

function seedTemplate(appData: string, name: string): string {
  const storyRoot = path.join(appData, 'story');
  const notesRoot = path.join(appData, 'notes');
  fs.mkdirSync(path.join(storyRoot, 'Manuscript'), { recursive: true });
  fs.mkdirSync(notesRoot, { recursive: true });
  return saveAsTemplate(storyRoot, notesRoot, name, appData);
}

describe('renameTemplate', () => {
  it('updates the name field in the JSON file', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id = seedTemplate(appData, 'My Template');
    renameTemplate(appData, id, 'Renamed Template');
    const updated = loadUserTemplates(appData).find((t) => t.id === id)!;
    expect(updated.name).toBe('Renamed Template');
  });

  it('preserves all other fields when renaming', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id = seedTemplate(appData, 'My Template');
    const before = loadUserTemplates(appData).find((t) => t.id === id)!;
    renameTemplate(appData, id, 'New Name');
    const after = loadUserTemplates(appData).find((t) => t.id === id)!;
    expect(after.id).toBe(before.id);
    expect(after.description).toBe(before.description);
    expect(after.story).toEqual(before.story);
    expect(after.notes).toEqual(before.notes);
  });

  it('throws when the template id does not exist', () => {
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(path.join(appData, 'templates'), { recursive: true });
    expect(() => renameTemplate(appData, 'user:nonexistent-xxxxxxxx', 'X')).toThrow('Template not found');
  });
});

describe('deleteTemplate', () => {
  it('removes the template JSON file', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id = seedTemplate(appData, 'To Delete');
    expect(loadUserTemplates(appData).some((t) => t.id === id)).toBe(true);
    deleteTemplate(appData, id);
    expect(loadUserTemplates(appData).some((t) => t.id === id)).toBe(false);
  });

  it('leaves other templates untouched', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id1 = seedTemplate(appData, 'Keep');
    const id2 = seedTemplate(appData, 'Delete Me');
    deleteTemplate(appData, id2);
    const remaining = loadUserTemplates(appData);
    expect(remaining.some((t) => t.id === id1)).toBe(true);
    expect(remaining.some((t) => t.id === id2)).toBe(false);
  });

  it('throws when the template id does not exist', () => {
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(path.join(appData, 'templates'), { recursive: true });
    expect(() => deleteTemplate(appData, 'user:nonexistent-xxxxxxxx')).toThrow('Template not found');
  });
});

describe('duplicateTemplate', () => {
  it('creates a new template with " copy" appended to the name', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id = seedTemplate(appData, 'My Template');
    const newId = duplicateTemplate(appData, id);
    const copy = loadUserTemplates(appData).find((t) => t.id === newId)!;
    expect(copy.name).toBe('My Template copy');
  });

  it('assigns a fresh unique id to the duplicate', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id = seedTemplate(appData, 'Original');
    const newId = duplicateTemplate(appData, id);
    expect(newId).not.toBe(id);
    expect(newId).toMatch(/^user:/);
  });

  it('copies story and notes trees from the original', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id = seedTemplate(appData, 'Original');
    const source = loadUserTemplates(appData).find((t) => t.id === id)!;
    const newId = duplicateTemplate(appData, id);
    const copy = loadUserTemplates(appData).find((t) => t.id === newId)!;
    expect(copy.story).toEqual(source.story);
    expect(copy.notes).toEqual(source.notes);
  });

  it('leaves the original template intact', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id = seedTemplate(appData, 'Original');
    duplicateTemplate(appData, id);
    expect(loadUserTemplates(appData).some((t) => t.id === id)).toBe(true);
  });

  it('throws when the template id does not exist', () => {
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(path.join(appData, 'templates'), { recursive: true });
    expect(() => duplicateTemplate(appData, 'user:nonexistent-xxxxxxxx')).toThrow('Template not found');
  });
});

// ─── SKY-1403: export / import ────────────────────────────────────────────────

function makeValidTemplateJson(overrides: Partial<TemplateDefinition> = {}): string {
  const base: TemplateDefinition = {
    id: 'user:test-abcd1234',
    name: 'Test Template',
    description: 'A test template.',
    story: [{ name: 'Manuscript', children: [{ name: 'Chapter 1' }] }],
    notes: [{ name: 'Characters' }],
    isUserTemplate: true,
    savedAt: '2026-06-01T00:00:00.000Z',
  };
  return JSON.stringify({ ...base, ...overrides }, null, 2);
}

describe('importTemplate', () => {
  it('imports a valid template file and returns the saved template', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 'template.mythostemplate');
    fs.writeFileSync(srcFile, makeValidTemplateJson());
    const res = importTemplate(appData, srcFile);
    expect('ok' in res && res.ok).toBe(true);
    if ('ok' in res) {
      expect(res.template.name).toBe('Test Template');
      expect(res.template.id).toMatch(/^user:/);
      expect(res.template.id).not.toBe('user:test-abcd1234'); // fresh id
      expect(res.template.isUserTemplate).toBe(true);
    }
  });

  it('persists the imported template to disk', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 'template.mythostemplate');
    fs.writeFileSync(srcFile, makeValidTemplateJson());
    importTemplate(appData, srcFile);
    expect(loadUserTemplates(appData)).toHaveLength(1);
  });

  it('rejects malformed JSON', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 'bad.mythostemplate');
    fs.writeFileSync(srcFile, 'not valid json {{{');
    const res = importTemplate(appData, srcFile);
    expect('error' in res).toBe(true);
  });

  it('rejects missing required field: name', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 't.mythostemplate');
    const json = makeValidTemplateJson({ name: '' } as Partial<TemplateDefinition>);
    fs.writeFileSync(srcFile, json);
    const res = importTemplate(appData, srcFile);
    expect('error' in res).toBe(true);
  });

  it('rejects missing required field: story', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 't.mythostemplate');
    const raw = JSON.stringify({ id: 'user:x', name: 'X', notes: [] });
    fs.writeFileSync(srcFile, raw);
    const res = importTemplate(appData, srcFile);
    expect('error' in res).toBe(true);
  });

  it('rejects missing required field: notes', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 't.mythostemplate');
    const raw = JSON.stringify({ id: 'user:x', name: 'X', story: [] });
    fs.writeFileSync(srcFile, raw);
    const res = importTemplate(appData, srcFile);
    expect('error' in res).toBe(true);
  });

  it('rejects node names with path separators (path traversal)', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 't.mythostemplate');
    const json = makeValidTemplateJson({
      story: [{ name: '../escape' }],
    });
    fs.writeFileSync(srcFile, json);
    const res = importTemplate(appData, srcFile);
    expect('error' in res).toBe(true);
  });

  it('rejects node names with traversal sequences', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 't.mythostemplate');
    const json = makeValidTemplateJson({
      notes: [{ name: '..\\evil' }],
    });
    fs.writeFileSync(srcFile, json);
    const res = importTemplate(appData, srcFile);
    expect('error' in res).toBe(true);
  });

  it('rejects node names with forward slashes', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 't.mythostemplate');
    const json = makeValidTemplateJson({
      story: [{ name: 'a/b' }],
    });
    fs.writeFileSync(srcFile, json);
    const res = importTemplate(appData, srcFile);
    expect('error' in res).toBe(true);
  });

  it('appends " (2)" when a template with the same name already exists', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 't.mythostemplate');
    // Import once to establish the name
    fs.writeFileSync(srcFile, makeValidTemplateJson());
    importTemplate(appData, srcFile);
    // Import again — should get " (2)" suffix
    const res2 = importTemplate(appData, srcFile);
    expect('ok' in res2 && res2.ok).toBe(true);
    if ('ok' in res2) {
      expect(res2.template.name).toBe('Test Template (2)');
    }
  });

  it('appends " (3)" for a third import of the same name', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 't.mythostemplate');
    fs.writeFileSync(srcFile, makeValidTemplateJson());
    importTemplate(appData, srcFile);
    importTemplate(appData, srcFile);
    const res3 = importTemplate(appData, srcFile);
    expect('ok' in res3 && res3.ok).toBe(true);
    if ('ok' in res3) {
      expect(res3.template.name).toBe('Test Template (3)');
    }
  });

  it('always generates a fresh id — never uses the imported id', () => {
    const appData = path.join(tmpDir, 'appdata');
    const srcFile = path.join(tmpDir, 't.mythostemplate');
    fs.writeFileSync(srcFile, makeValidTemplateJson({ id: 'user:original-id-0000' }));
    const res = importTemplate(appData, srcFile);
    if ('ok' in res) {
      expect(res.template.id).not.toBe('user:original-id-0000');
    }
  });

  it('returns error when source file does not exist', () => {
    const appData = path.join(tmpDir, 'appdata');
    const res = importTemplate(appData, '/nonexistent/path/template.mythostemplate');
    expect('error' in res).toBe(true);
  });
});

describe('exportTemplate', () => {
  it('writes a JSON file at the destination path', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id = seedTemplate(appData, 'Export Me');
    const dest = path.join(tmpDir, 'exported.mythostemplate');
    const res = exportTemplate(appData, id, dest);
    expect('ok' in res && res.ok).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
  });

  it('exported file parses as valid JSON with required fields', () => {
    const appData = path.join(tmpDir, 'appdata');
    const id = seedTemplate(appData, 'My Export');
    const dest = path.join(tmpDir, 'exported.mythostemplate');
    exportTemplate(appData, id, dest);
    const parsed = JSON.parse(fs.readFileSync(dest, 'utf-8')) as TemplateDefinition;
    expect(parsed.id).toBe(id);
    expect(parsed.name).toBe('My Export');
    expect(Array.isArray(parsed.story)).toBe(true);
    expect(Array.isArray(parsed.notes)).toBe(true);
  });

  it('returns error for unknown template id', () => {
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(path.join(appData, 'templates'), { recursive: true });
    const dest = path.join(tmpDir, 'exported.mythostemplate');
    const res = exportTemplate(appData, 'user:nonexistent-id', dest);
    expect('error' in res).toBe(true);
  });
});
