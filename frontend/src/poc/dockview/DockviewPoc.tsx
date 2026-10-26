// Throwaway dockview proof of concept. Reached only via ?poc=dockview.
// Mounts the real story BlockEditor and the real Notes board on the open
// vault. No layout persistence, no theme work, no agent control.
import { useCallback, useContext, useEffect, useRef, useState, createContext } from 'react';
import type { Editor } from '@tiptap/core';
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react';
import BlockEditor, { blocksToMarkdownBody } from '../../BlockEditor';
import BoardsTabPanel from '../../pages/Boards/BoardsTabPanel';
import { stripManifestContentForIpc } from '../../manifestIpc';
import type { Block, Chapter, Manifest, Part, Scene, Story } from '../../types';
import 'dockview/dist/styles/dockview.css';
import './DockviewPoc.css';

declare global {
  interface Window {
    __pocEditorMounts?: number;
    __pocEditorUnmounts?: number;
    __pocBoardMounts?: number;
    __pocBoardUnmounts?: number;
    /** Live ProseMirror editor. Selection is read from here so a drag blur does not look like a lost selection. */
    __pocEditor?: Editor | null;
  }
}

interface PocReady {
  scene: Scene;
  notesVaultPath: string;
  storyVaultPath: string;
}

const PocReadyContext = createContext<PocReady | null>(null);

const PANEL_COMPONENTS = {
  editor: EditorPanel,
  board: BoardPanel,
};

function bumpMount(which: 'editor' | 'board'): () => void {
  if (which === 'editor') {
    window.__pocEditorMounts = (window.__pocEditorMounts ?? 0) + 1;
    return () => {
      window.__pocEditorUnmounts = (window.__pocEditorUnmounts ?? 0) + 1;
    };
  }
  window.__pocBoardMounts = (window.__pocBoardMounts ?? 0) + 1;
  return () => {
    window.__pocBoardUnmounts = (window.__pocBoardUnmounts ?? 0) + 1;
  };
}

function EditorPanel(_props: IDockviewPanelProps) {
  const ready = useContext(PocReadyContext);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => bumpMount('editor'), []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const onBlocksChange = useCallback((blocks: Block[]) => {
    if (!ready) return;
    const path = ready.scene.path;
    const body = blocksToMarkdownBody(blocks);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void window.api.writeVault(path, body).catch(() => {});
    }, 800);
  }, [ready]);

  const onDraftStateChange = useCallback(() => {}, []);
  const onLiveEditorChange = useCallback((editor: Editor | null) => {
    window.__pocEditor = editor;
    editor?.view.dom.setAttribute('aria-label', 'Writing editor');
  }, []);

  if (!ready) return null;

  return (
    <div className="dockview-poc__panel" data-testid="dockview-poc-editor">
      <BlockEditor
        scene={ready.scene}
        onBlocksChange={onBlocksChange}
        onDraftStateChange={onDraftStateChange}
        onLiveEditorChange={onLiveEditorChange}
        autoFocus={false}
      />
    </div>
  );
}

function BoardPanel(_props: IDockviewPanelProps) {
  const ready = useContext(PocReadyContext);
  useEffect(() => bumpMount('board'), []);
  if (!ready) return null;
  return (
    <div className="dockview-poc__board" data-testid="dockview-poc-board">
      <BoardsTabPanel notesVaultRoot={ready.notesVaultPath} notesVaultValid />
    </div>
  );
}

function isManifest(value: unknown): value is Manifest {
  return !!value && typeof value === 'object' && 'stories' in value && Array.isArray((value as Manifest).stories);
}

function firstScene(manifest: Manifest): Scene | null {
  for (const story of manifest.stories) {
    const fromParts = (story.parts ?? []).flatMap((part) => part.chapters ?? []);
    const chapters = [...(story.chapters ?? []), ...fromParts];
    for (const chapter of chapters) {
      const scene = chapter.scenes[0];
      if (scene) return scene;
    }
  }
  return null;
}

async function ensureScene(storyVaultPath: string): Promise<Scene> {
  const raw = await window.api.readManifest();
  const base: Manifest = isManifest(raw)
    ? raw
    : {
        version: '2.0.0',
        vaultRoot: storyVaultPath,
        stories: [],
        entities: [],
        suggestions: [],
        scenes: [],
        chapters: [],
      };
  const existing = firstScene(base);
  if (existing) return existing;

  const stamp = new Date().toISOString();
  const storyId = crypto.randomUUID();
  const chapterId = crypto.randomUUID();
  const sceneId = crypto.randomUUID();
  const blockId = crypto.randomUUID();
  const scene: Scene = {
    id: sceneId,
    title: 'Untitled Scene',
    path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
    order: 0,
    chapterId,
    storyId,
    blocks: [{ id: blockId, type: 'prose', content: '', order: 0, updatedAt: stamp }],
    draftState: 'in-progress',
    createdAt: stamp,
    updatedAt: stamp,
  };
  const chapter: Chapter = {
    id: chapterId,
    title: 'Chapter 1',
    path: `stories/${storyId}/chapters/${chapterId}`,
    order: 0,
    scenes: [scene],
    createdAt: stamp,
    updatedAt: stamp,
  };
  const part: Part = {
    id: crypto.randomUUID(),
    title: '',
    order: 0,
    note: [],
    chapters: [chapter],
    createdAt: stamp,
    updatedAt: stamp,
  };
  const story: Story = {
    id: storyId,
    title: 'Dockview Poc',
    path: `stories/${storyId}`,
    parts: [part],
    chapters: [chapter],
    createdAt: stamp,
    updatedAt: stamp,
  };
  const next: Manifest = { ...base, vaultRoot: base.vaultRoot || storyVaultPath, stories: [...base.stories, story] };
  await window.api.writeVault(scene.path, '');
  await window.api.writeManifest(stripManifestContentForIpc(next));
  return scene;
}

