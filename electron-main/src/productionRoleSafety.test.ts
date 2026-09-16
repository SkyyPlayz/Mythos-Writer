// productionRoleSafety.test.ts — SKY-11411 / SKY-10741 AC2.
//
// The spoiler-safety guarantee ("a reader-mode agent must not know a twist before
// the reader would") lives in the COMPOSITION the live handler
// (main.ts registerProductionRoleRunHandler) performs:
//
//   reader role : buildReaderEntityContext(index, position)  ─┐
//   craft role  : buildAuthorEntityContext(index)            ─┴─▶ buildProductionReviewUserContent(role, …)
//
// Testing that exact composition — not a hand-rolled string — is what proves the
// property holds on the live path (same strategy as betaReport.test.ts for the
// Beta Reader). A unit test on the handler itself would have to mock all of
// Electron; the composition is where the safety logic actually is.

import { describe, it, expect } from 'vitest';
import { buildReaderEntityContext, buildAuthorEntityContext } from './readerPerspective.js';
import { buildProductionReviewUserContent, type ProductionReviewInput } from './productionRoles.js';
import type { EntityIndexEntry } from './vault/entityIndex.js';

// Planted-reveal fixture (mirrors readerPerspective.test.ts / betaReport.test.ts):
// "Lord Vhaeraun" / alias "the true villain" is revealed only in Chapter 10, so a
// reader at Chapter 2 must never see it. Mira has no reveal_point → always visible.
const REVEAL_FIXTURE: EntityIndexEntry[] = [
  { name: 'Mira', aliases: ['the innkeeper'], type: 'Character', path: '/Universes/Mira.md', reveal_point: null },
  { name: 'Lord Vhaeraun', aliases: ['the true villain'], type: 'Character', path: '/Universes/Lord Vhaeraun.md', reveal_point: 'Chapter 10' },
];

const SCENE_TEXT = '<<SCENE id="s1">>The hooded figure watched from the square.<</SCENE>>';

function inputWithContext(entityContext: string, position?: string): ProductionReviewInput {
  return { scopeLabel: 'Chapter 2', position, entityContext, sourceText: SCENE_TEXT };
}

describe('production-role live path — reveal-point spoiler safety (SKY-11411 / SKY-10741 AC2)', () => {
  it('Alpha Reader (reader-perspective) never receives a not-yet-revealed identity mid-story', () => {
    // Exactly what the handler does for a scene/chapter scope with a reader role.
    const dossier = buildReaderEntityContext(REVEAL_FIXTURE, 'Chapter 2');
    const content = buildProductionReviewUserContent('alphaReader', inputWithContext(dossier, 'Chapter 2'));

    // Pre-reveal entity is present…
    expect(content).toContain('Mira');
    // …but the post-reveal twist — canonical name AND its alias — is absent.
    expect(content).not.toContain('Lord Vhaeraun');
    expect(content).not.toContain('the true villain');
    // The reader-order instruction is present so the model can't "read ahead".
    expect(content).toContain('Only entities the reader has met so far');
  });

  it('Alpha Reader DOES see a post-reveal identity once the reader has finished the story', () => {
    // story scope → handler uses the whole-map (author) dossier for the reader role.
    const dossier = buildAuthorEntityContext(REVEAL_FIXTURE);
    const content = buildProductionReviewUserContent('alphaReader', inputWithContext(dossier));
    expect(content).toContain('Lord Vhaeraun');
  });

  it('craft roles (Storyline Consultant / Line Editor) legitimately see the whole map', () => {
    const dossier = buildAuthorEntityContext(REVEAL_FIXTURE);
    for (const role of ['storylineConsultant', 'lineEditor'] as const) {
      const content = buildProductionReviewUserContent(role, inputWithContext(dossier));
      expect(content).toContain('Lord Vhaeraun');
      expect(content).toContain('Full cast and continuity notes');
    }
  });

  it('a mid-story reader dossier and a full dossier differ exactly by the hidden identity', () => {
    const readerDossier = buildReaderEntityContext(REVEAL_FIXTURE, 'Chapter 2');
    const authorDossier = buildAuthorEntityContext(REVEAL_FIXTURE);
    // The author baseline leaks the twist; the reader path is the one that strips it.
    expect(authorDossier).toContain('Lord Vhaeraun');
    expect(readerDossier).not.toContain('Lord Vhaeraun');
    expect(readerDossier).toContain('Mira');
  });
});
