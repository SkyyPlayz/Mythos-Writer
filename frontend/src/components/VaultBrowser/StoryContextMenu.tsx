import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ExportScope } from '../../ExportDialog';
type ItemKind = 'story' | 'chapter' | 'scene';
interface Props { x: number; y: number; kind: ItemKind; storyId: string; chapterId?: string; sceneId?: string; onClose: () => void; onExport: (scope: ExportScope) => void; }
export default function StoryContextMenu({ x, y, kind, storyId, chapterId, sceneId, onClose, onExport }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', d); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', d); document.removeEventListener('keydown', k); };
  }, [onClose]);
  const go = () => {
    let s: ExportScope;
    if (kind === 'scene' && sceneId) s = { kind: 'scene', sceneId };
    else if (kind === 'chapter' && chapterId) s = { kind: 'chapter', chapterId, storyId };
    else s = { kind: 'story', storyId };
    onExport(s); onClose();
  };
  return createPortal(
    <div ref={ref} className="vb-context-menu" style={{ position: 'fixed', top: y, left: x, zIndex: 9999 }} role="menu" data-testid="story-context-menu">
      <button className="vb-context-item" role="menuitem" onClick={go}>Export…</button>
    </div>, document.body);
}
