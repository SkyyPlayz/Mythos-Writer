// AC-BST-21: shared payload-validation helpers for all inbound brainstorm IPC channels.
// Covers three of the four required guards; the fourth (isFromTopFrame) is applied upstream
// by setupIpcMain (for handlers in the handlers object) or per-handler via wrapIpcHandler.
import { MAX_PAYLOAD_BYTES } from './streaming.js';

/**
 * Valid roles for brainstorm conversation history messages.
 * Only 'user' and 'assistant' are accepted; 'system' and 'tool' are rejected.
 */
export const BRAINSTORM_VALID_ROLES: ReadonlySet<string> = new Set(['user', 'assistant']);

/**
 * Validates a brainstorm IPC payload.
 * Throws with a descriptive message on failure so callers inside wrapIpcHandler
 * or setupIpcMain let the error propagate to the built-in sanitizeIpcError wrapper,
 * which converts it to a typed error response rather than an unhandled exception.
 *
 * @param payload - The raw payload received from the renderer.
 * @param opts.history - Optional conversation history to validate role fields.
 */
export function assertBrainstormPayloadValid(
  payload: unknown,
  opts?: { history?: Array<{ role: unknown }> },
): void {
  if (payload == null || Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) {
    throw new Error('Payload too large');
  }
  if (opts?.history) {
    for (const msg of opts.history) {
      if (!BRAINSTORM_VALID_ROLES.has(msg.role as string)) {
        throw new Error('Invalid role in history');
      }
    }
  }
}
