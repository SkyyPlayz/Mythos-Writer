// Writing mode state — per-project persistence via SQLite project_settings table.
// Modes: normal (default) | focus (distraction-free) | edit (review layers visible).

import { getProjectSetting, setProjectSetting } from './db.js';
import type { WritingMode, FocusModeFlags, EditModeConfig, WritingModeState, WritingModeSetPayload } from './ipc.js';

const VALID_MODES: ReadonlySet<string> = new Set(['normal', 'focus', 'edit']);

const DEFAULT_FOCUS_FLAGS: FocusModeFlags = {
  sidebar: false,
  toolbar: false,
  wordCount: true,
  minimap: false,
};

const DEFAULT_EDIT_CONFIG: EditModeConfig = {
  showWritingAssistant: true,
  showArchive: true,
  showBetaRead: true,
};

function isValidMode(v: unknown): v is WritingMode {
  return typeof v === 'string' && VALID_MODES.has(v);
}

export function getWritingModeState(): WritingModeState {
  const modeRaw = getProjectSetting('writingMode');
  const mode: WritingMode = isValidMode(modeRaw) ? modeRaw : 'normal';

  const focusFlagsRaw = getProjectSetting('focusModeFlags');
  let focusFlags: FocusModeFlags = { ...DEFAULT_FOCUS_FLAGS };
  if (focusFlagsRaw) {
    try {
      focusFlags = { ...DEFAULT_FOCUS_FLAGS, ...(JSON.parse(focusFlagsRaw) as Partial<FocusModeFlags>) };
    } catch { /* corrupt value — use defaults */ }
  }

  const editConfigRaw = getProjectSetting('editModeConfig');
  let editConfig: EditModeConfig = { ...DEFAULT_EDIT_CONFIG };
  if (editConfigRaw) {
    try {
      editConfig = { ...DEFAULT_EDIT_CONFIG, ...(JSON.parse(editConfigRaw) as Partial<EditModeConfig>) };
    } catch { /* corrupt value — use defaults */ }
  }

  return { mode, focusFlags, editConfig };
}

export function setWritingModeState(payload: WritingModeSetPayload): WritingModeState {
  if (payload.mode !== undefined) {
    if (!isValidMode(payload.mode)) {
      throw new Error(`Invalid writingMode: "${payload.mode}". Must be normal | focus | edit.`);
    }
    setProjectSetting('writingMode', payload.mode);
  }

  if (payload.focusFlags !== undefined) {
    const current = getWritingModeState();
    const merged: FocusModeFlags = { ...current.focusFlags, ...payload.focusFlags };
    setProjectSetting('focusModeFlags', JSON.stringify(merged));
  }

  if (payload.editConfig !== undefined) {
    const current = getWritingModeState();
    const merged: EditModeConfig = { ...current.editConfig, ...payload.editConfig };
    setProjectSetting('editModeConfig', JSON.stringify(merged));
  }

  return getWritingModeState();
}
