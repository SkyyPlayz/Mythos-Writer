import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_ROLES,
  PRODUCTION_ROLE_IDS,
  buildProductionReviewUserContent,
  type ProductionReviewInput,
} from './productionRoles.js';

const INPUT: ProductionReviewInput = {
  scopeLabel: 'Chapter 3',
  position: 'Chapter 3',
  entityContext: '<entity_context>\nEntity: The Stranger [Character]\n</entity_context>',
  sourceText: '<<SCENE id="s1">>The stranger crossed the square.<</SCENE>>',
};

describe('production role registry (AC1 defaults, AC2 reader-perspective flags)', () => {
  it('every role is independently toggleable and defaults OFF except pre-existing betaReader', () => {
    expect(PRODUCTION_ROLES.alphaReader.defaultEnabled).toBe(false);
    expect(PRODUCTION_ROLES.storylineConsultant.defaultEnabled).toBe(false);
    expect(PRODUCTION_ROLES.lineEditor.defaultEnabled).toBe(false);
    // betaReader shipped enabled in Beta 3 M22 — not this ticket's default to flip.
    expect(PRODUCTION_ROLES.betaReader.defaultEnabled).toBe(true);
  });

  it('reader roles use reader-perspective; craft roles do not', () => {
    expect(PRODUCTION_ROLES.alphaReader.readerPerspective).toBe(true);
    expect(PRODUCTION_ROLES.betaReader.readerPerspective).toBe(true);
    expect(PRODUCTION_ROLES.storylineConsultant.readerPerspective).toBe(false);
    expect(PRODUCTION_ROLES.lineEditor.readerPerspective).toBe(false);
  });

  it('every registered id has a matching def with a non-empty lens', () => {
    for (const id of PRODUCTION_ROLE_IDS) {
      expect(PRODUCTION_ROLES[id].id).toBe(id);
      expect(PRODUCTION_ROLES[id].lens.length).toBeGreaterThan(0);
    }
  });
});

describe('role prompts are distinguishable (AC3 — different lenses, not one output relabeled)', () => {
  it('each role names its own lens and the four prompts are pairwise distinct', () => {
    const alpha = buildProductionReviewUserContent('alphaReader', INPUT);
    const beta = buildProductionReviewUserContent('betaReader', INPUT);
    const storyline = buildProductionReviewUserContent('storylineConsultant', INPUT);
    const line = buildProductionReviewUserContent('lineEditor', INPUT);

    expect(alpha).toContain('ALPHA READER');
    expect(beta).toContain('BETA READER');
    expect(storyline).toContain('STORYLINE CONSULTANT');
    expect(line).toContain('LINE EDITOR');

    const prompts = [alpha, beta, storyline, line];
    const unique = new Set(prompts);
    expect(unique.size).toBe(4);
  });

  it('alpha reader reacts (no edits); line editor rewrites prose — opposite mandates', () => {
    const alpha = buildProductionReviewUserContent('alphaReader', INPUT);
    const line = buildProductionReviewUserContent('lineEditor', INPUT);
    expect(alpha.toLowerCase()).toContain('do not suggest edits');
    expect(line.toLowerCase()).toContain('rewrite');
    // The consultant works at plot level, explicitly not sentences.
    const storyline = buildProductionReviewUserContent('storylineConsultant', INPUT);
    expect(storyline.toLowerCase()).toContain('structural');
  });

  it('reader roles are told they are blind to the future; craft roles are told they see everything', () => {
    const alpha = buildProductionReviewUserContent('alphaReader', INPUT);
    const storyline = buildProductionReviewUserContent('storylineConsultant', INPUT);
    expect(alpha).toContain('Only entities the reader has met so far');
    expect(storyline).toContain('Full cast and continuity notes');
    // And the framing itself states the knowledge boundary.
    expect(alpha.toLowerCase()).toContain('do not know anything the text has not yet shown');
    expect(storyline.toLowerCase()).toContain('full knowledge of the manuscript');
  });

  it('always wraps the manuscript prose in delimiters', () => {
    const out = buildProductionReviewUserContent('betaReader', INPUT);
    expect(out).toContain('<manuscript>');
    expect(out).toContain('</manuscript>');
    expect(out).toContain(INPUT.sourceText);
  });

  it('omits the entity block entirely when there is no entity context', () => {
    const out = buildProductionReviewUserContent('alphaReader', { ...INPUT, entityContext: '' });
    expect(out).not.toContain('entities the reader has met');
    expect(out).toContain('<manuscript>');
  });
});
