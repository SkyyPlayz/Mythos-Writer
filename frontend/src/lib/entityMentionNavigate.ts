/**
 * Global navigate handler for @-mention chip clicks.
 * DesktopShell registers; RichTextEditor falls back here when no onEntityClick
 * prop is wired (Notes surfaces), so mentions stay clickable on every page type
 * without editing NoteViewer (F2#2).
 */

type EntityMentionNavigateHandler = (entityId: string) => void;

let handler: EntityMentionNavigateHandler | null = null;

export function setEntityMentionNavigateHandler(
  next: EntityMentionNavigateHandler | null,
): void {
  handler = next;
}

export function navigateEntityMention(entityId: string): void {
  if (!entityId || !handler) return;
  handler(entityId);
}
