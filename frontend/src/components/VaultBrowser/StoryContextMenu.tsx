import { ContextMenu as LNContextMenu } from '../ui/Menu';
import type { ExportScope } from '../../ExportDialog';

type ItemKind = 'story' | 'chapter' | 'scene';

interface Props {
  x: number;
  y: number;
  kind: ItemKind;
  storyId: string;
  chapterId?: string;
  sceneId?: string;
  onClose: () => void;
  onExport: (scope: ExportScope) => void;
}

export default function StoryContextMenu({
  x,
  y,
  kind,
  storyId,
  chapterId,
  sceneId,
  onClose,
  onExport,
}: Props) {
  // Menu already calls onClose() after invoking onAction.
  const handleAction = (id: string) => {
    if (id === 'export') {
      let scope: ExportScope;
      if (kind === 'scene' && sceneId) {
        scope = { kind: 'scene', sceneId };
      } else if (kind === 'chapter' && chapterId) {
        scope = { kind: 'chapter', chapterId, storyId };
      } else {
        scope = { kind: 'story', storyId };
      }
      onExport(scope);
    }
  };

  return (
    <LNContextMenu
      open
      position={{ x, y }}
      onClose={onClose}
      onAction={handleAction}
      items={[{ id: 'export', label: 'Export…' }]}
      data-testid="story-context-menu"
    />
  );
}
