const INVALID_CHARS = /[/\\:*?"<>|]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const RESERVED_DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.[^.]*)?$/i;

// SKY-9027: only the OS-reserved set is forbidden — full Unicode/emoji is
// valid in a note/folder name. `name` is trimmed of surrounding whitespace
// before use, so only a trailing dot (which trim() does not remove) and
// Windows reserved device names need an explicit check here.
export function validateRenameName(name: string): string | null {
  const t = name.trim();
  if (!t) return 'Name cannot be empty';
  if (t.length > 255) return 'Name too long';
  if (INVALID_CHARS.test(t)) return 'Name contains invalid characters (/ \\ : * ? " < > |)';
  if (CONTROL_CHARS.test(t)) return 'Name contains invalid control characters';
  if (t.endsWith('.')) return 'Name cannot end with a dot';
  if (RESERVED_DEVICE_NAME.test(t)) return 'That name is reserved by Windows';
  return null;
}
