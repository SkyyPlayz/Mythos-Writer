import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureAxe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { AddPanelMenu, PageDock } from '../components/ui/PanelChrome';
import { AI_OFF_REASON, buildAddCatalog, isPanelInert } from './globalCatalog';
import { DESIGN_PANELS, type DesignPanelId } from './panelRegistry';
import { EDITOR_INSPECTOR_TABS, defaultGlobalSidebars, pageChromeDefaults } from './pageShell';
import { PAGE_VIEWS, type PageView } from './scopeModel';

const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

/** The panels a fresh profile has open on `view`: the global right sidebar plus that page's own chrome. */
function freshPlaced(view: PageView): DesignPanelId[] {
  const page = pageChromeDefaults(view);
  return [
    ...defaultGlobalSidebars().right,
    ...(page.left ? [page.left] : []),
    ...(page.right ? [page.right] : []),
  ];
}

function ids(entries: { id: string }[]): string[] {
  return entries.map((entry) => entry.id);
}

describe('buildAddCatalog', () => {
  it('lists Findings in the Global section as a full panel on the fresh Editor', () => {
    const catalog = buildAddCatalog({ page: 'editor', placed: freshPlaced('editor'), aiEnabled: true });
    const findings = catalog.global.find((entry) => entry.id === 'findings');
    expect(findings).toEqual({
      id: 'findings',
      label: 'Findings',
      scope: 'global',
      kind: 'full',
      inert: false,
      reason: null,
    });
    expect(ids(catalog.global)).toEqual(['findings', 'suggestions']);
    // The partner is already in the right sidebar, so it is not offered twice.
    expect(ids(catalog.global)).not.toContain('agent');
  });

  it('never offers a page panel in the Global section (Beta list stays out of global Add)', () => {
    for (const view of PAGE_VIEWS) {
      const catalog = buildAddCatalog({ page: view, placed: [], aiEnabled: true });
      expect(catalog.global.every((entry) => entry.scope === 'global')).toBe(true);
      expect(ids(catalog.global)).not.toContain('navBeta');
      expect(ids(catalog.global)).not.toContain('betaPanel');
    }
  });

  it('only offers the current page’s own panels in the Page section', () => {
    const beta = buildAddCatalog({ page: 'beta', placed: [], aiEnabled: true });
    expect(ids(beta.page)).toEqual(['navBeta', 'betaPanel']);
    expect(beta.page.every((entry) => entry.scope === 'page:beta')).toBe(true);
    const book = buildAddCatalog({ page: 'book', placed: [], aiEnabled: true });
    expect(ids(book.page)).toEqual(['navEditor']);
    expect(buildAddCatalog({ page: null, placed: [], aiEnabled: true }).page).toEqual([]);
  });

  it('offers nothing for a page whose defaults are all open', () => {
    for (const view of PAGE_VIEWS) {
      expect(buildAddCatalog({ page: view, placed: freshPlaced(view), aiEnabled: true }).page).toEqual([]);
    }
  });

  it('skips panels the app cannot mount yet', () => {
    const catalog = buildAddCatalog({ page: 'artifacts', placed: [], aiEnabled: true });
    expect(ids(catalog.global)).not.toContain('activity');
    expect(ids(catalog.global)).not.toContain('inbox');
    expect(catalog.page).toEqual([]);
  });

  it('AI Off: agent, findings, activity and inbox are inert, and listed AI panels cannot be added', () => {
    for (const id of ['agent', 'findings', 'activity', 'inbox', 'suggestions'] as const) {
      expect(isPanelInert(id, false)).toBe(true);
      expect(isPanelInert(id, true)).toBe(false);
    }
    expect(isPanelInert('navEditor', false)).toBe(false);
    const catalog = buildAddCatalog({ page: 'editor', placed: freshPlaced('editor'), aiEnabled: false });
    expect(catalog.global.length).toBeGreaterThan(0);
    for (const entry of catalog.global) {
      expect(entry.inert).toBe(true);
      expect(entry.reason).toBe(AI_OFF_REASON);
    }
  });

  it('marks every AI-bearing global panel as AI so the AI Off rule reaches it', () => {
    const globals = DESIGN_PANELS.filter((panel) => panel.scope === 'global');
    expect(globals.map((panel) => panel.id)).toEqual(['agent', 'findings', 'suggestions', 'activity', 'inbox']);
    expect(globals.every((panel) => panel.ai)).toBe(true);
  });
});

