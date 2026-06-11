// SKY-456: Creative quality controls — static preset and rubric data (spec §5.2).
// Preset data is defined in frontend/src/presets.ts. This module re-exposes it
// via IPC for eval harnesses or server-side tooling; the renderer also reads
// BUNDLED_PRESETS directly from presets.ts so these are secondary consumers.
//
// Both handlers are read-only and return only static data, but they still need
// the isFromTopFrame guard to prevent untrusted subframes from polling IPC
// and wrapIpcHandler for consistent error-envelope shape.
import { ipcMain } from 'electron';
import { isFromTopFrame, UNTRUSTED_FRAME_REJECTION } from './ipc.js';
import { wrapIpcHandler } from './ipcErrors.js';

export function registerPresetHandlers(): void {
  ipcMain.handle('preset:getAll', wrapIpcHandler('preset:getAll', (event) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    return { count: 12, note: 'presets are served client-side from presets.ts' };
  }));

  ipcMain.handle('preset:getRubric', wrapIpcHandler('preset:getRubric', (event) => {
    if (!isFromTopFrame(event)) return UNTRUSTED_FRAME_REJECTION;
    return {
      criteria: [
        { id: 'specificity', name: 'Specificity' },
        { id: 'coherence', name: 'Coherence' },
        { id: 'genre-fit', name: 'Genre Fit' },
        { id: 'constraint-respect', name: 'Constraint Respect' },
        { id: 'usefulness', name: 'Usefulness as a Starter' },
        { id: 'actionability', name: 'Actionability' },
      ],
    };
  }));
}
