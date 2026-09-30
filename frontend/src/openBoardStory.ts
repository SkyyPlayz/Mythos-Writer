/**
 * F1#2 — which story owns a board-open when selection may be null.
 * Must stay aligned with SceneCrafterPage's `selectedStory ?? stories[0]`.
 */
export function resolveOpenBoardStoryId(
  selectedStory: { id: string } | null,
  stories: readonly { id: string }[],
): string | null {
  return (selectedStory ?? stories[0] ?? null)?.id ?? null;
}
