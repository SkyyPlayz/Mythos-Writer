// Fuzz and negative tests for the layout v3 validator: hostile JSON, prototype pollution, limits, and FrameState round trips.
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAYOUT_WIDGETS,
  LayoutV3Schema,
  MAX_LAYOUT_BYTES,
  MAX_LAYOUT_DEPTH,
  MAX_LAYOUT_NODES,
  frameStateFromLayout,
  layoutFromFrameState,
  layoutReviver,
  parseLayoutV3,
  serializeLayoutV3,
  type LayoutLeaf,
  type LayoutNode,
  type LayoutV3,
} from './layoutSchema';
import {
  FRAME_WIDGETS,
  frameReducer,
  initialFrameState,
  type DockEdge,
  type FrameAction,
  type FrameState,
  type FrameWidgetKind,
} from './widgetRegistry';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- helpers ------------------------------------------------------------------------------------

const CENTER_JSON = '{"type":"leaf","id":"center","widget":"center"}';
const doc = (root: string, locked = true): string => `{"version":3,"locked":${locked},"root":${root}}`;
const rowWith = (...children: string[]): string => `{"type":"branch","orientation":"row","children":[${children.join(',')}]}`;
const leafJson = (id: string, widget: string, extra = ''): string =>
  `{"type":"leaf","id":${JSON.stringify(id)},"widget":${JSON.stringify(widget)}${extra}}`;

function protoFingerprint(): string {
  const describeProto = (proto: object): string =>
    Reflect.ownKeys(proto)
      .map((key) => String(key))
      .sort()
      .join(',');
  return [Object.prototype, Array.prototype, Function.prototype].map(describeProto).join('|');
}

function expectOk(text: string): { layout: LayoutV3; replaced: number } {
  const result = parseLayoutV3(text);
  if (!result.ok) throw new Error(`expected ok, got reason ${result.reason}`);
  return result;
}

function leavesOf(node: LayoutNode, out: LayoutLeaf[] = []): LayoutLeaf[] {
  if (node.type === 'leaf') out.push(node);
  else for (const child of node.children) leavesOf(child, out);
  return out;
}

/** Walks a parsed layout: plain Object.prototype objects only, known keys only, no prototype-ish own keys. */
function assertCleanTree(value: unknown, allowed: readonly string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) assertCleanTree(item, allowed);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  for (const key of Object.keys(value)) {
    expect(allowed).toContain(key);
    expect(['__proto__', 'constructor', 'prototype']).not.toContain(key);
    assertCleanTree((value as Record<string, unknown>)[key], allowed);
  }
}
const ALLOWED_KEYS = ['version', 'locked', 'root', 'type', 'id', 'widget', 'copy', 'size', 'orientation', 'children', 'sizes'] as const;

/** Chain of `depth` nodes: depth-1 nested branches, each with a placeholder sibling, ending in the center leaf. */
function chainDoc(depth: number): string {
  let inner = CENTER_JSON;
  for (let level = depth - 1; level >= 1; level -= 1) {
    inner = rowWith(leafJson(`placeholder:${level}`, 'placeholder'), inner);
  }
  return doc(inner);
}

function wideDoc(leafCount: number): string {
  const leaves = [CENTER_JSON];
  for (let i = 1; i < leafCount; i += 1) leaves.push(leafJson(`placeholder:${i}`, 'placeholder'));
  return doc(rowWith(...leaves));
}

// ---- explicit negatives -------------------------------------------------------------------------