describe('AddPanelMenu (user path)', () => {
  it('opens Global and Page sections, adds Findings, and closes with focus back on the button', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const catalog = buildAddCatalog({ page: 'editor', placed: freshPlaced('editor'), aiEnabled: true });
    render(<AddPanelMenu catalog={catalog} onAdd={onAdd} testId="grs-add-panel" />);

    const button = screen.getByRole('button', { name: 'Add panel' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    const globalSection = screen.getByRole('region', { name: 'Global panels' });
    const pageSection = screen.getByRole('region', { name: 'On this page' });
    expect(within(globalSection).getByRole('button', { name: 'Findings' })).toBeEnabled();
    expect(within(pageSection).queryAllByRole('button')).toHaveLength(0);
    expect(within(pageSection).getByText("This page's panels are already open.")).toBeInTheDocument();

    const results = await axe(screen.getByTestId('grs-add-panel-popover'));
    expect(results.violations).toEqual([]);

    await user.click(within(globalSection).getByRole('button', { name: 'Findings' }));
    expect(onAdd).toHaveBeenCalledWith('findings');
    expect(screen.queryByTestId('grs-add-panel-popover')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes on Escape from the keyboard', async () => {
    const user = userEvent.setup();
    const catalog = buildAddCatalog({ page: 'editor', placed: freshPlaced('editor'), aiEnabled: true });
    render(<AddPanelMenu catalog={catalog} onAdd={() => {}} />);
    const button = screen.getByRole('button', { name: 'Add panel' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('region', { name: 'Global panels' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Global panels' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('AI Off: AI panels show as disabled with the reason and cannot be added', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const catalog = buildAddCatalog({ page: 'editor', placed: freshPlaced('editor'), aiEnabled: false });
    render(<AddPanelMenu catalog={catalog} onAdd={onAdd} />);
    await user.click(screen.getByRole('button', { name: 'Add panel' }));
    const findings = screen.getByRole('button', { name: 'Findings' });
    expect(findings).toBeDisabled();
    expect(findings).toHaveAccessibleDescription(AI_OFF_REASON);
    await user.click(findings);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

function EditorInspectorHarness({ onBodyMount }: { onBodyMount: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<string>('scenes');
  return (
    <PageDock
      panelId="edPanel"
      scope="page:editor"
      label="Editor inspector"
      side="right"
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((value) => !value)}
      tabs={EDITOR_INSPECTOR_TABS}
      activeTab={tab}
      onTabChange={setTab}
      testId="page-panel-edPanel"
    >
      <MountProbe onMount={onBodyMount} label={tab} />
    </PageDock>
  );
}

function MountProbe({ onMount, label }: { onMount: () => void; label: string }) {
  const [mounted] = useState(() => { onMount(); return true; });
  return <p>{mounted ? `${label} body` : ''}</p>;
}

describe('PageDock (in-page inspector)', () => {
  it('shows only the page tabs and follows the tabs keyboard pattern', async () => {
    const user = userEvent.setup();
    render(<EditorInspectorHarness onBodyMount={() => {}} />);
    const dock = screen.getByRole('region', { name: 'Editor inspector' });
    expect(dock).toHaveAttribute('data-panel-id', 'edPanel');
    expect(dock).toHaveAttribute('data-scope', 'page:editor');

    const tabs = within(dock).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Scenes', 'Notes & Analysis']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(dock).getByRole('tabpanel')).toHaveAccessibleName('Scenes');

    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Notes & Analysis' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Notes & Analysis' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Scenes' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Notes & Analysis' })).toHaveFocus();

    const results = await axe(dock);
    expect(results.violations).toEqual([]);
  });

  it('collapses and expands from the keyboard without remounting its content', async () => {
    const user = userEvent.setup();
    const onBodyMount = vi.fn();
    render(<EditorInspectorHarness onBodyMount={onBodyMount} />);
    expect(onBodyMount).toHaveBeenCalledTimes(1);

    const collapse = screen.getByRole('button', { name: 'Collapse Editor inspector' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    collapse.focus();
    await user.keyboard('{Enter}');
    const expand = screen.getByRole('button', { name: 'Expand Editor inspector' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(expand).toHaveFocus();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-panel-edPanel')).toHaveAttribute('data-collapsed', 'true');

    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Collapse Editor inspector' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    // Collapse hides the body; it never unmounts it.
    expect(onBodyMount).toHaveBeenCalledTimes(1);

    const results = await axe(screen.getByTestId('page-panel-edPanel'));
    expect(results.violations).toEqual([]);
  });
});
