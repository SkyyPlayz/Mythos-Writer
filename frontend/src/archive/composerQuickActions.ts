// M12.B3 (SKY-10738): composer quick-action chips above the Archive Agent's
// chat composer — one global command ("Run full scan") plus two
// context-specific actions generated from the CURRENT open flag set, same
// affordance as Brainstorm's `+warmer/+darker/+specific` refine chips
// (frontend/src/presets.ts REFINEMENT_CHIPS). Pure/testable: no IPC here.

import type { InconsistencyItem } from '../InconsistencyCard';

export interface QuickActionChip {
  id: string;
  label: string;
  kind: 'scan' | 'chat';
  /** Only present for kind:'chat' — the message sent to the agent on click. */
  prompt?: string;
}

const SEVERITY_ORDER: Record<InconsistencyItem['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'in', 'on', 'at', 'to', 'with', 'and', 'but', 'for',
  'of', 'this', 'that', 'scene', 'earlier', 'later', 'was', 'were', 'has',
  'have', 'had', 'it', 'its', 'here', 'there',
]);

const CATEGORY_SUFFIX: Record<InconsistencyItem['category'], string> = {
  factual_contradiction: 'conflict',
  location_attribute_mismatch: 'mismatch',
  character_attribute_drift: 'drift',
};

/** Best-effort short topic phrase for a flag ("tide conflict") — no NLP
 *  available here, so this picks the first non-stopword from the rationale
 *  (falling back to the category label) and suffixes it by category. */
export function topicPhrase(item: InconsistencyItem): string {
  const source = item.rationale || item.manuscriptAnchor.excerpt || '';
  const words = source
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  const topic = words[0] ?? item.category.replace(/_/g, ' ');
  return `${topic} ${CATEGORY_SUFFIX[item.category]}`;
}

/** Generates the composer's quick-action chip row from the panel's current
 *  items. Dynamic by construction — re-run this whenever `items` changes,
 *  never render a static chip set (SKY-10738 acceptance criteria). */
export function generateQuickActionChips(items: InconsistencyItem[]): QuickActionChip[] {
  const chips: QuickActionChip[] = [
    { id: 'run-full-scan', label: 'Run full scan', kind: 'scan' },
  ];

  const open = items
    .filter((i) => i.status === 'open')
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  if (open.length === 0) return chips;

  const primary = open[0];
  chips.push({
    id: `explain-${primary.id}`,
    label: 'Explain flag #1',
    kind: 'chat',
    prompt: `Explain flag #1 — ${primary.rationale}`,
  });

  const topic = topicPhrase(primary);
  chips.push({
    id: `suggest-fix-${primary.id}`,
    label: `Suggest a fix for the ${topic}`,
    kind: 'chat',
    prompt: `Suggest a fix for the ${topic}: ${primary.rationale}`,
  });

  return chips;
}
