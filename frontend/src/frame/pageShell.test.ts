import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { designPanel } from './panelRegistry';
import {
  BRAINSTORM_PAGE_FACES,
  EDITOR_INSPECTOR_TABS,
  WIDGET_SHELL_FLAG_KEY,
  defaultGlobalSidebars,
  defaultShellLayout,
  isWidgetShellOn,
  pageChromeDefaults,
  pageDefaultViolations,
  pageViewFor,
} from './pageShell';
import { PAGE_VIEWS } from './scopeModel';

describe('pageShell defaults', () => {
  it('opens the Story Editor with its own navigator and page-only inspector', () => {
    expect(pageChromeDefaults('editor')).toEqual({ left: 'navEditor', right: 'edPanel' });
    expect(designPanel('navEditor').label).toBe('Story Navigator');
    expect(designPanel('navEditor').scope).toBe('page:editor');
  });

  it('keeps the Editor inspector tabs to Scenes and Notes & Analysis', () => {
    expect(EDITOR_INSPECTOR_TABS.map((tab) => tab.id)).toEqual(['scenes', 'notes-analysis']);
    expect(EDITOR_INSPECTOR_TABS.map((tab) => tab.label)).toEqual(['Scenes', 'Notes & Analysis']);
    const ids: string[] = EDITOR_INSPECTOR_TABS.map((tab) => tab.id);
    for (const globalTab of ['partner', 'suggestions', 'findings', 'agent']) {
      expect(ids).not.toContain(globalTab);
    }
  });

  it('matches the owner page-panel map for every page', () => {
    expect(PAGE_VIEWS.map((view) => [view, pageChromeDefaults(view)])).toEqual([
      ['editor', { left: 'navEditor', right: 'edPanel' }],
      ['book', { left: 'navEditor', right: null }],
      ['structure', { left: 'navEditor', right: 'beats' }],
      ['notes', { left: 'navNotes', right: 'noteProps' }],
      ['boards', { left: 'navBoards', right: 'boardInsp' }],
      ['crafter', { left: 'navCrafter', right: null }],
      ['brainstorm', { left: 'navBrainstorm', right: 'bsPanel' }],
      ['beta', { left: 'navBeta', right: 'betaPanel' }],
      ['timeline', { left: 'navTimeline', right: 'tlDetails' }],
      ['graph', { left: 'navGraph', right: 'graphDetails' }],
      ['artifacts', { left: 'navArtifacts', right: 'artBuilder' }],
      ['settings', { left: null, right: null }],
    ]);
  });

  it('never puts a global panel (or another page’s panel) in any page default', () => {
    expect(pageDefaultViolations()).toEqual([]);
  });

  it('gives Brainstorm’s page panel the Idea Board face only', () => {
    expect(BRAINSTORM_PAGE_FACES).toEqual(['board']);
    expect(designPanel('bsPanel').label).toBe('Idea Board');
  });

  it('starts the global sidebars with global panels only: left empty, right = agent', () => {
    expect(defaultGlobalSidebars()).toEqual({ left: [], right: ['agent'] });
    for (const id of defaultGlobalSidebars().right) expect(designPanel(id).scope).toBe('global');
    expect(defaultShellLayout()).toEqual({
      center: 'editor',
      page: { left: 'navEditor', right: 'edPanel' },
      global: { left: [], right: ['agent'] },
    });
  });

  it('returns fresh copies so callers cannot change the defaults', () => {
    const editor = pageChromeDefaults('editor');
    editor.right = null;
    const sidebars = defaultGlobalSidebars();
    sidebars.right.push('findings');
    expect(pageChromeDefaults('editor').right).toBe('edPanel');
    expect(defaultGlobalSidebars().right).toEqual(['agent']);
  });
});

describe('pageViewFor', () => {
  it('maps tabs, story sub-views and overlays to design pages', () => {
    expect(pageViewFor({ activeTab: 'story', storySubView: 'editor' })).toBe('editor');
    expect(pageViewFor({ activeTab: 'story', storySubView: 'book' })).toBe('book');
    expect(pageViewFor({ activeTab: 'story', storySubView: 'structure' })).toBe('structure');
    expect(pageViewFor({ activeTab: 'story', storySubView: 'kanban' })).toBe('crafter');
    expect(pageViewFor({ activeTab: 'story', storySubView: 'timeline' })).toBe('timeline');
    expect(pageViewFor({ activeTab: 'notes', storySubView: 'editor' })).toBe('notes');
    expect(pageViewFor({ activeTab: 'boards', storySubView: 'editor' })).toBe('boards');
    expect(pageViewFor({ activeTab: 'brainstorm', storySubView: 'editor' })).toBe('brainstorm');
    expect(pageViewFor({ activeTab: 'vault-graph', storySubView: 'editor' })).toBe('graph');
    expect(pageViewFor({ activeTab: 'story', storySubView: 'editor', betaReaderOpen: true })).toBe('beta');
    expect(pageViewFor({ activeTab: 'notes', storySubView: 'editor', settingsOpen: true })).toBe('settings');
  });

  it('has no page chrome for views the design does not name', () => {
    expect(pageViewFor({ activeTab: 'story', storySubView: 'coach' })).toBeNull();
    expect(pageViewFor({ activeTab: 'nowhere', storySubView: 'editor' })).toBeNull();
  });
});

describe('widget shell beta flag', () => {
  it('is on only for an explicit true', () => {
    expect(isWidgetShellOn({ [WIDGET_SHELL_FLAG_KEY]: true })).toBe(true);
    for (const value of [false, 'true', 1, null, undefined]) {
      expect(isWidgetShellOn({ [WIDGET_SHELL_FLAG_KEY]: value })).toBe(false);
    }
    expect(isWidgetShellOn({})).toBe(false);
    expect(isWidgetShellOn(null)).toBe(false);
    expect(isWidgetShellOn(undefined)).toBe(false);
  });

  it('is read in one place and never written by the shell (no persistence in W1)', () => {
    const src = resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
        if (readFileSync(full, 'utf8').includes(`'${WIDGET_SHELL_FLAG_KEY}'`)) offenders.push(entry.name);
      }
    };
    walk(src);
    expect(offenders).toEqual(['pageShell.ts']);
  });

  it('keeps the frame free of TipTap, vault and agent imports', () => {
    for (const file of ['scopeModel.ts', 'pageShell.ts', 'globalCatalog.ts', 'panelRegistry.ts']) {
      const text = readFileSync(resolve(__dirname, file), 'utf8');
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
      for (const spec of imports) expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/(scopeModel|panelRegistry)$/);
    }
  });
});
