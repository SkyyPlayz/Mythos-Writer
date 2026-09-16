// SKY-10995 / SKY-11090: the `window-all-closed` quit guard, extracted so the
// darwin branch is unit-testable on any platform (CI has no macOS job —
// build-macos was removed in SKY-8081 as a deliberate budget call).
//
// On macOS, closing the last window ordinarily leaves the app in the dock, so
// window-all-closed must NOT quit. But if a real quit is already underway
// (Cmd+Q, the app menu, or app.quit() called directly — e.g. by Playwright's
// Electron driver), `before-quit` has set quitRequested and the guard must let
// the final app.quit() through, or the process is left running with zero
// windows until whatever awaits it (e.g. Playwright's app.close()) times out.
export function shouldQuitOnWindowAllClosed(
  platform: NodeJS.Platform,
  quitRequested: boolean,
): boolean {
  return platform !== 'darwin' || quitRequested;
}

/**
 * 0.5.1 / 0.5.2 owner P0 (Windows quit hang): on Windows and Linux, closing
 * the window IS quitting. Mark that at the start of the BrowserWindow `close`
 * handler so `will-prevent-unload` (SKY-11363) auto-allows the unload instead
 * of parking on a modal — Brainstorm's beforeunload otherwise cancels unload
 * silently when the dialog fails / never surfaces on frameless Windows, which
 * is exactly the force-kill-from-Task-Manager symptom.
 *
 * macOS keeps the dock-resident "close window ≠ quit" path and still prompts.
 */
export function shouldCommitQuitOnWindowClose(platform: NodeJS.Platform): boolean {
  return platform !== 'darwin';
}

/**
 * Decide whether `will-prevent-unload` should allow the unload through.
 * `dialogChoice`: 0 = Leave, 1 = Stay, `error` = showMessageBoxSync threw /
 * failed (treat as Leave — an unclosable app is worse than losing a dirty
 * brainstorm draft that flush-before-quit already tried to drain).
 */
export function resolveWillPreventUnloadAction(opts: {
  quitRequested: boolean;
  dialogChoice: 0 | 1 | 'error';
}): 'allow' | 'stay' {
  if (opts.quitRequested) return 'allow';
  if (opts.dialogChoice === 'error') return 'allow';
  return opts.dialogChoice === 0 ? 'allow' : 'stay';
}