function floatEditor(api: DockviewApi): void {
  const panel = api.getPanel('editor');
  if (!panel) return;
  api.addFloatingGroup(panel, { x: 64, y: 56, width: 640, height: 460 });
}

function dockEditor(api: DockviewApi): void {
  const editor = api.getPanel('editor');
  const board = api.getPanel('board');
  if (!editor || !board) return;
  editor.api.moveTo({ group: board.api.group, position: 'left' });
}

function PocTab({ api }: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState(api.title);
  useEffect(() => {
    const sub = api.onDidTitleChange((event) => { setTitle(event.title); });
    return () => { sub.dispose(); };
  }, [api]);
  return <span className="dv-default-tab-content">{title ?? api.id}</span>;
}

function PocHeaderActions({ panels }: IDockviewHeaderActionsProps) {
  return (
    <>
      {panels.map((panel) => (
        <button
          key={panel.id}
          type="button"
          className="dockview-poc__close"
          aria-label={`Close ${panel.title ?? panel.id}`}
          onClick={() => { panel.api.close(); }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ))}
    </>
  );
}

function isSashTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.dv-sash');
}

function rememberEditorSelection(): { from: number; to: number } | null {
  const editor = window.__pocEditor;
  const dom = editor?.view.dom;
  if (!editor || !dom) return null;
  const active = document.activeElement;
  if (active !== dom && !dom.contains(active)) return null;
  return { from: editor.state.selection.from, to: editor.state.selection.to };
}

function restoreEditorSelection(selection: { from: number; to: number }): void {
  const editor = window.__pocEditor;
  if (!editor) return;
  const size = editor.state.doc.content.size;
  const from = Math.min(selection.from, size);
  const to = Math.min(Math.max(selection.to, from), size);
  editor.view.focus();
  if (editor.state.selection.from !== from || editor.state.selection.to !== to) {
    editor.commands.setTextSelection({ from, to });
  }
}

function DockviewLayout({ ready }: { ready: PocReady }) {
  const apiRef = useRef<DockviewApi | null>(null);
  const opened = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sashSelection = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    const root = gridRef.current;
    if (!root) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!isSashTarget(event.target)) return;
      event.preventDefault();
      const selection = rememberEditorSelection();
      if (selection) sashSelection.current = selection;
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!isSashTarget(event.target)) return;
      event.preventDefault();
      const selection = rememberEditorSelection();
      if (selection) sashSelection.current = selection;
    };
    const onPointerUp = () => {
      const selection = sashSelection.current;
      sashSelection.current = null;
      if (selection) restoreEditorSelection(selection);
    };
    root.addEventListener('pointerdown', onPointerDown, true);
    root.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, []);

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    if (opened.current) return;
    opened.current = true;
    // renderer:'always' keeps the panel's React tree mounted while it is
    // hidden behind another tab. 'onlyWhenVisible' (the library default)
    // tears the content down. Pointer drag is the strategy Electron on
    // Linux can drive; HTML5 drag is unreliable in this webview.
    event.api.addPanel({
      id: 'editor',
      component: 'editor',
      title: 'Writing editor',
      renderer: 'always',
    });
    event.api.addPanel({
      id: 'board',
      component: 'board',
      title: 'Board',
      renderer: 'always',
      position: { referencePanel: 'editor', direction: 'right' },
    });
  };

  return (
    <PocReadyContext.Provider value={ready}>
      <div className="dockview-poc dockview-theme-dark" data-testid="dockview-poc">
        <div className="dockview-poc__bar">
          <button type="button" data-testid="poc-float-editor" onClick={() => { if (apiRef.current) floatEditor(apiRef.current); }}>
            Float editor
          </button>
          <button type="button" data-testid="poc-dock-editor" onClick={() => { if (apiRef.current) dockEditor(apiRef.current); }}>
            Dock editor
          </button>
        </div>
        <div className="dockview-poc__grid" ref={gridRef}>
          <DockviewReact
            className="dockview-theme-dark"
            components={PANEL_COMPONENTS}
            defaultTabComponent={PocTab}
            rightHeaderActionsComponent={PocHeaderActions}
            onReady={onReady}
            dndStrategy="pointer"
            defaultRenderer="always"
          />
        </div>
      </div>
    </PocReadyContext.Provider>
  );
}

export default function DockviewPoc() {
  const [ready, setReady] = useState<PocReady | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const paths = await window.api.vaultGetPaths();
      const scene = await ensureScene(paths.storyVaultPath);
      if (cancelled) return;
      setReady({
        scene,
        notesVaultPath: paths.notesVaultPath,
        storyVaultPath: paths.storyVaultPath,
      });
    }
    load().catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div className="dockview-poc__status" data-testid="dockview-poc-error">{error}</div>;
  }
  if (!ready) {
    return <div className="dockview-poc__status" data-testid="dockview-poc-loading">Loading dockview proof of concept…</div>;
  }
  return <DockviewLayout ready={ready} />;
}
