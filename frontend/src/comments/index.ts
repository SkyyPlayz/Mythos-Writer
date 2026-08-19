// Beta 3 M11 — manuscript comments: the module's public API.
//
// Consumers:
//   UI (this milestone)  — useStoryComments + the story/CommentsGutter.tsx
//                          and story/CommentSelectionBar.tsx components.
//   M13 Reader           — docks under the same gutter; reads `commentsStore`.
//   M22 Beta Reader      — files reaction comments with kind 'beta'.
//   M23 Archive plumbing — files continuity comments programmatically:
//
// ── M23 HOOK — programmatic create-comment API ──────────────────────────────
//
//   import { createComment } from '../comments';
//
//   createComment({
//     storyId: story.id,
//     storyPath: story.path,        // binds persistence if the story isn't open yet
//     sceneId: scene.id,
//     anchor: 'exact scene substring the flag points at',
//     text: 'Continuity: …',
//     kind: 'archive',              // colors the marker + enables the 3 actions
//     suggestionId: suggestion.id,  // REQUIRED for live agent actions — buttons
//   });                             // dispatch archiveConfirm(suggestionId, action)
//
// The comment appears in the manuscript gutter immediately, persists to
// `<Story.path>/comments.json` through the vault IPC, and survives restarts.
// Omit `suggestionId` for informational comments (e.g. Beta Reader reactions):
// the agent-action row renders as a disabled affordance instead.

export {
  COMMENT_KIND_META,
  MIN_ANCHOR_LENGTH,
  MAX_ANCHOR_LENGTH,
  isCommentKind,
  isValidAnchor,
} from './types';
export type { CommentKind, CreateCommentInput, StoryComment } from './types';

export { commentsStore, createComment } from './store';
export type { CommentsUiState } from './store';

export { segmentsFor, findAnchorSceneId, orderCommentsByDocument, clipAnchor } from './model';
export type { AnchorSegment } from './model';

export {
  AGENT_ACTIONS,
  GUTTER_AGENT_ACTIONS,
  AGENT_ACTION_SUCCESS_TOAST,
  agentActionAvailability,
  runAgentAction,
} from './agentActions';
export type { AgentAction, AgentActionDef, AgentActionResult } from './agentActions';

export {
  COMMENTS_FILE_BASENAME,
  COMMENTS_FILE_VERSION,
  commentsFilePath,
  parseCommentsFile,
  serializeCommentsFile,
} from './persistence';

export { useStoryComments } from './useStoryComments';
export type { StoryCommentsApi } from './useStoryComments';
