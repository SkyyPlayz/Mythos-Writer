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
  type TemplateDefinition,
  type TemplateNode,
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
