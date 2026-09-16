// productionRoles.ts — Production-team role registry (SKY-10741 M12.B6).
//
// Four roles, each a distinct lens on the same manuscript (AC3 — outputs must be
// distinguishable, not one output relabeled):
//   • Alpha reader        — earliest reader; raw gut reactions, confusion, drop-off.
//   • Beta reader         — near-final reader; overall impression, does the payoff land.
//   • Storyline consultant— structural/plot craft; arc, stakes, setups & payoffs.
//   • Line editor         — sentence-level craft; rhythm, word choice, grammar.
//
// Reader-perspective (AC2): alpha/beta readers judge the story AS IT UNFOLDS, so
// their entity context is reveal-point filtered (see readerPerspective.ts) — they
// must not know a twist before the reader would. The storyline consultant and
// line editor are CRAFT roles: they legitimately see the whole map (a consultant
// can't judge whether a setup pays off without knowing the payoff), so they get
// unfiltered context.
//
// Defaults (AC1): every role is independently toggleable and defaults OFF, except
// the pre-existing Beta Reader (which shipped enabled in Beta 3 M22 — not this
// ticket's default to flip). Line editor is explicitly off per the owner ruling
// on SKY-10528's parent list.
//
// This module is pure (no Electron imports) so the lenses and prompt framing are
// unit-testable without a running main process.

export type ProductionRoleId = 'alphaReader' | 'betaReader' | 'storylineConsultant' | 'lineEditor';

export interface ProductionRoleDef {
  id: ProductionRoleId;
  /** Default UI display name (rename-able via settings.agentNames, like other agents). */
  displayName: string;
  /**
   * true → entity context must be reveal-point filtered to the reader's position,
   * so the role cannot see a not-yet-revealed identity (AC2).
   */
  readerPerspective: boolean;
  /**
   * Default enabled state (AC1). All new roles default OFF; only the pre-existing
   * betaReader ships enabled (its default is owned by Beta 3 M22, not this ticket).
   */
  defaultEnabled: boolean;
  /** One-line description of this role's distinct lens (AC3). */
  lens: string;
}

export const PRODUCTION_ROLE_IDS: readonly ProductionRoleId[] = [
  'alphaReader',
  'betaReader',
  'storylineConsultant',
  'lineEditor',
];

export const PRODUCTION_ROLES: Record<ProductionRoleId, ProductionRoleDef> = {
  alphaReader: {
    id: 'alphaReader',
    displayName: 'Alpha Reader',
    readerPerspective: true,
    defaultEnabled: false,
    lens: "First-pass reader — raw gut reactions, where they got confused, and the exact moment they'd put the book down. Judges the story as it unfolds, blind to unrevealed twists.",
  },
  betaReader: {
    id: 'betaReader',
    displayName: 'Beta Reader',
    readerPerspective: true,
    // Pre-existing shipping default (Beta 3 M22). Not flipped by this ticket.
    defaultEnabled: true,
    lens: 'Near-final reader — overall impression and whether the payoff satisfies. Reads in reveal order, so a twist has to earn its landing.',
  },
  storylineConsultant: {
    id: 'storylineConsultant',
    displayName: 'Storyline Consultant',
    readerPerspective: false,
    defaultEnabled: false,
    lens: 'Structural consultant — dramatic arc, stakes escalation, and whether every setup pays off. Sees the whole map, including reveals, to judge whether they are earned.',
  },
  lineEditor: {
    id: 'lineEditor',
    displayName: 'Line Editor',
    readerPerspective: false,
    defaultEnabled: false,
    lens: 'Line-level craft — sentence rhythm, word choice, redundancy, and grammar. Off by default (owner ruling, SKY-10528).',
  },
};

export interface ProductionReviewInput {
  /** Human-readable scope label, e.g. "Chapter 3" or "Act One". */
  scopeLabel: string;
  /**
   * Reader position for reader-perspective roles (same format as reveal_point,
   * e.g. "Chapter 3"). Ignored by author-perspective roles.
   */
  position?: string;
  /**
   * Entity dossier block — already reveal-filtered for reader roles, or the full
   * dossier for author roles (see readerPerspective.ts). May be '' when there are
   * no entities to inject.
   */
  entityContext: string;
  /** Manuscript prose in scope, with scene markers (see beta/textAssembly). */
  sourceText: string;
}

/**
 * Role-specific framing prepended to every prompt. Each string is deliberately
 * distinct so the four roles produce different lenses on the same manuscript
 * (AC3) — an alpha reader reacts, a consultant diagnoses structure, a line editor
 * marks prose. The reader/author distinction is also stated explicitly so the
 * model knows whether it is meant to be blind to unrevealed identities.
 */
const ROLE_FRAMING: Record<ProductionRoleId, (input: ProductionReviewInput) => string[]> = {
  alphaReader: (input) => [
    `You are an ALPHA READER reading "${input.scopeLabel}" for the very first time, in order, up to this point and no further.`,
    'React in the first person as you go: what gripped you, what confused you, and the exact line where you almost stopped reading.',
    'You do NOT know anything the text has not yet shown you — never reference a character trait, identity, or event that has not happened yet on the page.',
    'Report 3-6 reactions. Each: the scene, an exact short quote, and your in-the-moment reaction. Do not suggest edits — you only react.',
  ],
  betaReader: (input) => [
    `You are a BETA READER giving an overall first-read impression of "${input.scopeLabel}", read in order.`,
    'Judge the whole experience: hook, pacing, clarity, emotional payoff, and whether the ending earns what came before.',
    'Read in reveal order — a twist only counts if it landed for you as a reader, not because you were told it was coming.',
    'Give a short overall verdict plus 3-5 specific moments that worked or fell flat.',
  ],
  storylineConsultant: (input) => [
    `You are a STORYLINE CONSULTANT performing a structural review of "${input.scopeLabel}".`,
    'Work at the plot/architecture level, not the sentence level: dramatic arc, escalation of stakes, midpoint turn, and whether every setup has a payoff and every payoff a setup.',
    'You have full knowledge of the manuscript, including its reveals — use it to judge whether each reveal is properly seeded and earned.',
    'Report structural notes as a numbered list, each naming the beat/scene, the structural issue, and a concrete fix.',
  ],
  lineEditor: (input) => [
    `You are a LINE EDITOR copy-passing "${input.scopeLabel}" at the sentence level.`,
    'Do not comment on plot or character — only prose craft: sentence rhythm, word choice, redundancy, filter words, and grammar.',
    'Quote the exact phrase, then give a tightened rewrite. Preserve the author\'s voice; never change meaning.',
    'Report edits as a list, one per line, each with the original phrase and your suggested rewrite.',
  ],
};

/**
 * Build the user-content string for a production-review run. The role framing is
 * role-specific (AC3); the manuscript prose and (already-filtered) entity context
 * are wrapped in explicit delimiters (prompt-injection defense, mirroring
 * buildBetaReportUserContent). For reader-perspective roles the caller must pass
 * an entityContext that was built with buildReaderEntityContext at `position`.
 */
export function buildProductionReviewUserContent(
  role: ProductionRoleId,
  input: ProductionReviewInput,
): string {
  const framing = ROLE_FRAMING[role](input);
  const parts: string[] = [...framing, ''];
  if (input.entityContext.trim()) {
    parts.push(
      PRODUCTION_ROLES[role].readerPerspective
        ? '<!-- Only entities the reader has met so far are provided below. -->'
        : '<!-- Full cast and continuity notes for the manuscript. -->',
      input.entityContext,
      '',
    );
  }
  parts.push('<manuscript>', input.sourceText, '</manuscript>');
  return parts.join('\n');
}
