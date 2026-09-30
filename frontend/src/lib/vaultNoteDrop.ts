/**
 * F2#4 / Shield R1–R3 / Critic H5 — explorer → editor wiki-link drop.
 * Used from TipTap `editorProps.handleDrop` (not a React wrapper onDrop).
 */
import type { EditorView } from '@tiptap/pm/view';
import { VAULT_NOTE_DRAG_MIME, wikiTitleFromDroppedPath } from '../vaultNoteDrag';

function typesOf(dt: DataTransfer | null): string[] {
  if (!dt?.types) return [];
  return [...dt.types];
}

/** dragover: accept explorer MIME with dropEffect compatible with effectAllowed=move. */
export function handleVaultNoteDragOver(view: EditorView, event: DragEvent): boolean {
  if (view.editable === false) return false;
  if (event.defaultPrevented) return false;
  const types = typesOf(event.dataTransfer);
  const hasExplorer = types.includes(VAULT_NOTE_DRAG_MIME);
  const hasFiles = types.includes('Files');
  if (!hasExplorer && !hasFiles) return false;
  event.preventDefault();
  if (event.dataTransfer) {
    // Explorer sets effectAllowed='move' — 'copy' would make the drop a no-op.
    event.dataTransfer.dropEffect = hasExplorer ? 'move' : 'none';
  }
  return true;
}

/**
 * handleDrop: return true to consume.
 * - Bail on in-editor drag (`moved` / `view.dragging`)
 * - Files → preventDefault (block OS navigation), no link
 * - Explorer MIME + path-shaped payload → insert [[Note]]
 */
export function handleVaultNoteDrop(
  view: EditorView,
  event: DragEvent,
  _slice: unknown,
  moved: boolean,
): boolean {
  if (moved || view.dragging) return false;
  if (event.defaultPrevented) return false;

  const types = typesOf(event.dataTransfer);
  if (types.includes('Files')) {
    event.preventDefault();
    event.stopPropagation();
    // Only Files (no explorer MIME) — block nav, no link.
    if (!types.includes(VAULT_NOTE_DRAG_MIME)) return true;
  }

  if (!types.includes(VAULT_NOTE_DRAG_MIME)) return false;

  const raw = (
    event.dataTransfer?.getData(VAULT_NOTE_DRAG_MIME)
    || event.dataTransfer?.getData('text/plain')
    || ''
  ).trim();
  const title = wikiTitleFromDroppedPath(raw);
  if (!title) {
    event.preventDefault();
    return true;
  }

  const nodeType = view.state.schema.nodes.wikiLink;
  if (!nodeType) return false;

  event.preventDefault();
  event.stopPropagation();

  let pos = view.state.selection.from;
  try {
    pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? pos;
  } catch {
    // jsdom / headless
  }
  const node = nodeType.create({ target: title });
  view.dispatch(view.state.tr.insert(pos, node));
  view.focus();
  return true;
}
