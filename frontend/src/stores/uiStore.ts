import { create } from 'zustand';
import type { LayoutPrefs, WritingMode } from '../types';

export type AppView = 'editor' | 'brainstorm' | 'kanban' | 'graph';

export const DEFAULT_LAYOUT: LayoutPrefs = {
  leftWidth: 240,
  rightWidth: 260,
  bottomHeight: 32,
  rightTab: 'notes',
  leftTab: 'stories',
};

export interface UIState {
  view: AppView;
  layout: LayoutPrefs;
  writingMode: WritingMode;
  openModals: string[];
  toasts: string[];
  setView: (view: AppView) => void;
  setLayout: (layout: LayoutPrefs) => void;
  setWritingMode: (mode: WritingMode) => void;
  openModal: (modal: string) => void;
  closeModal: (modal: string) => void;
  addToast: (toast: string) => void;
  removeToast: (toast: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  view: 'editor',
  layout: DEFAULT_LAYOUT,
  writingMode: 'normal',
  openModals: [],
  toasts: [],
  setView: (view) => set({ view }),
  setLayout: (layout) => set({ layout, writingMode: layout.writingMode ?? 'normal' }),
  setWritingMode: (writingMode) =>
    set((state) => {
      let layout: LayoutPrefs = { ...state.layout, writingMode };
      if (writingMode === 'edit') {
        layout = { ...layout, leftTab: 'review', rightTab: 'ai' };
      }
      return { writingMode, layout };
    }),
  openModal: (modal) =>
    set((state) => ({
      openModals: state.openModals.includes(modal) ? state.openModals : [...state.openModals, modal],
    })),
  closeModal: (modal) =>
    set((state) => ({ openModals: state.openModals.filter((m) => m !== modal) })),
  addToast: (toast) => set((state) => ({ toasts: [...state.toasts, toast] })),
  removeToast: (toast) => set((state) => ({ toasts: state.toasts.filter((t) => t !== toast) })),
}));
