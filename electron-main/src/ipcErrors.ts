// IPC error sanitization (MYT-790).
// Prevents host details — absolute paths, fs syscall text, Node internal error
// codes — from leaking to the renderer. Pattern mirrors streaming.ts:
// classify → fixed user-facing message → raw text stays in main-process logs.
//
// Trusted callers can opt out of sanitization by throwing a `SafeIpcError`;
// its `.message` is forwarded unchanged. Use that for user-meaningful messages
// that you have already vetted (e.g. "Brainstorm Agent paused: hourly cap").

export const IPC_ERROR_CATEGORIES = {
  PATH_DENIED: 'path_denied',
  NOT_FOUND: 'not_found',
  PERMISSION_DENIED: 'permission_denied',
  INVALID_INPUT: 'invalid_input',
  INTERNAL: 'internal',
} as const;

export type IpcErrorCategory = (typeof IPC_ERROR_CATEGORIES)[keyof typeof IPC_ERROR_CATEGORIES];

/**
 * Marker class for errors whose `.message` has been vetted as safe to forward
 * to the renderer (no absolute paths, no fs syscall codes, no host details).
 * Errors of this type pass through the IPC sanitizer unchanged.
 */
export class SafeIpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeIpcError';
  }
}

const FS_NOT_FOUND_CODES = new Set(['ENOENT', 'ENOTDIR']);
const FS_PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);
const FS_INVALID_CODES = new Set(['EISDIR', 'ENAMETOOLONG', 'EINVAL']);

// Path-shape patterns that indicate a host-absolute path has leaked into the
// message string. Matches POSIX (/Users/, /home/, /private/, /var/), Windows
// (C:\, D:/), and UNC shares (\\server\share).
const ABSOLUTE_PATH_PATTERNS: readonly RegExp[] = [
  /\/Users\//,
  /\/home\//,
  /\/private\//,
  /\/var\//,
  /\/tmp\//,
  /[A-Za-z]:[\\/]/,
  /\\\\[^\\]+\\/,
];

function looksLikePathLeak(message: string): boolean {
  return ABSOLUTE_PATH_PATTERNS.some((re) => re.test(message));
}

export type IpcErrorClassification =
  | { kind: 'safe'; message: string }
  | { kind: 'passthrough'; message: string }
  | { kind: 'sanitized'; category: IpcErrorCategory };

/**
 * Inspect a caught error and decide how it should be returned to the renderer.
 * - `safe`        → SafeIpcError instance; forward `.message` as-is.
 * - `sanitized`   → fs / parse / traversal error; return category-based message.
 * - `passthrough` → trusted Error.message with no path/fs leakage; forward as-is.
 */
export function classifyIpcError(err: unknown): IpcErrorClassification {
  if (err instanceof SafeIpcError) {
    return { kind: 'safe', message: err.message };
  }

  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') {
    if (FS_NOT_FOUND_CODES.has(code)) return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.NOT_FOUND };
    if (FS_PERMISSION_CODES.has(code)) return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.PERMISSION_DENIED };
    if (FS_INVALID_CODES.has(code)) return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.INVALID_INPUT };
  }

  const rawMessage = (err as { message?: unknown }).message;
  const message = typeof rawMessage === 'string' ? rawMessage : '';

  if (/^Path traversal denied/i.test(message)) {
    return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.PATH_DENIED };
  }

  // fs syscall messages without a `.code` (e.g. wrapped errors) follow the
  // pattern "EXXXXX: human text, syscall '/abs/path'".
  const syscallMatch = /^(E[A-Z]+):/.exec(message);
  if (syscallMatch) {
    const sysCode = syscallMatch[1];
    if (FS_NOT_FOUND_CODES.has(sysCode)) return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.NOT_FOUND };
    if (FS_PERMISSION_CODES.has(sysCode)) return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.PERMISSION_DENIED };
    if (FS_INVALID_CODES.has(sysCode)) return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.INVALID_INPUT };
    return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.INTERNAL };
  }

  if (err instanceof SyntaxError) {
    return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.INVALID_INPUT };
  }

  if (looksLikePathLeak(message)) {
    return { kind: 'sanitized', category: IPC_ERROR_CATEGORIES.INTERNAL };
  }

  return { kind: 'passthrough', message };
}

/** Fixed user-facing message per category. Never includes host details. */
export function ipcErrorUserMessage(category: IpcErrorCategory): string {
  switch (category) {
    case IPC_ERROR_CATEGORIES.PATH_DENIED:
      return 'Path not allowed.';
    case IPC_ERROR_CATEGORIES.NOT_FOUND:
      return 'File not found.';
    case IPC_ERROR_CATEGORIES.PERMISSION_DENIED:
      return 'Permission denied.';
    case IPC_ERROR_CATEGORIES.INVALID_INPUT:
      return 'Invalid input.';
    case IPC_ERROR_CATEGORIES.INTERNAL:
      return 'Internal error.';
  }
}

/**
 * Returns the `{ error }` reply for an IPC handler, sanitized per category.
 * Logs the raw error to the main-process console only — never forwarded.
 */
export function sanitizeIpcError(channel: string, err: unknown): { error: string } {
  const classification = classifyIpcError(err);
  const rawMessage =
    typeof (err as { message?: unknown })?.message === 'string'
      ? (err as Error).message
      : String(err);
  if (classification.kind === 'sanitized') {
    // eslint-disable-next-line no-console
    console.error(
      `[ipc:error] channel=${channel} category=${classification.category} raw=${rawMessage}`,
    );
    return { error: ipcErrorUserMessage(classification.category) };
  }
  // safe / passthrough: still log so operators can correlate user reports.
  // eslint-disable-next-line no-console
  console.error(`[ipc:error] channel=${channel} kind=${classification.kind} message=${classification.message}`);
  return { error: classification.message };
}

/**
 * Wrap an arbitrary async IPC handler so any thrown error is sanitized.
 * Useful for the manually-registered `ipcMain.handle` calls in main.ts.
 */
export function wrapIpcHandler<TEvent, TPayload, TResult>(
  channel: string,
  handler: (event: TEvent, payload: TPayload) => TResult | Promise<TResult>,
): (event: TEvent, payload: TPayload) => Promise<TResult | { error: string }> {
  return async (event: TEvent, payload: TPayload) => {
    try {
      return await handler(event, payload);
    } catch (err) {
      return sanitizeIpcError(channel, err);
    }
  };
}
