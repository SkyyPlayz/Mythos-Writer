export type IpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export function isIpcEnvelope<T>(value: unknown): value is IpcEnvelope<T> {
  if (!value || typeof value !== 'object' || !('ok' in value)) return false;
  const candidate = value as { ok?: unknown; data?: unknown; code?: unknown; message?: unknown };
  if (candidate.ok === true) return 'data' in candidate;
  if (candidate.ok === false) {
    return typeof candidate.code === 'string' && typeof candidate.message === 'string';
  }
  return false;
}

export function unwrapIpcEnvelope<T>(value: unknown): T | { error: string } | unknown {
  if (!isIpcEnvelope<T>(value)) return value;
  return value.ok ? value.data : { error: value.message };
}
