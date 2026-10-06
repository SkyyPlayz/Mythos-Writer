/**
 * PLAN-058 L3 (75:08 / FD-7): Boards canvas tool definitions with prototype SVG
 * paths (Liquid Neon `bdToolDefs`). Icons replace text-only crumb-bar labels.
 */
import type { ReactElement } from 'react';
import type { BoardTool } from './BoardCanvas';

function BoardToolSvg({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export interface BoardCanvasToolDef {
  id: BoardTool;
  label: string;
  title: string;
  icon: ReactElement;
}

/** Left-rail tools — pan, select, vault placement, connectors (prototype order). */
export const BOARD_CANVAS_TOOLS: readonly BoardCanvasToolDef[] = [
  {
    id: 'pan',
    label: 'Pan',
    title: 'Drag empty canvas to pan · Alt-drag works with any tool',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 12.5V7a1.5 1.5 0 0 1 3 0v5" />
        <path d="M11 11.5V6a1.5 1.5 0 0 1 3 0v6" />
        <path d="M14 12V8.5a1.5 1.5 0 0 1 3 0V16a5 5 0 0 1-5 5h-.8a5 5 0 0 1-5-5v-2.6L5 11.4a1.5 1.5 0 0 1 2.4-1.8L8 10.4" />
      </svg>
    ),
  },
  {
    id: 'select',
    label: 'Select',
    title: 'Select and move items · Shift/Ctrl-click to multi-select',
    icon: <BoardToolSvg d="M5.5 3.5l13.5 7.6-6 1.6-2.2 5.8z" />,
  },
  {
    id: 'note',
    label: 'Note',
    title: 'Click the canvas to create a vault note',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3.2" />
        <path d="M8 9.5h8M8 13h5" />
      </svg>
    ),
  },
  {
    id: 'board',
    label: 'Board',
    title: 'Click the canvas to create a vault folder',
    icon: (
      <BoardToolSvg
        d="M3.5 3.5h7v7h-7z M13.5 3.5h7v7h-7z M3.5 13.5h7v7h-7z M13.5 13.5h7v7h-7z"
      />
    ),
  },
  {
    id: 'line',
    label: 'Line',
    title: 'Click two cards or furniture items to connect them',
    icon: <BoardToolSvg d="M4 20L19 5 M13 5h6v6" />,
  },
];

export const BOARD_ACCENT_PALETTE = ['#00f0ff', '#9b5fff', '#ff4dff', '#2fe6c8'] as const;
