// Purpose: Stage 2, pure. Walk scenes in story order and report each place an
// entity's attribute value changes, with the two scenes that bracket it.

export interface SceneFact {
  entity: string;
  attribute: string;
  value: string;
  quote: string;
  /** Prose offset of the quote (from quoteCheck); orders facts inside a scene. */
  start: number;
}

export interface SceneFacts {
  sceneId: string;
  facts: readonly SceneFact[];
}

export interface AdjacencyChange {
  entity: string;
  attribute: string;
  /** Value as last stated before the change. */
  a: string;
  /** Value as first stated after the change. */
  b: string;
  /** Last scene that stated `a`. */
  sceneA: string;
  /** Scene that first states `b`. */
  sceneB: string;
  factA: SceneFact;
  factB: SceneFact;
}

/** Comparison key for names and values: trimmed, lowercased, inner whitespace collapsed. */
export function normalizeFactText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ').toLowerCase();
}

function keyOf(fact: SceneFact): string {
  return `${normalizeFactText(fact.entity)}\u0000${normalizeFactText(fact.attribute)}`;
}

/**
 * For each entity + attribute, compare the last value stated in one scene with
 * the first value stated in the next scene that mentions it. Scenes that do not
 * mention the attribute are skipped, so a change across them is still caught
 * and bracketed by the two scenes that state the values. Changes inside one
 * scene are not reported here.
 */
export function adjacencyDiff(scenes: readonly SceneFacts[]): AdjacencyChange[] {
  const last = new Map<string, { sceneId: string; fact: SceneFact }>();
  const changes: AdjacencyChange[] = [];

  for (const scene of scenes) {
    const ordered = [...scene.facts].sort((x, y) => x.start - y.start);
    const firstHere = new Map<string, SceneFact>();
    const lastHere = new Map<string, SceneFact>();
    for (const fact of ordered) {
      const key = keyOf(fact);
      if (!firstHere.has(key)) firstHere.set(key, fact);
      lastHere.set(key, fact);
    }
    for (const [key, factB] of firstHere) {
      const prior = last.get(key);
      if (prior && normalizeFactText(prior.fact.value) !== normalizeFactText(factB.value)) {
        changes.push({
          entity: prior.fact.entity,
          attribute: prior.fact.attribute,
          a: prior.fact.value,
          b: factB.value,
          sceneA: prior.sceneId,
          sceneB: scene.sceneId,
          factA: prior.fact,
          factB,
        });
      }
    }
    for (const [key, fact] of lastHere) last.set(key, { sceneId: scene.sceneId, fact });
  }
  return changes;
}
