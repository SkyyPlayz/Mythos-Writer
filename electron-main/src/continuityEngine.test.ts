// Regression fixture for the continuity engine.
// Exercises ≥10 cross-chapter references against stable lore facts.
// All detection is deterministic (no LLM); driftScore is reproducible.

import { describe, it, expect } from 'vitest';
import {
  buildLoreFixture,
  checkChapterContinuity,
  checkMultiChapterContinuity,
} from './continuityEngine.js';
import type { ArchiveIndex } from './archiveAgent.js';

// ─── Stable lore fixture ──────────────────────────────────────────────────────
//
// Five characters with canonical properties used across 12 chapter texts below.
// These definitions are intentionally stable — do not change them without also
// updating the expected mismatch counts in the tests that depend on them.

const LORE_ARCHIVE: ArchiveIndex = {
  builtAt: '2024-01-01T00:00:00.000Z',
  entities: [
    // 1. Elara Nightwind — blonde, blue-eyed, female archer
    {
      id: 'ent-elara',
      name: 'Elara',
      type: 'character',
      aliases: ['Lady Nightwind', 'El'],
      properties: { hair: 'blonde', eyes: 'blue', gender: 'female' },
      prose: 'Elara Nightwind, a renowned archer from the Northern Kingdom.',
    },
    // 2. Darian Stoneforge — dark-haired, brown-eyed, male blacksmith
    {
      id: 'ent-darian',
      name: 'Darian',
      type: 'character',
      aliases: ['the Forge Master', 'Dar'],
      properties: { hair: 'dark hair', eyes: 'brown', gender: 'male' },
      prose: 'Darian Stoneforge, master of the Southern Forge.',
    },
    // 3. Lyra Whisperwind — red-haired, green-eyed, female mage
    {
      id: 'ent-lyra',
      name: 'Lyra',
      type: 'character',
      aliases: ['the Wind Mage'],
      properties: { hair: 'red hair', eyes: 'green', gender: 'female' },
      prose: 'Lyra Whisperwind, arch-mage of the Western Shores.',
    },
    // 4. Commander Halvard — grey-haired, grey-eyed, male military leader
    {
      id: 'ent-halvard',
      name: 'Commander Halvard',
      type: 'character',
      aliases: ['Halvard'],
      properties: { hair: 'grey hair', eyes: 'grey', gender: 'male' },
      prose: 'Commander Halvard, veteran of the Stone Bridge campaign.',
    },
    // 5. Mira — brown-haired, brown-eyed, female healer
    {
      id: 'ent-mira',
      name: 'Mira',
      type: 'character',
      aliases: [],
      properties: { hair: 'brown hair', eyes: 'brown', gender: 'female' },
      prose: 'Mira, healer of the Northern settlement.',
    },
  ],
};

// ─── Chapter texts ────────────────────────────────────────────────────────────
// 12 texts covering 5 characters — each tests one or more lore references.

// ch-01: Elara described accurately — 0 mismatches
const CH_01_ELARA_CLEAN = `
Elara stood at the ridge, her blonde hair streaming in the wind.
Her blue eyes scanned the valley below for movement.
She notched an arrow and waited.
`;

// ch-02: Darian described accurately — 0 mismatches
const CH_02_DARIAN_CLEAN = `
Darian's dark hair was matted with soot from the forge.
He wiped his brow and inspected the blade he had just tempered.
The Forge Master smiled — it was his finest work yet.
`;

// ch-03: Lyra described accurately — 0 mismatches
const CH_03_LYRA_CLEAN = `
Lyra let her red hair loose as she climbed the tower stairs.
Her green eyes caught the flicker of the summoning flame.
She was the Wind Mage, and tonight the winds would obey.
`;

// ch-04: Commander Halvard described accurately — 0 mismatches
const CH_04_HALVARD_CLEAN = `
Commander Halvard's grey hair glinted beneath his helmet.
He surveyed the troops with the steady eyes of a veteran.
His orders were few, but each one counted.
`;

// ch-05: Mira described accurately — 0 mismatches
const CH_05_MIRA_CLEAN = `
Mira knelt beside the wounded soldier.
Her brown hair fell forward as she worked, her brown eyes intent.
She pressed a cloth to the wound and began to sing a healer's hymn.
`;

// ch-06: Elara with "dark hair" — 1 mismatch (hair: blonde contradicts dark hair)
const CH_06_ELARA_DARK_HAIR = `
Elara emerged from the forest, dark hair tangled with leaves.
She had not slept in three days, and her eyes showed it.
`;

