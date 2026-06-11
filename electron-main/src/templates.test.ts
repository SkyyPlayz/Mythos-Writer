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
  deleteUserTemplate,
  loadUserTemplates,
  userTemplatesDir,
  BUNDLED_NOTE_TEMPLATES,
  listNoteTemplates,
  getNoteTemplate,
  parseNoteTemplateFields,
  resolveNoteTemplate,
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

describe('deleteUserTemplate', () => {
  it('removes the JSON file matching the given id', () => {
    const storyRoot = path.join(tmpDir, 'story');
    const notesRoot = path.join(tmpDir, 'notes');
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(storyRoot, { recursive: true });
    fs.mkdirSync(notesRoot, { recursive: true });

    const id = saveAsTemplate(storyRoot, notesRoot, 'To Delete', appData);
    const dir = userTemplatesDir(appData);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json'))).toHaveLength(1);

    deleteUserTemplate(appData, id);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('does not remove other user templates with different ids', () => {
    const storyRoot = path.join(tmpDir, 'story');
    const notesRoot = path.join(tmpDir, 'notes');
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(storyRoot, { recursive: true });
    fs.mkdirSync(notesRoot, { recursive: true });

    const idA = saveAsTemplate(storyRoot, notesRoot, 'Keep Me', appData);
    const idB = saveAsTemplate(storyRoot, notesRoot, 'Delete Me', appData);

    deleteUserTemplate(appData, idB);

    const remaining = loadUserTemplates(appData);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(idA);
  });

  it('throws when template id does not exist', () => {
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(userTemplatesDir(appData), { recursive: true });
    expect(() => deleteUserTemplate(appData, 'user:nonexistent')).toThrow('Template not found');
  });

  it('throws when the templates directory does not exist', () => {
    const appData = path.join(tmpDir, 'no-appdata');
    expect(() => deleteUserTemplate(appData, 'user:x')).toThrow('Template not found');
  });

  it('listTemplates no longer includes the deleted template', () => {
    const storyRoot = path.join(tmpDir, 'story');
    const notesRoot = path.join(tmpDir, 'notes');
    const appData = path.join(tmpDir, 'appdata');
    fs.mkdirSync(storyRoot, { recursive: true });
    fs.mkdirSync(notesRoot, { recursive: true });

    const id = saveAsTemplate(storyRoot, notesRoot, 'Gone', appData);
    expect(listTemplates(appData).some((t) => t.id === id)).toBe(true);

    deleteUserTemplate(appData, id);
    expect(listTemplates(appData).some((t) => t.id === id)).toBe(false);
    expect(listTemplates(appData).length).toBe(BUNDLED_TEMPLATES.length);
  });
});

