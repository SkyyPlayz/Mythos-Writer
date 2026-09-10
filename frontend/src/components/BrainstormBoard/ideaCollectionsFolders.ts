// SKY-11192/SKY-11674 §3 — the frontend-side mirror of
// electron-main/src/ideaCollectionsFiling.ts's fixed category->folder
// mapping. Duplicated (not imported) because the frontend cannot import
// electron-main code; kept a one-line-per-entry literal so a diff between
// the two is trivial to eyeball. NOT user-editable.
import type { BoardCategoryKey } from '../../brainstormBoard';

export const IDEA_COLLECTION_FOLDER: Record<BoardCategoryKey, string> = {
  beats: 'Plot & Story',
  theme: 'Plot & Story',
  trope: 'Plot & Story',
  loose: 'Plot & Story',
  rel: 'Characters',
  world: 'Worldbuilding',
};
