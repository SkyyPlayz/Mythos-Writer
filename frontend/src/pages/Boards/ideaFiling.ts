/**
 * SKY-11192 §3 — Idea Collections filing rules, renderer side.
 *
 * The rules themselves live in `@mythos-writer/shared/ideaNotes` because the
 * main process's one-time migration of the retired brainstorm board has to
 * produce byte-identical note names: if the two sides disagreed, migrating and
 * then filing the same idea would leave the user with two near-duplicate notes
 * and the `Filed ✓` check would stop working across the migration.
 *
 * Re-exported here so renderer code has one obvious import for board filing,
 * and so this module stays the place to look for the §3 contract.
 *
 * Everything here is PURE. The module that actually writes to the vault is
 * `useIdeaFiling`, and it is deliberately separate: this one can be imported
 * by anything — including an agent code path — without handing it the ability
 * to create a note. See `useIdeaFiling.ts` for the three locks that enforce
 * the user-click-only constraint (ticket AC 4, CEO ruling 5).
 */
export {
  IDEA_TARGET_FOLDER,
  IDEA_FOLDERS,
  ideaTargetFolder,
  ideaNoteName,
  ideaNoteBody,
  isIdeaFiled,
} from '@mythos-writer/shared/ideaNotes';
export type { IdeaCategory, IdeaNoteSource } from '@mythos-writer/shared/ideaNotes';
