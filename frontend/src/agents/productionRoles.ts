// productionRoles.ts — renderer-side production-team role registry (SKY-11411).
//
// Mirrors electron-main/src/productionRoles.ts for the UI. No runtime code is
// shared across the process boundary (same split as agentIdentity.ts), so this
// file is a small, pure copy of the id + display-name + lens metadata the UI
// needs. betaReader is intentionally NOT here — it has its own dedicated view
// (BetaReaderPage); these three roles are the ones SKY-11411 brings live.

export type ProductionRoleId = 'alphaReader' | 'storylineConsultant' | 'lineEditor';

export const PRODUCTION_ROLE_IDS: readonly ProductionRoleId[] = [
  'alphaReader',
  'storylineConsultant',
  'lineEditor',
];

export interface ProductionRoleUi {
  id: ProductionRoleId;
  displayName: string;
  /** true → reader-perspective (main filters its entity context by reveal point). */
  readerPerspective: boolean;
  /** One-line description of the role's distinct lens, shown in the picker. */
  lens: string;
}

export const PRODUCTION_ROLES: Record<ProductionRoleId, ProductionRoleUi> = {
  alphaReader: {
    id: 'alphaReader',
    displayName: 'Alpha Reader',
    readerPerspective: true,
    lens: 'First-pass reader — raw reactions, confusion, and the exact line they’d stop. Blind to unrevealed twists.',
  },
  storylineConsultant: {
    id: 'storylineConsultant',
    displayName: 'Storyline Consultant',
    readerPerspective: false,
    lens: 'Structural review — arc, stakes, and whether every setup pays off. Sees the whole map, reveals included.',
  },
  lineEditor: {
    id: 'lineEditor',
    displayName: 'Line Editor',
    readerPerspective: false,
    lens: 'Sentence-level craft — rhythm, word choice, redundancy, grammar. Preserves your voice; never changes meaning.',
  },
};

/** Resolve a production role's display name, honoring a settings.agentNames override. */
export function resolveProductionRoleName(
  role: ProductionRoleId,
  agentNames?: Partial<Record<string, string>>,
): string {
  const custom = agentNames?.[role]?.trim();
  return custom || PRODUCTION_ROLES[role].displayName;
}
