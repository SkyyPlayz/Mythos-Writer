const INVALID_CHARS = /[/\\:*?"<>|]/;

export function validateRenameName(name: string): string | null {
  const t = name.trim();
  if (!t) return 'Name cannot be empty';
  if (t.length > 255) return 'Name too long';
  if (INVALID_CHARS.test(t)) return 'Name contains invalid characters (/ \\ : * ? " < > |)';
  return null;
}
