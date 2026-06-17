// MYT-790 — verify the IPC error sanitizer never leaks absolute paths or fs
// syscall text to the renderer, while still passing through user-facing
// messages and `SafeIpcError` instances.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SafeIpcError,
  IPC_ERROR_CATEGORIES,
  classifyIpcError,
  ipcErrorUserMessage,
  sanitizeIpcError,
  withIpcLog,
  wrapIpcHandler,
} from './ipcErrors.js';

// Patterns the audit forbids in any renderer-visible error string.
const FORBIDDEN_PATH_SUBSTRINGS = ['/Users/', '/home/', '/private/', '/var/', '/tmp/', 'C:\\', 'D:\\'];

function makeFsError(code: string, syscall: string, absPath: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: ${syscall} '${absPath}'`) as NodeJS.ErrnoException;
  err.code = code;
  err.syscall = syscall;
  err.path = absPath;
  return err;
}

describe('classifyIpcError', () => {
  it('classifies ENOENT (file/path missing) as NOT_FOUND', () => {
    const err = makeFsError('ENOENT', 'open', '/Users/alice/MythosWriter/StoryVault/nonexistent.md');
    expect(classifyIpcError(err)).toEqual({
      kind: 'sanitized',
      category: IPC_ERROR_CATEGORIES.NOT_FOUND,
    });
  });

  it('classifies EACCES as PERMISSION_DENIED', () => {
    const err = makeFsError('EACCES', 'open', '/Users/alice/MythosWriter/StoryVault/manifest.json');
    expect(classifyIpcError(err)).toEqual({
      kind: 'sanitized',
      category: IPC_ERROR_CATEGORIES.PERMISSION_DENIED,
    });
  });

  it('classifies EISDIR as INVALID_INPUT', () => {
    const err = makeFsError('EISDIR', 'read', '/home/bob/vault/notes');
    expect(classifyIpcError(err)).toEqual({
      kind: 'sanitized',
      category: IPC_ERROR_CATEGORIES.INVALID_INPUT,
    });
  });

  it('classifies safePath traversal errors as PATH_DENIED', () => {
    const err = new Error('Path traversal denied: ../etc/passwd (symlink escape detected)');
    expect(classifyIpcError(err)).toEqual({
      kind: 'sanitized',
      category: IPC_ERROR_CATEGORIES.PATH_DENIED,
    });
  });

  it('classifies JSON.parse SyntaxError as INVALID_INPUT', () => {
    let caught: unknown;
    try {
      JSON.parse('{ this is invalid');
    } catch (err) {
      caught = err;
    }
    expect(classifyIpcError(caught)).toEqual({
      kind: 'sanitized',
      category: IPC_ERROR_CATEGORIES.INVALID_INPUT,
    });
  });

  it('catches fs-shaped messages without a `.code` field (defense-in-depth)', () => {
    const err = new Error("ENOENT: no such file or directory, open '/home/alice/vault/x.md'");
    expect(classifyIpcError(err)).toEqual({
      kind: 'sanitized',
      category: IPC_ERROR_CATEGORIES.NOT_FOUND,
    });
  });

  it('flags messages containing absolute path leakage as INTERNAL', () => {
    const err = new Error('Custom error referencing /Users/alice/secret-project.md');
    expect(classifyIpcError(err)).toEqual({
      kind: 'sanitized',
      category: IPC_ERROR_CATEGORIES.INTERNAL,
    });
  });

  it('flags Windows-style path leakage as INTERNAL', () => {
    const err = new Error('Unexpected: C:\\Users\\bob\\AppData\\Local\\MythosWriter\\manifest.json');
    expect(classifyIpcError(err)).toEqual({
      kind: 'sanitized',
      category: IPC_ERROR_CATEGORIES.INTERNAL,
    });
  });

  it('passes through SafeIpcError unchanged', () => {
    const err = new SafeIpcError('Brainstorm Agent paused: hourly cap reached.');
    expect(classifyIpcError(err)).toEqual({
      kind: 'safe',
      message: 'Brainstorm Agent paused: hourly cap reached.',
    });
  });

  it('passes through trusted user-facing messages with no path leakage', () => {
    const err = new Error('Story not found: 5fa3-1234');
    expect(classifyIpcError(err)).toEqual({
      kind: 'passthrough',
      message: 'Story not found: 5fa3-1234',
    });
  });
});

describe('sanitizeIpcError', () => {
  // The classifier itself never emits forbidden substrings — but assert the
  // shape coming back from the wrapper to lock the invariant at the boundary.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never emits absolute path substrings in the returned error string', () => {
    const samples: unknown[] = [
      makeFsError('ENOENT', 'open', '/Users/alice/MythosWriter/StoryVault/nonexistent.md'),
      makeFsError('EACCES', 'open', '/home/bob/.config/manifest.json'),
      new Error("ENOENT: no such file or directory, open '/private/var/folders/foo'"),
      new Error('Path traversal denied: /tmp/x'),
      new Error('Unexpected: C:\\Users\\bob\\MythosWriter\\vault\\manifest.json'),
      new SyntaxError("Unexpected token } in JSON at position 42 of '/home/u/foo.json'"),
    ];

    for (const err of samples) {
      const reply = sanitizeIpcError('vault:read', err);
      for (const needle of FORBIDDEN_PATH_SUBSTRINGS) {
        expect(reply.error).not.toContain(needle);
      }
    }
  });

  it('returns the SafeIpcError message verbatim', () => {
    const reply = sanitizeIpcError('vault:manifest:read', new SafeIpcError('Manifest is in use.'));
    expect(reply).toEqual({ error: 'Manifest is in use.' });
  });

  it('logs the raw error to console.error but does not return it', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = makeFsError('ENOENT', 'open', '/Users/alice/vault/x.md');
    const reply = sanitizeIpcError('vault:read', err);

    expect(reply.error).toBe(ipcErrorUserMessage(IPC_ERROR_CATEGORIES.NOT_FOUND));
    // Console got the raw message (operator can debug); renderer did not.
    const loggedCall = consoleSpy.mock.calls.find((args) =>
      String(args[0]).includes('/Users/alice/vault/x.md'),
    );
    expect(loggedCall).toBeDefined();
  });
});

describe('ipcErrorUserMessage', () => {
  it('returns a non-empty fixed string for every category', () => {
    for (const cat of Object.values(IPC_ERROR_CATEGORIES)) {
      const msg = ipcErrorUserMessage(cat);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      for (const needle of FORBIDDEN_PATH_SUBSTRINGS) {
        expect(msg).not.toContain(needle);
      }
    }
  });
});

describe('wrapIpcHandler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards successful results unchanged', async () => {
    const wrapped = wrapIpcHandler('vault:read', async (_event: unknown, payload: { path: string }) => ({
      content: 'ok',
      path: payload.path,
    }));
    const result = await wrapped({}, { path: 'a.md' });
    expect(result).toEqual({ content: 'ok', path: 'a.md' });
  });

  it('sanitizes fs ENOENT thrown synchronously inside the handler', async () => {
    const wrapped = wrapIpcHandler('vault:manifest:write', async (_event: unknown, _payload: unknown) => {
      throw makeFsError('ENOENT', 'open', '/Users/alice/MythosWriter/manifest.json');
    });
    const result = await wrapped({}, {});
    expect(result).toEqual({ error: 'File not found.' });
    expect(JSON.stringify(result)).not.toContain('/Users/');
  });

  it('sanitizes async rejections (the original ipc.ts bug)', async () => {
    const wrapped = wrapIpcHandler('vault:write', async (_event: unknown, _payload: unknown) => {
      // Mimic an async fs operation that rejects.
      await Promise.resolve();
      throw makeFsError('EACCES', 'write', '/home/bob/vault/x.md');
    });
    const result = await wrapped({}, {});
    expect(result).toEqual({ error: 'Permission denied.' });
    expect(JSON.stringify(result)).not.toContain('/home/');
  });

  it('preserves SafeIpcError messages thrown by trusted handlers', async () => {
    const wrapped = wrapIpcHandler('agent:brainstorm', async (_event: unknown, _payload: unknown) => {
      throw new SafeIpcError('Brainstorm Agent paused: daily cap reached.');
    });
    const result = await wrapped({}, {});
    expect(result).toEqual({ error: 'Brainstorm Agent paused: daily cap reached.' });
  });
});

describe('withIpcLog', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps a successful handler in the standard IPC envelope and logs duration', async () => {
    let now = 100;
    const wrapped = withIpcLog('settings:get', async () => ({ theme: 'dark' }), {
      now: () => (now += 12),
    });

    await expect(wrapped(undefined)).resolves.toEqual({
      ok: true,
      data: { theme: 'dark' },
    });
    expect(console.info).toHaveBeenCalledWith('[ipc] channel=settings:get ok=true durationMs=12');
  });

  it('wraps thrown errors in a sanitized standard IPC envelope with a code', async () => {
    const wrapped = withIpcLog('settings:set', async () => {
      throw makeFsError('EACCES', 'open', '/Users/alice/private/settings.json');
    });

    await expect(wrapped(undefined)).resolves.toEqual({
      ok: false,
      code: IPC_ERROR_CATEGORIES.PERMISSION_DENIED,
      message: 'Permission denied.',
    });
  });
});
