// #1765 — the one error type importers throw when the message is written for
// the writer. importHubIpc shows `userMessage` as-is (after path scrubbing);
// anything else an importer throws is unexpected and gets the generic
// "may be damaged" text, so stack traces and paths never reach the UI.

/**
 * An import failure whose message is written for the writer (plain language,
 * no paths) and may be shown as-is.
 */
export class ImportUserError extends Error {
  readonly userMessage: string;

  constructor(message: string) {
    super(message);
    this.name = 'ImportUserError';
    this.userMessage = message;
  }
}