// ch-07: Elara with "green eyes" — 1 mismatch (eyes: blue contradicts green eyes)
const CH_07_ELARA_WRONG_EYES = `
Elara raised her head. Her green eyes met his across the firelight.
"You should not have followed me," she said quietly.
`;

// ch-08: Darian referred to as "she"/"her" — 1 mismatch (gender: male contradicts she/her)
const CH_08_DARIAN_WRONG_GENDER = `
Darian arrived at the council chambers.
She set the newly forged sword on the table without ceremony.
Everyone in the room knew what her silence meant.
`;

// ch-09: Lyra with "brown hair" — 1 mismatch (hair: red hair contradicts brown hair)
const CH_09_LYRA_BROWN_HAIR = `
Lyra paced the courtyard, her brown hair tied back from her face.
The Wind Mage had not slept since the prophecy arrived.
`;

// ch-10: Commander Halvard referred to as "she" — 1 mismatch (gender: male)
const CH_10_HALVARD_WRONG_GENDER = `
Commander Halvard rode ahead.
She raised her fist to signal the halt, and the column stopped.
`;

// ch-11: Mira with "blonde hair" — 1 mismatch (hair: brown hair contradicts blonde hair)
const CH_11_MIRA_BLONDE = `
Mira stepped into the lamplight, her blonde hair bright against
the dark stone of the infirmary walls.
`;

