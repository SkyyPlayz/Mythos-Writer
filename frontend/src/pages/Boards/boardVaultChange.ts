/**
 * SKY-11186: which vault changes an open board has to follow.
 *
 * A board shows its immediate children plus each child folder's direct-child
 * counts (BoardsTabPanel), so a note or folder up to two levels below the
 * board's folder can change what it paints — and so can any image one of its
 * cards is showing, wherever in the vault that image lives (spec §9 lets a
 * note point at `attachments/` at the root). Everything else is another
 * board's business: a keystroke in Obsidian three folders away must not
 * re-list and re-resolve a 2,000-card board.
 *
 * `changedPath` is notes-vault-relative POSIX (what main sends on
 * `vault:notes-updated` / `vault:notes-asset-changed`); an event without a
 * path is an untargeted update and is always followed.
 */
export function boardFollowsChange(
  folderPath: string,
  changedPath: string | undefined,
  shownImageSources: Iterable<string | null | undefined>,
): boolean {
  if (!changedPath) return true;
  for (const src of shownImageSources) if (src === changedPath) return true;

  let rel: string;
  if (folderPath === '') rel = changedPath;
  else if (changedPath === folderPath) return true; // the board's own folder (renamed / removed)
  else if (changedPath.startsWith(`${folderPath}/`)) rel = changedPath.slice(folderPath.length + 1);
  else return false;
  return rel.split('/').length <= 2;
}
