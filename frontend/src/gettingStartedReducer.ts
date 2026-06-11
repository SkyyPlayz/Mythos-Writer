export type GsItemKey = 'write-scene' | 'add-character' | 'brainstorm' | 'notes-vault';

export interface GsState {
  completedItems: GsItemKey[];
  dismissed: boolean;
}

export type GsAction =
  | { type: 'CHECK_ITEM'; item: GsItemKey }
  | { type: 'DISMISS' }
  | { type: 'RESET' };

export const GS_ITEMS: { key: GsItemKey; label: string }[] = [
  { key: 'write-scene', label: 'Write your first scene' },
  { key: 'add-character', label: 'Add a character' },
  { key: 'brainstorm', label: 'Try Brainstorm' },
  { key: 'notes-vault', label: 'Explore your Notes Vault' },
];

export function makeInitialGsState(
  persisted?: { completedItems: string[]; dismissed: boolean } | null,
): GsState {
  if (!persisted) return { completedItems: [], dismissed: false };
  const valid: GsItemKey[] = ['write-scene', 'add-character', 'brainstorm', 'notes-vault'];
  return {
    completedItems: persisted.completedItems.filter((k): k is GsItemKey => valid.includes(k as GsItemKey)),
    dismissed: persisted.dismissed,
  };
}

export function gsReducer(state: GsState, action: GsAction): GsState {
  switch (action.type) {
    case 'CHECK_ITEM': {
      if (state.dismissed) return state;
      if (state.completedItems.includes(action.item)) return state;
      const completedItems: GsItemKey[] = [...state.completedItems, action.item];
      const allDone = completedItems.length === GS_ITEMS.length;
      return { completedItems, dismissed: allDone };
    }
    case 'DISMISS':
      return { ...state, dismissed: true };
    case 'RESET':
      return { completedItems: [], dismissed: false };
    default:
      return state;
  }
}
