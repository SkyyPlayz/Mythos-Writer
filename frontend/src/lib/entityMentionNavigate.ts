/**
 * Global navigate handler for @-mention chip clicks.
 * DesktopShell registers; RichTextEditor falls back here when no onEntityClick
 * prop is wired (Notes surfaces), so mentions stay clickable on every page type
 * without editing NoteViewer (F2#2).
 *
 * Shield N4: navigation is in-app by entity ID only — never builds a URL from
 * chip text, never openExternal / window.open.
 */

type EntityMentionNavigateHandler = (entityId: string) => void;

let handler: EntityMentionNavigateHandler | null = null;

/**
 * Accept only opaque in-app entity ids. Reject forged chips that smuggle
 * URLs / schemes / path separators into data-entity-id.
 */
export function isSafeEntityMentionId(entityId: string): boolean {
  const id = entityId.trim();
  if (!id || id.length > 128) return false;
  if (/[/:\\?#\s]/.test(id)) return false;
  if (/^(https?|entity|javascript|data|file|mailto):/i.test(id)) return false;
  // Alphanumeric + common id separators only.
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id);
}

export function setEntityMentionNavigateHandler(
  next: EntityMentionNavigateHandler | null,
): void {
  handler = next;
}

export function navigateEntityMention(entityId: string): void {
  if (!isSafeEntityMentionId(entityId) || !handler) return;
  handler(entityId.trim());
}
