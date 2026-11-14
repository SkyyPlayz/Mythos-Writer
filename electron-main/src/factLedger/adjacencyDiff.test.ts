import { describe, expect, it } from 'vitest';
import { adjacencyDiff, normalizeFactText, type SceneFact, type SceneFacts } from './adjacencyDiff.js';

function fact(entity: string, attribute: string, value: string, start = 0): SceneFact {
  return { entity, attribute, value, quote: `${value} ${attribute}`, start };
}

function scene(sceneId: string, ...facts: SceneFact[]): SceneFacts {
  return { sceneId, facts };
}

function brief(scenes: SceneFacts[]): string[] {
  return adjacencyDiff(scenes).map((c) => `${c.entity}.${c.attribute}: ${c.a} -> ${c.b} (${c.sceneA} -> ${c.sceneB})`);
}

describe('adjacencyDiff', () => {
  it.each<[string, SceneFacts[], string[]]>([
    ['no scenes', [], []],
    ['one scene', [scene('s1', fact('Oren', 'hair', 'grey'))], []],
    ['same value in neighbours', [scene('s1', fact('Oren', 'hair', 'grey')), scene('s2', fact('Oren', 'hair', 'grey'))], []],
    [
      'a change between neighbours',
      [scene('s1', fact('Oren', 'hair', 'grey')), scene('s2', fact('Oren', 'hair', 'black'))],
      ['Oren.hair: grey -> black (s1 -> s2)'],
    ],
    [
      'a change across a scene that does not mention it',
      [scene('s1', fact('Oren', 'hair', 'grey')), scene('s2', fact('Lise', 'eyes', 'blue')), scene('s3', fact('Oren', 'hair', 'black'))],
      ['Oren.hair: grey -> black (s1 -> s3)'],
    ],
    [
      'case and spacing differences are not changes',
      [scene('s1', fact('Oren', 'Hair', 'Silver  grey')), scene('s2', fact(' oren ', 'hair', 'silver grey'))],
      [],
    ],
    [
      'different attributes and entities are separate',
      [
        scene('s1', fact('Oren', 'hair', 'grey'), fact('Lise', 'hair', 'red')),
        scene('s2', fact('Oren', 'eyes', 'brown'), fact('Lise', 'hair', 'red')),
      ],
      [],
    ],
    [
      'a change back is a second change',
      [
        scene('s1', fact('Oren', 'hair', 'grey')),
        scene('s2', fact('Oren', 'hair', 'black')),
        scene('s3', fact('Oren', 'hair', 'grey')),
      ],
      ['Oren.hair: grey -> black (s1 -> s2)', 'Oren.hair: black -> grey (s2 -> s3)'],
    ],
    [
      'compares the last value of one scene with the first of the next',
      [
        scene('s1', fact('Oren', 'hair', 'black', 90), fact('Oren', 'hair', 'grey', 10)),
        scene('s2', fact('Oren', 'hair', 'white', 50), fact('Oren', 'hair', 'black', 5)),
      ],
      [],
    ],
    [
      'a change inside one scene is not reported here',
      [scene('s1', fact('Oren', 'hair', 'grey', 1), fact('Oren', 'hair', 'black', 2))],
      [],
    ],
  ])('%s', (_label, scenes, expected) => {
    expect(brief(scenes)).toEqual(expected);
  });

  it('returns the bracketing facts', () => {
    const a = fact('Oren', 'hair', 'grey', 3);
    const b = fact('Oren', 'hair', 'black', 7);
    const [change] = adjacencyDiff([scene('s1', a), scene('s2', b)]);
    expect(change.factA).toBe(a);
    expect(change.factB).toBe(b);
  });

  it('does not mutate its input', () => {
    const facts = [fact('Oren', 'hair', 'black', 9), fact('Oren', 'hair', 'grey', 1)];
    const input = [scene('s1', ...facts)];
    adjacencyDiff(input);
    expect(input[0].facts.map((f) => f.start)).toEqual([9, 1]);
  });

  it('normalizeFactText trims, collapses whitespace and lowercases', () => {
    expect(normalizeFactText('  Silver\n\tGrey ')).toBe('silver grey');
  });
});