// ch-12: Multiple characters with multiple contradictions — 3 mismatches expected:
//   Elara: dark hair (hair mismatch)
//   Darian: she (gender mismatch)
//   Lyra: brown hair (hair mismatch)
const CH_12_MULTI_DRIFT = `
Elara pushed dark hair from her eyes as she scanned the horizon.
Nearby, Darian sharpened her blade in silence.
Lyra watched them both, running fingers through her brown hair.
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

const FIXTURE = buildLoreFixture(LORE_ARCHIVE);

describe('buildLoreFixture', () => {
  it('builds one fact per entity', () => {
    expect(FIXTURE.facts).toHaveLength(5);
  });

  it('preserves entity name, aliases, and properties', () => {
    const elara = FIXTURE.facts.find((f) => f.entityId === 'ent-elara');
    expect(elara?.entityName).toBe('Elara');
    expect(elara?.aliases).toContain('Lady Nightwind');
    expect(elara?.properties['hair']).toBe('blonde');
    expect(elara?.properties['eyes']).toBe('blue');
  });

  it('returns empty fixture for empty archive', () => {
    const empty = buildLoreFixture({ entities: [], builtAt: '' });
    expect(empty.facts).toHaveLength(0);
  });
});

describe('checkChapterContinuity — clean chapters (no drift)', () => {
  it('ch-01: Elara clean — 0 mismatches', () => {
    const result = checkChapterContinuity(CH_01_ELARA_CLEAN, FIXTURE, 'ch-01');
    expect(result.mismatchCount).toBe(0);
    expect(result.entitiesReferenced).toContain('Elara');
  });

  it('ch-02: Darian clean — 0 mismatches', () => {
    const result = checkChapterContinuity(CH_02_DARIAN_CLEAN, FIXTURE, 'ch-02');
    expect(result.mismatchCount).toBe(0);
    expect(result.entitiesReferenced).toContain('Darian');
  });

  it('ch-03: Lyra clean — 0 mismatches', () => {
    const result = checkChapterContinuity(CH_03_LYRA_CLEAN, FIXTURE, 'ch-03');
    expect(result.mismatchCount).toBe(0);
    expect(result.entitiesReferenced).toContain('Lyra');
  });

  it('ch-04: Halvard clean — 0 mismatches', () => {
    const result = checkChapterContinuity(CH_04_HALVARD_CLEAN, FIXTURE, 'ch-04');
    expect(result.mismatchCount).toBe(0);
  });

  it('ch-05: Mira clean — 0 mismatches', () => {
    const result = checkChapterContinuity(CH_05_MIRA_CLEAN, FIXTURE, 'ch-05');
    expect(result.mismatchCount).toBe(0);
    expect(result.entitiesReferenced).toContain('Mira');
  });

  it('chapter with no entity mentions — 0 checks, 0 mismatches', () => {
    const result = checkChapterContinuity(
      'The rain fell for three days without pause.',
      FIXTURE,
      'ch-no-entities',
    );
    expect(result.checkedCount).toBe(0);
    expect(result.mismatchCount).toBe(0);
    expect(result.entitiesReferenced).toHaveLength(0);
  });
});

describe('checkChapterContinuity — drift chapters (expected mismatches)', () => {
  it('ch-06: Elara with dark hair — detects hair contradiction', () => {
    const result = checkChapterContinuity(CH_06_ELARA_DARK_HAIR, FIXTURE, 'ch-06');
    expect(result.mismatchCount).toBeGreaterThanOrEqual(1);
    const m = result.mismatches.find((x) => x.entityName === 'Elara' && x.propKey === 'hair');
    expect(m).toBeDefined();
    expect(m?.canonicalValue).toBe('blonde');
    expect(m?.contradictingPhrase).toBe('dark hair');
  });

  it('ch-07: Elara with green eyes — detects eye-color contradiction', () => {
    const result = checkChapterContinuity(CH_07_ELARA_WRONG_EYES, FIXTURE, 'ch-07');
    expect(result.mismatchCount).toBeGreaterThanOrEqual(1);
    const m = result.mismatches.find((x) => x.entityName === 'Elara' && x.propKey === 'eyes');
    expect(m).toBeDefined();
    expect(m?.canonicalValue).toBe('blue');
    expect(m?.contradictingPhrase).toContain('green eyes');
  });

  it('ch-08: Darian with wrong gender pronoun — detects gender mismatch', () => {
    const result = checkChapterContinuity(CH_08_DARIAN_WRONG_GENDER, FIXTURE, 'ch-08');
    expect(result.mismatchCount).toBeGreaterThanOrEqual(1);
    const m = result.mismatches.find((x) => x.entityName === 'Darian' && x.propKey === 'gender');
    expect(m).toBeDefined();
    expect(m?.canonicalValue).toBe('male');
  });

  it('ch-09: Lyra with brown hair — detects hair contradiction', () => {
    const result = checkChapterContinuity(CH_09_LYRA_BROWN_HAIR, FIXTURE, 'ch-09');
    expect(result.mismatchCount).toBeGreaterThanOrEqual(1);
    const m = result.mismatches.find((x) => x.entityName === 'Lyra' && x.propKey === 'hair');
    expect(m).toBeDefined();
    expect(m?.canonicalValue).toBe('red hair');
    expect(m?.contradictingPhrase).toBe('brown hair');
  });

  it('ch-10: Halvard with wrong gender pronoun — detects gender mismatch', () => {
    const result = checkChapterContinuity(CH_10_HALVARD_WRONG_GENDER, FIXTURE, 'ch-10');
    expect(result.mismatchCount).toBeGreaterThanOrEqual(1);
    const m = result.mismatches.find(
      (x) => x.entityName === 'Commander Halvard' && x.propKey === 'gender',
    );
    expect(m).toBeDefined();
  });

  it('ch-11: Mira with blonde hair — detects hair contradiction', () => {
    const result = checkChapterContinuity(CH_11_MIRA_BLONDE, FIXTURE, 'ch-11');
    expect(result.mismatchCount).toBeGreaterThanOrEqual(1);
    const m = result.mismatches.find((x) => x.entityName === 'Mira' && x.propKey === 'hair');
    expect(m).toBeDefined();
    expect(m?.canonicalValue).toBe('brown hair');
    expect(m?.contradictingPhrase).toContain('blonde hair');
  });
});

describe('checkChapterContinuity — mismatch detail quality', () => {
  it('includes a non-empty snippet for every mismatch', () => {
    const result = checkChapterContinuity(CH_06_ELARA_DARK_HAIR, FIXTURE, 'ch-06');
    for (const m of result.mismatches) {
      expect(m.snippet.length).toBeGreaterThan(0);
    }
  });

  it('ch-12: multi-drift chapter — detects all contradictions', () => {
    const result = checkChapterContinuity(CH_12_MULTI_DRIFT, FIXTURE, 'ch-12');
    expect(result.mismatchCount).toBeGreaterThanOrEqual(3);
    const names = result.mismatches.map((m) => m.entityName);
    expect(names).toContain('Elara');
    expect(names).toContain('Darian');
    expect(names).toContain('Lyra');
  });
});

describe('checkMultiChapterContinuity — aggregate metrics', () => {
  it('clean run across 5 chapters has driftScore 0', () => {
    const metrics = checkMultiChapterContinuity(
      [
        { text: CH_01_ELARA_CLEAN, scenePath: 'ch-01' },
        { text: CH_02_DARIAN_CLEAN, scenePath: 'ch-02' },
        { text: CH_03_LYRA_CLEAN, scenePath: 'ch-03' },
        { text: CH_04_HALVARD_CLEAN, scenePath: 'ch-04' },
        { text: CH_05_MIRA_CLEAN, scenePath: 'ch-05' },
      ],
      FIXTURE,
    );
    expect(metrics.totalMismatchCount).toBe(0);
    expect(metrics.driftScore).toBe(0);
    expect(metrics.chapters).toHaveLength(5);
  });

  it('mixed run reports non-zero driftScore', () => {
    const metrics = checkMultiChapterContinuity(
      [
        { text: CH_01_ELARA_CLEAN, scenePath: 'ch-01' },
        { text: CH_06_ELARA_DARK_HAIR, scenePath: 'ch-06' },
        { text: CH_07_ELARA_WRONG_EYES, scenePath: 'ch-07' },
        { text: CH_08_DARIAN_WRONG_GENDER, scenePath: 'ch-08' },
        { text: CH_09_LYRA_BROWN_HAIR, scenePath: 'ch-09' },
      ],
      FIXTURE,
    );
    expect(metrics.totalMismatchCount).toBeGreaterThanOrEqual(4);
    expect(metrics.driftScore).toBeGreaterThan(0);
    expect(metrics.driftScore).toBeLessThanOrEqual(1);
  });

  it('totalCheckedCount covers checks across all chapters', () => {
    const metrics = checkMultiChapterContinuity(
      [
        { text: CH_01_ELARA_CLEAN, scenePath: 'ch-01' },
        { text: CH_02_DARIAN_CLEAN, scenePath: 'ch-02' },
      ],
      FIXTURE,
    );
    expect(metrics.totalCheckedCount).toBeGreaterThan(0);
  });

  it('empty chapter list returns zero metrics', () => {
    const metrics = checkMultiChapterContinuity([], FIXTURE);
    expect(metrics.totalCheckedCount).toBe(0);
    expect(metrics.totalMismatchCount).toBe(0);
    expect(metrics.driftScore).toBe(0);
    expect(metrics.chapters).toHaveLength(0);
  });

  it('driftScore equals mismatchCount / checkedCount', () => {
    const metrics = checkMultiChapterContinuity(
      [
        { text: CH_06_ELARA_DARK_HAIR, scenePath: 'ch-06' },
        { text: CH_07_ELARA_WRONG_EYES, scenePath: 'ch-07' },
      ],
      FIXTURE,
    );
    if (metrics.totalCheckedCount > 0) {
      const expected = metrics.totalMismatchCount / metrics.totalCheckedCount;
      expect(metrics.driftScore).toBeCloseTo(expected, 10);
    }
  });

  it('12-chapter full regression fixture — detects all drift, leaves clean chapters clean', () => {
    const allChapters = [
      { text: CH_01_ELARA_CLEAN,        scenePath: 'ch-01' },
      { text: CH_02_DARIAN_CLEAN,       scenePath: 'ch-02' },
      { text: CH_03_LYRA_CLEAN,         scenePath: 'ch-03' },
      { text: CH_04_HALVARD_CLEAN,      scenePath: 'ch-04' },
      { text: CH_05_MIRA_CLEAN,         scenePath: 'ch-05' },
      { text: CH_06_ELARA_DARK_HAIR,    scenePath: 'ch-06' },
      { text: CH_07_ELARA_WRONG_EYES,   scenePath: 'ch-07' },
      { text: CH_08_DARIAN_WRONG_GENDER, scenePath: 'ch-08' },
      { text: CH_09_LYRA_BROWN_HAIR,    scenePath: 'ch-09' },
      { text: CH_10_HALVARD_WRONG_GENDER, scenePath: 'ch-10' },
      { text: CH_11_MIRA_BLONDE,        scenePath: 'ch-11' },
      { text: CH_12_MULTI_DRIFT,        scenePath: 'ch-12' },
    ];
    const metrics = checkMultiChapterContinuity(allChapters, FIXTURE);

    // Clean chapters (ch-01 to ch-05) have 0 mismatches
    for (const ch of metrics.chapters.slice(0, 5)) {
      expect(ch.mismatchCount).toBe(0);
    }

    // Drift chapters (ch-06 to ch-12) each have ≥1 mismatch
    for (const ch of metrics.chapters.slice(5)) {
      expect(ch.mismatchCount).toBeGreaterThanOrEqual(1);
    }

    // Overall drift score is non-zero
    expect(metrics.driftScore).toBeGreaterThan(0);
    // Total chapters match
    expect(metrics.chapters).toHaveLength(12);
  });
});