describe('size cap', () => {
  it('rejects a 300 KB document before JSON.parse runs', () => {
    const big = doc(CENTER_JSON) + ' '.repeat(300 * 1024);
    const spy = vi.spyOn(JSON, 'parse');
    const result = parseLayoutV3(big);
    expect(result).toEqual({ ok: false, reason: 'too-large' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('measures UTF-8 bytes, not UTF-16 units', () => {
    const euros = `"${'€'.repeat(90000)}"`; // 90k chars, 270k bytes
    expect(euros.length).toBeLessThan(MAX_LAYOUT_BYTES);
    const spy = vi.spyOn(JSON, 'parse');
    expect(parseLayoutV3(euros)).toEqual({ ok: false, reason: 'too-large' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts a document of exactly 256 KB and rejects one byte more', () => {
    const base = doc(CENTER_JSON);
    expect(parseLayoutV3(base + ' '.repeat(MAX_LAYOUT_BYTES - base.length)).ok).toBe(true);
    expect(parseLayoutV3(base + ' '.repeat(MAX_LAYOUT_BYTES - base.length + 1))).toEqual({ ok: false, reason: 'too-large' });
  });
});

describe('prototype keys', () => {
  const hostileDocs: Record<string, string> = {
    'top-level __proto__': `{"__proto__":{"polluted":true},"version":3,"locked":true,"root":${CENTER_JSON}}`,
    'top-level constructor': `{"constructor":{"prototype":{"polluted":true}},"version":3,"locked":true,"root":${CENTER_JSON}}`,
    'root leaf __proto__': doc('{"type":"leaf","id":"center","widget":"center","__proto__":{"polluted":true}}'),
    'root leaf prototype': doc('{"type":"leaf","id":"center","widget":"center","prototype":{"polluted":true}}'),
    'depth 2 constructor': doc(
      rowWith(leafJson('navRail', 'navRail', ',"constructor":{"prototype":{"polluted":true}}'), CENTER_JSON),
    ),
    'depth 3 __proto__ in branch': doc(
      rowWith(
        leafJson('placeholder:1', 'placeholder'),
        `{"type":"branch","orientation":"column","__proto__":{"polluted":true},"children":[${CENTER_JSON}]}`,
      ),
    ),
    'nested object in sizes-like position': doc(
      `{"type":"branch","orientation":"row","children":[${CENTER_JSON}],"sizes":[0.5],"__proto__":{"polluted":true,"prototype":{"x":1}}}`,
    ),
  };

  for (const [name, text] of Object.entries(hostileDocs)) {
    it(`drops the key and leaves Object.prototype untouched: ${name}`, () => {
      const before = protoFingerprint();
      const { layout, replaced } = expectOk(text);
      expect(replaced).toBe(0); // the hostile key was removed, not the node
      expect(protoFingerprint()).toBe(before);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.keys(Object.prototype)).toEqual([]);
      expect(JSON.stringify(layout)).not.toContain('polluted');
      assertCleanTree(layout, ALLOWED_KEYS);
      expect(leavesOf(layout.root).some((leaf) => leaf.widget === 'center')).toBe(true);
    });
  }

  it('reviver is what removes them: it is passed to JSON.parse and drops exactly the three keys', () => {
    const spy = vi.spyOn(JSON, 'parse');
    parseLayoutV3(hostileDocs['top-level __proto__']);
    expect(spy).toHaveBeenCalledTimes(1);
    const reviver = spy.mock.calls[0][1] as (this: unknown, key: string, value: unknown) => unknown;
    expect(typeof reviver).toBe('function');
    expect(reviver).toBe(layoutReviver);
    for (const key of ['__proto__', 'constructor', 'prototype']) expect(reviver.call({}, key, { x: 1 })).toBeUndefined();
    for (const key of ['type', 'id', 'widget', 'children', '0', '']) expect(reviver.call({}, key, 7)).toBe(7);
    // Run for real: the revived value has none of the keys at any depth.
    const revived = JSON.parse(hostileDocs['depth 3 __proto__ in branch'], layoutReviver) as unknown;
    expect(JSON.stringify(revived)).not.toContain('polluted');
    expect(Object.prototype.hasOwnProperty.call(revived, '__proto__')).toBe(false);
  });

  it('without the reviver the strict schema would reject these documents, so parse only succeeds because of it', () => {
    for (const text of Object.values(hostileDocs)) {
      const unrevived = JSON.parse(text) as unknown;
      expect(LayoutV3Schema.safeParse(unrevived).success).toBe(false);
      expect(parseLayoutV3(text).ok).toBe(true);
    }
  });

  it('an id spelled like a prototype key is only data, not a key', () => {
    const before = protoFingerprint();
    const { layout } = expectOk(doc(rowWith(leafJson('__proto__', 'placeholder'), CENTER_JSON)));
    expect(leavesOf(layout.root).map((leaf) => leaf.id)).toContain('__proto__');
    expect(protoFingerprint()).toBe(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('unknown widgets become inert placeholders', () => {
  const unknowns = ['evil', 'Center', 'leftSidebar ', '../../etc/passwd', 'constructor', '__proto__', 'toString', '<script>', ''];
  for (const widget of unknowns) {
    it(`widget ${JSON.stringify(widget)}`, () => {
      const { layout, replaced } = expectOk(doc(rowWith(leafJson('leftSidebar', widget), CENTER_JSON)));
      expect(replaced).toBe(1);
      const placeholder = leavesOf(layout.root).find((leaf) => leaf.widget === 'placeholder');
      expect(placeholder).toEqual({ type: 'leaf', id: 'placeholder:1', widget: 'placeholder' });
      expect(serializeLayoutV3(layout)).not.toContain(widget === '' ? '\u0000' : `"${widget}"`);
      expect(frameStateFromLayout(layout).instances.filter((inst) => inst.copy === 0).map((inst) => inst.id)).toEqual(
        FRAME_WIDGETS.map((def) => def.kind),
      );
    });
  }

  it('a non-string widget is rejected as a node, not resolved', () => {
    for (const widget of ['1', 'null', '{}', '["center"]', 'true']) {
      const text = doc(rowWith(`{"type":"leaf","id":"x","widget":${widget}}`, CENTER_JSON));
      const { layout, replaced } = expectOk(text);
      expect(replaced).toBe(1);
      expect(leavesOf(layout.root).map((leaf) => leaf.widget)).toEqual(['placeholder', 'center']);
    }
  });

  it('every allowlisted widget name is a registry kind, center or placeholder', () => {
    expect([...LAYOUT_WIDGETS].sort()).toEqual(['center', 'placeholder', ...FRAME_WIDGETS.map((def) => def.kind)].sort());
  });
});

describe('sizes', () => {
  const sizeTexts: Array<[string, string]> = [
    ['null (what NaN and Infinity serialize to)', 'null'],
    ['1e308 (finite but above 10000)', '1e308'],
    ['1e309 (parses to Infinity)', '1e309'],
    ['-1e309', '-1e309'],
    ['-5', '-5'],
    ['10000.5', '10000.5'],
    ['a string', '"300"'],
    ['an object', '{"px":300}'],
    ['an array', '[300]'],
    ['true', 'true'],
  ];
  for (const [name, text] of sizeTexts) {
    it(`leaf size ${name} replaces that leaf with a placeholder and keeps the layout valid`, () => {
      const { layout, replaced } = expectOk(doc(rowWith(leafJson('leftSidebar', 'leftSidebar', `,"size":${text}`), CENTER_JSON)));
      expect(replaced).toBe(1);
      expect(leavesOf(layout.root).map((leaf) => leaf.widget)).toEqual(['placeholder', 'center']);
      expect(JSON.stringify(layout)).not.toMatch(/1e|Infinity|NaN|300/);
      expect(LayoutV3Schema.safeParse(layout).success).toBe(true);
    });
  }

  it('NaN written as text is not JSON and is rejected whole', () => {
    expect(parseLayoutV3(doc('{"type":"leaf","id":"center","widget":"center","size":NaN}'))).toEqual({ ok: false, reason: 'invalid-json' });
  });

  it('accepts the 0 and 10000 px bounds', () => {
    const { layout, replaced } = expectOk(
      doc(rowWith(leafJson('leftSidebar', 'leftSidebar', ',"size":0'), leafJson('rightSidebar', 'rightSidebar', ',"size":10000'), CENTER_JSON)),
    );
    expect(replaced).toBe(0);
    expect(leavesOf(layout.root).map((leaf) => leaf.size)).toEqual([0, 10000, undefined]);
  });

  it('branch ratios must be finite and within [0,1] and match the child count', () => {
    for (const sizes of ['[0.5,2]', '[0.5,-0.1]', '[0.5,null]', '[0.5,1e309]', '[0.5]', '[0.5,0.2,0.3]', '"half"']) {
      const branch = `{"type":"branch","orientation":"row","sizes":${sizes},"children":[${leafJson('leftSidebar', 'leftSidebar')},${CENTER_JSON}]}`;
      // A rejected branch replaces its whole subtree, which here includes the center: the document fails.
      expect(parseLayoutV3(doc(branch))).toEqual({ ok: false, reason: 'missing-center' });
      // Nested next to the center, only the branch is replaced.
      const nested = rowWith(branch.replace(CENTER_JSON, leafJson('placeholder:9', 'placeholder')), CENTER_JSON);
      const { layout, replaced } = expectOk(doc(nested));
      expect(replaced).toBe(1);
      expect(leavesOf(layout.root).map((leaf) => leaf.widget)).toEqual(['placeholder', 'center']);
    }
    const ok = expectOk(doc(`{"type":"branch","orientation":"row","sizes":[0,1],"children":[${leafJson('leftSidebar', 'leftSidebar')},${CENTER_JSON}]}`));
    expect(ok.replaced).toBe(0);
  });

  it('a bad size on the center itself fails the whole layout', () => {
    expect(parseLayoutV3(doc('{"type":"leaf","id":"center","widget":"center","size":-5}'))).toEqual({ ok: false, reason: 'missing-center' });
  });
});

describe('depth and node limits', () => {
  it('accepts depth 16 and rejects depth 17', () => {
    const ok = expectOk(chainDoc(MAX_LAYOUT_DEPTH));
    expect(ok.replaced).toBe(0);
    expect(parseLayoutV3(chainDoc(MAX_LAYOUT_DEPTH + 1))).toEqual({ ok: false, reason: 'too-deep' });
  });

  it('accepts 256 nodes and rejects 257', () => {
    // one branch plus N leaves = N + 1 nodes
    expect(expectOk(wideDoc(MAX_LAYOUT_NODES - 1)).replaced).toBe(0);
    expect(parseLayoutV3(wideDoc(MAX_LAYOUT_NODES))).toEqual({ ok: false, reason: 'too-many-nodes' });
  });

  it('rejects a huge fan-out without walking it', () => {
    const many = Array.from({ length: 20000 }, () => '{}').join(',');
    expect(parseLayoutV3(doc(rowWith(CENTER_JSON, many)))).toEqual({ ok: false, reason: 'too-many-nodes' });
  });

  it('survives bracket bombs without throwing', () => {
    expect(parseLayoutV3('['.repeat(100000)).ok).toBe(false);
    expect(parseLayoutV3('{"a":'.repeat(40000)).ok).toBe(false);
    expect(parseLayoutV3(doc(`{"type":"branch","orientation":"row","children":${'['.repeat(60)}${']'.repeat(60)}}`)).ok).toBe(false);
  });

  it('does not count brackets inside strings', () => {
    const noisy = leafJson('x', `${'['.repeat(200)}\\"${'{'.repeat(200)}`);
    const { replaced } = expectOk(doc(rowWith(noisy, CENTER_JSON)));
    expect(replaced).toBe(1);
  });
});

describe('document shape', () => {
  it('rejects wrong envelopes', () => {
    const cases = [
      '',
      'not json',
      'null',
      '[]',
      '3',
      '"layout"',
      '{}',
      `{"version":2,"locked":true,"root":${CENTER_JSON}}`,
      `{"version":"3","locked":true,"root":${CENTER_JSON}}`,
      `{"version":3,"locked":"yes","root":${CENTER_JSON}}`,
      `{"version":3,"root":${CENTER_JSON}}`,
      `{"version":3,"locked":true,"root":${CENTER_JSON},"extra":1}`,
    ];
    for (const text of cases) expect(parseLayoutV3(text).ok).toBe(false);
  });

  it('requires the center exactly once', () => {
    expect(parseLayoutV3(doc(leafJson('placeholder:1', 'placeholder')))).toEqual({ ok: false, reason: 'missing-center' });
    expect(parseLayoutV3(doc(rowWith(CENTER_JSON, CENTER_JSON)))).toEqual({ ok: false, reason: 'multiple-centers' });
    expect(parseLayoutV3(doc(rowWith(leafJson('leftSidebar', 'leftSidebar'))))).toEqual({ ok: false, reason: 'missing-center' });
  });

  it('replaces leaves with extra keys, bad ids, duplicate ids and inconsistent copies', () => {
    const bad = [
      leafJson('leftSidebar', 'leftSidebar', ',"color":"red"'),
      leafJson('has space', 'navRail'),
      leafJson('a'.repeat(65), 'navRail'),
      leafJson('navRail', 'leftSidebar'),
      leafJson('rightSidebar:copy:2', 'rightSidebar', ',"copy":2'),
      leafJson('leftSidebar:copy:1', 'leftSidebar', ',"copy":1'),
      leafJson('leftSidebar:copy:2', 'leftSidebar', ',"copy":3'),
      leafJson('leftSidebar', 'leftSidebar', ',"copy":2.5'),
      leafJson('leftSidebar', 'leftSidebar', ',"copy":100'),
      leafJson('center', 'navRail'),
      leafJson('center', 'placeholder'),
      leafJson('x', 'center'),
      '{"type":"leaf","id":"navRail"}',
      '{"type":"mystery","children":[]}',
      '{"type":"branch","orientation":"diagonal","children":[]}',
      '{"type":"branch","orientation":"row","children":[]}',
      '42',
      'null',
    ];
    for (const node of bad) {
      const { layout, replaced } = expectOk(doc(rowWith(node, CENTER_JSON)));
      expect(replaced, node).toBe(1);
      expect(leavesOf(layout.root).map((leaf) => leaf.widget), node).toEqual(['placeholder', 'center']);
    }
    const dup = expectOk(doc(rowWith(leafJson('navRail', 'navRail'), leafJson('navRail', 'navRail'), CENTER_JSON)));
    expect(dup.replaced).toBe(1);
    expect(leavesOf(dup.layout.root).map((leaf) => leaf.widget)).toEqual(['navRail', 'placeholder', 'center']);
  });

  it('serialize then parse is stable', () => {
    const layout = layoutFromFrameState(initialFrameState(), { leftSidebar: 260, navRail: 72, rightSidebar: 320 });
    const text = serializeLayoutV3(layout);
    expect(expectOk(text).layout).toEqual(layout);
    expect(serializeLayoutV3(expectOk(text).layout)).toBe(text);
  });
});

// ---- converters ---------------------------------------------------------------------------------

describe('FrameState converters', () => {
  it('builds a deterministic tree with the last instance outermost', () => {
    const layout = layoutFromFrameState(initialFrameState());
    const center: LayoutLeaf = { type: 'leaf', id: 'center', widget: 'center' };
    const left: LayoutLeaf = { type: 'leaf', id: 'leftSidebar', widget: 'leftSidebar' };
    const nav: LayoutLeaf = { type: 'leaf', id: 'navRail', widget: 'navRail' };
    const right: LayoutLeaf = { type: 'leaf', id: 'rightSidebar', widget: 'rightSidebar' };
    expect(layout).toEqual({
      version: 3,
      locked: true,
      root: {
        type: 'branch',
        orientation: 'row',
        children: [
          { type: 'branch', orientation: 'row', children: [nav, { type: 'branch', orientation: 'row', children: [left, center] }] },
          right,
        ],
      },
    });
  });

  it('places top and bottom widgets in columns and records sizes (clamped, non-finite dropped)', () => {
    let state = frameReducer(initialFrameState(), { type: 'unlock' });
    state = frameReducer(state, { type: 'move', id: 'leftSidebar', edge: 'top' });
    state = frameReducer(state, { type: 'move', id: 'rightSidebar', edge: 'bottom' });
    const layout = layoutFromFrameState(state, { leftSidebar: 99999, navRail: Number.NaN, rightSidebar: -4, constructor: 5 } as Partial<
      Record<string, number>
    >);
    expect(LayoutV3Schema.safeParse(layout).success).toBe(true);
    const sizes = Object.fromEntries(leavesOf(layout.root).map((leaf) => [leaf.id, leaf.size]));
    expect(sizes).toEqual({ center: undefined, leftSidebar: 10000, navRail: undefined, rightSidebar: 0 });
    expect(layout.locked).toBe(false);
    expect(frameStateFromLayout(layout)).toEqual(state);
  });

  it('drops placeholders, restores missing originals at their home edge and copies locked', () => {
    const text = doc(
      rowWith(leafJson('placeholder:1', 'placeholder'), leafJson('navRail', 'navRail'), CENTER_JSON, leafJson('leftSidebar:copy:2', 'leftSidebar', ',"copy":2')),
      false,
    );
    const state = frameStateFromLayout(expectOk(text).layout);
    expect(state).toEqual({
      locked: false,
      instances: [
        { id: 'leftSidebar', kind: 'leftSidebar', edge: 'left', copy: 0 },
        { id: 'navRail', kind: 'navRail', edge: 'left', copy: 0 },
        { id: 'rightSidebar', kind: 'rightSidebar', edge: 'right', copy: 0 },
        { id: 'leftSidebar:copy:2', kind: 'leftSidebar', edge: 'right', copy: 2 },
      ],
    });
  });

  it('15 instances fit the depth cap and 16 do not', () => {
    let state = frameReducer(initialFrameState(), { type: 'unlock' });
    for (let i = 0; i < 12; i += 1) state = frameReducer(state, { type: 'duplicate', id: 'leftSidebar' });
    expect(state.instances).toHaveLength(15);
    const fits = expectOk(serializeLayoutV3(layoutFromFrameState(state)));
    expect(frameStateFromLayout(fits.layout)).toEqual(state);
    state = frameReducer(state, { type: 'duplicate', id: 'leftSidebar' });
    expect(state.instances).toHaveLength(16);
    expect(parseLayoutV3(serializeLayoutV3(layoutFromFrameState(state)))).toEqual({ ok: false, reason: 'too-deep' });
  });
});

// ---- property tests -----------------------------------------------------------------------------

const hostileKey = fc.constantFrom(
  '__proto__',
  'constructor',
  'prototype',
  'polluted',
  'type',
  'id',
  'widget',
  'copy',
  'size',
  'sizes',
  'children',
  'orientation',
  'root',
  'version',
  'locked',
);
const scalarText = fc.constantFrom(
  'null',
  'true',
  'false',
  '0',
  '-0',
  '-5',
  '2',
  '0.5',
  '1e308',
  '1e309',
  '-1e309',
  '10000',
  '10001',
  '""',
  '"center"',
  '"navRail"',
  '"leftSidebar"',
  '"rightSidebar"',
  '"leftSidebar:copy:2"',
  '"placeholder"',
  '"branch"',
  '"leaf"',
  '"row"',
  '"column"',
  '"evil"',
  '"__proto__"',
  '"constructor"',
);
const objectText = (entries: Array<[string, string]>): string =>
  `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(',')}}`;

/** Arbitrary JSON text built from layout-flavoured keys and values, with prototype keys mixed in anywhere. */
const hostileJsonText: fc.Arbitrary<string> = fc.letrec<{ value: string; array: string; object: string }>((tie) => ({
  value: fc.oneof({ maxDepth: 5 }, scalarText, tie('array'), tie('object')),
  array: fc.array(tie('value'), { maxLength: 4 }).map((items) => `[${items.join(',')}]`),
  object: fc.array(fc.tuple(hostileKey, tie('value')), { maxLength: 6 }).map(objectText),
})).value;

/** Layout-shaped documents with random flaws, so the interesting branches of the walker are reached often. */
const flawedLayoutText: fc.Arbitrary<string> = fc
  .letrec<{ node: string; leaf: string; branch: string }>((tie) => ({
    node: fc.oneof({ maxDepth: 4 }, tie('leaf'), tie('branch')),
    leaf: fc
      .record({
        id: fc.constantFrom('center', 'navRail', 'leftSidebar', 'rightSidebar', 'leftSidebar:copy:2', 'placeholder:1', '__proto__', 'x y'),
        widget: scalarText,
        extras: fc.array(fc.tuple(hostileKey, scalarText), { maxLength: 2 }),
        omitType: fc.boolean(),
      })
      .map(({ id, widget, extras, omitType }) =>
        objectText([...(omitType ? [] : ([['type', '"leaf"']] as Array<[string, string]>)), ['id', JSON.stringify(id)], ['widget', widget], ...extras]),
      ),
    branch: fc
      .record({
        orientation: fc.constantFrom('"row"', '"column"', '"diag"', 'null'),
        children: fc.array(tie('node'), { maxLength: 4 }),
        sizes: fc.option(fc.array(scalarText, { maxLength: 4 }).map((items) => `[${items.join(',')}]`), { nil: undefined }),
        extras: fc.array(fc.tuple(hostileKey, scalarText), { maxLength: 2 }),
      })
      .map(({ orientation, children, sizes, extras }) =>
        objectText([
          ['type', '"branch"'],
          ['orientation', orientation],
          ['children', `[${children.join(',')}]`],
          ...(sizes ? ([['sizes', sizes]] as Array<[string, string]>) : []),
          ...extras,
        ]),
      ),
  }))
  .node.chain((root) =>
    fc.constantFrom(
      doc(root),
      doc(root, false),
      doc(rowWith(root, CENTER_JSON)),
      doc(rowWith(CENTER_JSON, root, leafJson('navRail', 'navRail'))),
    ),
  );

function checkParseIsSafe(text: string): void {
  const before = protoFingerprint();
  const result = parseLayoutV3(text);
  expect(protoFingerprint()).toBe(before);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  if (!result.ok) return;
  expect(LayoutV3Schema.safeParse(result.layout).success).toBe(true);
  assertCleanTree(result.layout, ALLOWED_KEYS);
  const leaves = leavesOf(result.layout.root);
  expect(leaves.filter((leaf) => leaf.widget === 'center')).toHaveLength(1);
  expect(new Set(leaves.map((leaf) => leaf.id)).size).toBe(leaves.length);
  // Re-serializing never resurrects anything that was dropped.
  expect(parseLayoutV3(serializeLayoutV3(result.layout))).toEqual({ ok: true, layout: result.layout, replaced: 0 });
}

describe('fuzz: arbitrary input', () => {
  it('arbitrary strings never throw and never touch prototypes', () => {
    fc.assert(fc.property(fc.string({ maxLength: 400 }), checkParseIsSafe), { numRuns: 400 });
  });

  it('arbitrary JSON values never throw and never touch prototypes', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => checkParseIsSafe(JSON.stringify(value))),
      { numRuns: 400 },
    );
  });

  it('hostile layout-flavoured JSON never throws and never touches prototypes', () => {
    fc.assert(fc.property(hostileJsonText, (text) => checkParseIsSafe(text)), { numRuns: 600 });
    fc.assert(fc.property(hostileJsonText, (root) => checkParseIsSafe(doc(root))), { numRuns: 600 });
  });

  it('flawed layout documents never throw, and anything accepted is clean and valid', () => {
    let accepted = 0;
    fc.assert(
      fc.property(flawedLayoutText, (text) => {
        checkParseIsSafe(text);
        if (parseLayoutV3(text).ok) accepted += 1;
      }),
      { numRuns: 800 },
    );
    expect(accepted).toBeGreaterThan(20); // the generator does reach the accept path
  });

  it('a valid document with one token swapped for a hostile one never throws', () => {
    const base = serializeLayoutV3(layoutFromFrameState(initialFrameState(), { leftSidebar: 260, navRail: 72, rightSidebar: 320 }));
    const tokens = fc.constantFrom('null', '1e309', '-1e309', '1e308', '-1', '"__proto__"', '{"__proto__":{"polluted":1}}', '[]', '{}', '""');
    fc.assert(
      fc.property(fc.nat(), tokens, (at, token) => {
        const spots = [...base.matchAll(/(?<=[:[,])(?:\d+(?:\.\d+)?|true|false|"[^"]*")(?=[,}\]])/g)];
        const spot = spots[at % spots.length];
        const index = spot.index ?? 0;
        checkParseIsSafe(base.slice(0, index) + token + base.slice(index + spot[0].length));
      }),
      { numRuns: 400 },
    );
  });
});

const ratio = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }).map((x) => (x === 0 ? 0 : x));
const px = fc.double({ min: 0, max: 10000, noNaN: true, noDefaultInfinity: true }).map((x) => (x === 0 ? 0 : x));

type Shape =
  | { leaf: { kind: FrameWidgetKind | 'placeholder'; size: number | undefined } }
  | { branch: { orientation: 'row' | 'column'; children: Shape[]; ratios: number[] | undefined } };

const shapeArb: fc.Arbitrary<Shape> = fc.letrec<{ node: Shape; leaf: Shape; branch: Shape }>((tie) => ({
  node: fc.oneof({ maxDepth: 3 }, tie('leaf'), tie('branch')),
  leaf: fc
    .record({
      kind: fc.constantFrom<FrameWidgetKind | 'placeholder'>('navRail', 'leftSidebar', 'rightSidebar', 'placeholder'),
      size: fc.option(px, { nil: undefined }),
    })
    .map((leaf) => ({ leaf })),
  branch: fc
    .record({
      orientation: fc.constantFrom<'row' | 'column'>('row', 'column'),
      children: fc.array(tie('node'), { minLength: 1, maxLength: 4 }),
      ratios: fc.option(fc.array(ratio, { minLength: 4, maxLength: 4 }), { nil: undefined }),
    })
    .map((branch) => ({ branch })),
})).node;

/** Turns a random shape into a valid layout: unique ids, one center, copies numbered like the reducer does. */
function materialize(shape: Shape, centerPick: number, locked: boolean): LayoutV3 {
  const leafTotal = (s: Shape): number => ('leaf' in s ? 1 : s.branch.children.reduce((sum, child) => sum + leafTotal(child), 0));
  const centerAt = centerPick % leafTotal(shape);
  const seen: Partial<Record<FrameWidgetKind, number>> = {};
  let leafIndex = 0;
  let placeholders = 0;
  const build = (s: Shape): LayoutNode => {
    if ('branch' in s) {
      const children = s.branch.children.map(build);
      const branch: LayoutNode = { type: 'branch', orientation: s.branch.orientation, children };
      if (s.branch.ratios) branch.sizes = s.branch.ratios.slice(0, children.length);
      return branch;
    }
    const at = leafIndex;
    leafIndex += 1;
    if (at === centerAt) return { type: 'leaf', id: 'center', widget: 'center' };
    const { kind, size } = s.leaf;
    const withSize = <T extends LayoutLeaf>(leaf: T): T => (size === undefined ? leaf : { ...leaf, size });
    if (kind !== 'placeholder') {
      const before = seen[kind] ?? 0;
      const def = FRAME_WIDGETS.find((d) => d.kind === kind);
      if (before === 0) {
        seen[kind] = 1;
        return withSize({ type: 'leaf', id: kind, widget: kind });
      }
      if (def?.duplicable) {
        seen[kind] = before + 1;
        return withSize({ type: 'leaf', id: `${kind}:copy:${before + 1}`, widget: kind, copy: before + 1 });
      }
    }
    placeholders += 1;
    return withSize({ type: 'leaf', id: `placeholder:${placeholders}`, widget: 'placeholder' });
  };
  return { version: 3, locked, root: build(shape) };
}

const validLayoutArb = fc.tuple(shapeArb, fc.nat(), fc.boolean()).map(([shape, pick, locked]) => materialize(shape, pick, locked));

describe('fuzz: valid layouts and reachable states', () => {
  it('generated valid layouts satisfy the schema and survive serialize/parse unchanged', () => {
    fc.assert(
      fc.property(validLayoutArb, (layout) => {
        expect(LayoutV3Schema.safeParse(layout).success).toBe(true);
        const parsed = expectOk(serializeLayoutV3(layout));
        expect(parsed.replaced).toBe(0);
        expect(parsed.layout).toEqual(layout);
        assertCleanTree(parsed.layout, ALLOWED_KEYS);
        // Converting to a frame state never throws and always yields the three originals.
        const state = frameStateFromLayout(parsed.layout);
        expect(state.locked).toBe(layout.locked);
        expect(state.instances.slice(0, 3).map((inst) => inst.id)).toEqual(FRAME_WIDGETS.map((def) => def.kind));
      }),
      { numRuns: 500 },
    );
  });

  const edgeArb = fc.constantFrom<DockEdge>('left', 'right', 'top', 'bottom');
  const actionArb: fc.Arbitrary<{ pick: number; action: (id: string) => FrameAction }> = fc.oneof(
    { weight: 3, arbitrary: fc.nat().map((pick) => ({ pick, action: (): FrameAction => ({ type: 'unlock' }) })) },
    { weight: 1, arbitrary: fc.nat().map((pick) => ({ pick, action: (): FrameAction => ({ type: 'lock' }) })) },
    {
      weight: 5,
      arbitrary: fc.tuple(fc.nat(), edgeArb).map(([pick, edge]) => ({ pick, action: (id: string): FrameAction => ({ type: 'move', id, edge }) })),
    },
    { weight: 4, arbitrary: fc.nat().map((pick) => ({ pick, action: (id: string): FrameAction => ({ type: 'duplicate', id }) })) },
    { weight: 2, arbitrary: fc.nat().map((pick) => ({ pick, action: (id: string): FrameAction => ({ type: 'close', id }) })) },
  );

  it('every state reachable from initialFrameState round-trips through the layout, directly and through JSON', () => {
    let checked = 0;
    let withCopies = 0;
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 40 }), (steps) => {
        let state: FrameState = initialFrameState();
        const visit = (): void => {
          if (state.instances.length > MAX_LAYOUT_DEPTH - 1) return; // beyond the depth cap on purpose, covered separately
          const layout = layoutFromFrameState(state);
          expect(LayoutV3Schema.safeParse(layout).success).toBe(true);
          expect(frameStateFromLayout(layout)).toEqual(state);
          const viaJson = expectOk(serializeLayoutV3(layout));
          expect(viaJson.layout).toEqual(layout);
          expect(frameStateFromLayout(viaJson.layout)).toEqual(state);
          checked += 1;
          if (state.instances.length > 3) withCopies += 1;
        };
        visit();
        for (const step of steps) {
          const target = state.instances[step.pick % state.instances.length];
          state = frameReducer(state, step.action(target.id));
          visit();
        }
      }),
      { numRuns: 300 },
    );
    expect(checked).toBeGreaterThan(1000);
    expect(withCopies).toBeGreaterThan(100); // duplicates and mixed edges are actually exercised
  });

  it('sizes passed to the converter never break the round trip', () => {
    fc.assert(
      fc.property(
        fc.array(actionArb, { maxLength: 12 }),
        fc.dictionary(fc.constantFrom('leftSidebar', 'navRail', 'rightSidebar', 'leftSidebar:copy:2', 'center'), fc.double()),
        (steps, sizes) => {
          let state: FrameState = initialFrameState();
          for (const step of steps) state = frameReducer(state, step.action(state.instances[step.pick % state.instances.length].id));
          const layout = layoutFromFrameState(state, sizes);
          expect(LayoutV3Schema.safeParse(layout).success).toBe(true);
          expect(frameStateFromLayout(expectOk(serializeLayoutV3(layout)).layout)).toEqual(state);
        },
      ),
      { numRuns: 200 },
    );
  });
});
