import { useState, useRef, useCallback, useEffect } from 'react';
import type { Block, BlockType, Scene, DraftState } from './types';
import './BlockEditor.css';

interface Props {
  scene: Scene;
  onBlocksChange: (blocks: Block[]) => void;
  onDraftStateChange: (state: DraftState) => void;
}

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  prose: 'Paragraph',
  heading: 'Heading',
  dialogue: 'Dialogue',
  action: 'Action',
  description: 'Description',
  note: 'Note',
};

const DRAFT_STATE_LABELS: Record<DraftState, string> = {
  'in-progress': 'In Progress',
  review: 'Review',
  final: 'Final',
};

function generateId(): string {
  return crypto.randomUUID();
}

function newBlock(type: BlockType = 'prose', order: number = 0): Block {
  return { id: generateId(), type, content: '', order, updatedAt: new Date().toISOString() };
}

interface BlockRowProps {
  block: Block;
  isFocused: boolean;
  isSelected: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (content: string) => void;
  onTypeChange: (type: BlockType) => void;
  onEnterKey: () => void;
  onDelete: () => void;
  onDoubleClick: () => void;
  dragHandleProps: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

function BlockRow({
  block,
  isFocused,
  isSelected,
  onFocus,
  onBlur,
  onChange,
  onTypeChange,
  onEnterKey,
  onDelete,
  onDoubleClick,
  dragHandleProps,
}: BlockRowProps) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    if (isFocused && ref.current) {
      ref.current.focus();
    }
  }, [isFocused]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onEnterKey();
    }
    if (e.key === 'Backspace' && block.content === '') {
      e.preventDefault();
      onDelete();
    }
    // Cmd/Ctrl+B / Cmd/Ctrl+I — let browser handle contentEditable inline formatting
    // For textarea we apply markdown markers
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      const el = ref.current as HTMLTextAreaElement | null;
      if (!el) return;
      const { selectionStart: s, selectionEnd: en, value } = el;
      const selected = value.slice(s, en);
      const replacement = `**${selected}**`;
      const next = value.slice(0, s) + replacement + value.slice(en);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = s + 2;
        el.selectionEnd = en + 2;
      });
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      const el = ref.current as HTMLTextAreaElement | null;
      if (!el) return;
      const { selectionStart: s, selectionEnd: en, value } = el;
      const selected = value.slice(s, en);
      const replacement = `_${selected}_`;
      const next = value.slice(0, s) + replacement + value.slice(en);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = s + 1;
        el.selectionEnd = en + 1;
      });
    }
  };

  const rows = block.type === 'heading' ? undefined : Math.max(1, Math.ceil(block.content.length / 80) + 1);

  return (
    <div
      className={`block-row block-type-${block.type}${isSelected ? ' block-selected' : ''}`}
      {...dragHandleProps}
    >
      <div className="block-drag-handle" title="Drag to reorder">⠿</div>
      <div className="block-type-badge">
        <select
          value={block.type}
          onChange={(e) => onTypeChange(e.target.value as BlockType)}
          tabIndex={-1}
          className="block-type-select"
        >
          {(Object.keys(BLOCK_TYPE_LABELS) as BlockType[]).map((t) => (
            <option key={t} value={t}>{BLOCK_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>
      {block.type === 'heading' ? (
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          className="block-input block-heading-input"
          type="text"
          value={block.content}
          placeholder="Heading…"
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          onDoubleClick={onDoubleClick}
        />
      ) : (
        <textarea
          ref={ref as React.Ref<HTMLTextAreaElement>}
          className="block-input"
          value={block.content}
          placeholder={`${BLOCK_TYPE_LABELS[block.type]}…`}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          onDoubleClick={onDoubleClick}
        />
      )}
    </div>
  );
}

export default function BlockEditor({ scene, onBlocksChange, onDraftStateChange }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(
    scene.blocks.length > 0 ? [...scene.blocks].sort((a, b) => a.order - b.order) : [newBlock('prose', 0)]
  );
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [focusMode, setFocusMode] = useState<string | null>(null); // block id
  const [draftState, setDraftState] = useState<DraftState>(scene.draftState ?? 'in-progress');
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null);
  const changeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync when scene switches
  useEffect(() => {
    const sorted = scene.blocks.length > 0
      ? [...scene.blocks].sort((a, b) => a.order - b.order)
      : [newBlock('prose', 0)];
    setBlocks(sorted);
    setDraftState(scene.draftState ?? 'in-progress');
    setFocusedIdx(null);
    setFocusMode(null);
  }, [scene.id]);

  const pushChange = useCallback((updated: Block[]) => {
    if (changeRef.current) clearTimeout(changeRef.current);
    changeRef.current = setTimeout(() => {
      onBlocksChange(updated);
    }, 800);
  }, [onBlocksChange]);

  const updateBlock = (idx: number, patch: Partial<Block>) => {
    setBlocks((prev) => {
      const next = prev.map((b, i) => i === idx ? { ...b, ...patch, updatedAt: new Date().toISOString() } : b);
      pushChange(next);
      return next;
    });
  };

  const addBlockAfter = (idx: number) => {
    setBlocks((prev) => {
      const insertAt = idx + 1;
      const nb = newBlock('prose', insertAt);
      const next = [
        ...prev.slice(0, insertAt),
        nb,
        ...prev.slice(insertAt).map((b, i) => ({ ...b, order: insertAt + 1 + i })),
      ].map((b, i) => ({ ...b, order: i }));
      pushChange(next);
      setFocusedIdx(insertAt);
      return next;
    });
  };

  const deleteBlock = (idx: number) => {
    setBlocks((prev) => {
      if (prev.length === 1) return prev; // keep at least one
      const next = prev.filter((_, i) => i !== idx).map((b, i) => ({ ...b, order: i }));
      pushChange(next);
      setFocusedIdx(Math.max(0, idx - 1));
      return next;
    });
  };

  const handleDraftChange = (state: DraftState) => {
    setDraftState(state);
    onDraftStateChange(state);
  };

  // Drag-and-drop reorder
  const handleDragStart = (idx: number) => setDragSrcIdx(idx);
  const handleDrop = (targetIdx: number) => {
    if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
    setBlocks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragSrcIdx, 1);
      next.splice(targetIdx, 0, moved);
      const reordered = next.map((b, i) => ({ ...b, order: i }));
      pushChange(reordered);
      return reordered;
    });
    setDragSrcIdx(null);
  };

  const focusModeBlock = focusMode ? blocks.find((b) => b.id === focusMode) : null;

  if (focusModeBlock) {
    const idx = blocks.findIndex((b) => b.id === focusMode);
    return (
      <div className="focus-mode">
        <div className="focus-mode-header">
          <button className="focus-exit-btn" onClick={() => setFocusMode(null)}>← Exit focus</button>
          <span className="focus-scene-title">{scene.title}</span>
        </div>
        <div className="focus-mode-body">
          <textarea
            className="focus-textarea"
            value={focusModeBlock.content}
            autoFocus
            onChange={(e) => updateBlock(idx, { content: e.target.value })}
            placeholder={`${BLOCK_TYPE_LABELS[focusModeBlock.type]}…`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="block-editor">
      <div className="block-editor-toolbar">
        <span className="scene-name">{scene.title}</span>
        <div className="draft-state-group">
          {(Object.keys(DRAFT_STATE_LABELS) as DraftState[]).map((s) => (
            <button
              key={s}
              className={`draft-btn draft-${s}${draftState === s ? ' active' : ''}`}
              onClick={() => handleDraftChange(s)}
            >
              {DRAFT_STATE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="blocks-list">
        {blocks.map((block, idx) => (
          <BlockRow
            key={block.id}
            block={block}
            isFocused={focusedIdx === idx}
            isSelected={focusedIdx === idx}
            onFocus={() => setFocusedIdx(idx)}
            onBlur={() => setFocusedIdx((prev) => (prev === idx ? null : prev))}
            onChange={(content) => updateBlock(idx, { content })}
            onTypeChange={(type) => updateBlock(idx, { type })}
            onEnterKey={() => addBlockAfter(idx)}
            onDelete={() => deleteBlock(idx)}
            onDoubleClick={() => setFocusMode(block.id)}
            dragHandleProps={{
              draggable: true,
              onDragStart: () => handleDragStart(idx),
              onDragOver: (e) => e.preventDefault(),
              onDrop: () => handleDrop(idx),
            }}
          />
        ))}
      </div>

      <button className="add-block-btn" onClick={() => addBlockAfter(blocks.length - 1)}>
        + Add block
      </button>
    </div>
  );
}
