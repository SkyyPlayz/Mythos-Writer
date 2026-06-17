export const CHECKLIST_ITEM_IDS = ['write-scene', 'add-character', 'brainstorm', 'notes-vault'] as const;

export type GettingStartedItemId = (typeof CHECKLIST_ITEM_IDS)[number];
export type OnboardingStartMode = 'blank' | 'sample' | 'template' | 'skip' | 'default-mythos-vault' | 'open-existing';

export interface GettingStartedProgress {
  completedItems: GettingStartedItemId[];
  dismissed: boolean;
  collapsed?: boolean;
}

type LegacyItemId = 'writeScene' | 'addCharacter' | 'openNotes';
type AnyItemId = GettingStartedItemId | LegacyItemId;

type PartialProgress = Partial<GettingStartedProgress> & {
  completed?: Partial<Record<LegacyItemId | GettingStartedItemId, boolean>>;
};

export type GettingStartedAction =
  | { type: 'CHECK_ITEM'; itemId: AnyItemId }
  | { type: 'DISMISS' }
  | { type: 'TOGGLE_COLLAPSE' }
  | { type: 'RESET'; onboardingStartMode?: OnboardingStartMode };

const LEGACY_ID_MAP: Record<LegacyItemId, GettingStartedItemId> = {
  writeScene: 'write-scene',
  addCharacter: 'add-character',
  openNotes: 'notes-vault',
};

function normalizeItemId(itemId: AnyItemId): GettingStartedItemId {
  return itemId in LEGACY_ID_MAP ? LEGACY_ID_MAP[itemId as LegacyItemId] : itemId as GettingStartedItemId;
}

function normalizeCompleted(existing?: PartialProgress | null): GettingStartedItemId[] {
  const completed = new Set<GettingStartedItemId>();
  for (const item of existing?.completedItems ?? []) {
    if ((CHECKLIST_ITEM_IDS as readonly string[]).includes(item)) completed.add(item);
  }
  for (const [item, done] of Object.entries(existing?.completed ?? {})) {
    if (done) completed.add(normalizeItemId(item as AnyItemId));
  }
  return CHECKLIST_ITEM_IDS.filter((item) => completed.has(item));
}

export function createInitialGettingStartedProgress(
  _now?: string,
  onboardingStartMode?: OnboardingStartMode,
  existing?: PartialProgress | null,
): GettingStartedProgress {
  if (onboardingStartMode === 'skip') {
    return { completedItems: [], dismissed: true };
  }
  const completedItems = normalizeCompleted(existing);
  return {
    completedItems,
    collapsed: existing?.collapsed ?? false,
    dismissed: existing?.dismissed ?? completedItems.length === CHECKLIST_ITEM_IDS.length,
  };
}

export function isGettingStartedComplete(progress: GettingStartedProgress): boolean {
  return CHECKLIST_ITEM_IDS.every((item) => progress.completedItems.includes(item));
}

export function isGettingStartedVisible(progress?: GettingStartedProgress | null): boolean {
  return !!progress && !progress.dismissed && !isGettingStartedComplete(progress);
}

export function gettingStartedReducer(
  state: GettingStartedProgress,
  action: GettingStartedAction,
): GettingStartedProgress {
  switch (action.type) {
    case 'CHECK_ITEM': {
      const itemId = normalizeItemId(action.itemId);
      const completedItems = state.completedItems.includes(itemId)
        ? state.completedItems
        : CHECKLIST_ITEM_IDS.filter((item) => item === itemId || state.completedItems.includes(item));
      const next = { ...state, completedItems };
      return isGettingStartedComplete(next) ? { ...next, dismissed: true } : next;
    }
    case 'DISMISS':
      return { ...state, dismissed: true };
    case 'TOGGLE_COLLAPSE':
      return { ...state, collapsed: !state.collapsed };
    case 'RESET':
      return createInitialGettingStartedProgress(undefined, action.onboardingStartMode);
    default:
      return state;
  }
}
