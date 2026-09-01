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
