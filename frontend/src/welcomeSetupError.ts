/**
 * F3#9 security residual — map vault-setup failures to short user-facing copy.
 * Never forward raw Error.message (may contain paths / stacks) to the overlay.
 */

const SAFE_SETUP_ERROR =
  'Vault setup didn’t finish. Pick a path to try again.';

const SAFE_SETUP_ERROR_CANCELLED_CONTEXT =
  'Vault setup didn’t finish. Pick a path to try again.';

/** Strip anything that looks like a filesystem path or stack frame. */
function looksUnsafe(text: string): boolean {
  if (/[/\\]/.test(text)) return true; // path separators
  if (/\bat\s+\S+/i.test(text)) return true; // stack frames
  if (/Error:/i.test(text) && text.length > 80) return true;
  if (text.length > 120) return true;
  return false;
}

/**
 * Map an unknown failure into a single plain-text string safe for WelcomeOverlay.
 * Always returns a fixed short phrase when the input is missing or unsafe.
 */
export function mapWelcomeSetupError(_err?: unknown): string {
  if (_err == null) return SAFE_SETUP_ERROR;
  if (typeof _err === 'string') {
    const trimmed = _err.trim();
    if (!trimmed || looksUnsafe(trimmed)) return SAFE_SETUP_ERROR;
    // Allow a small set of known short phrases only.
    if (/^vault setup/i.test(trimmed) && trimmed.length <= 80 && !looksUnsafe(trimmed)) {
      return trimmed;
    }
    return SAFE_SETUP_ERROR;
  }
  // Never read Error.message into the UI — may include paths or stacks.
  return SAFE_SETUP_ERROR_CANCELLED_CONTEXT;
}

export const WELCOME_SETUP_ERROR_GENERIC = SAFE_SETUP_ERROR;
