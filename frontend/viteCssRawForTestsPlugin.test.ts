import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cssRawForTestsPlugin } from './viteCssRawForTestsPlugin';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const importer = path.join(frontendRoot, 'src/WorkspaceTabBar.test.tsx');

type ResolveFn = (id: string, importer?: string) => string | null;
type LoadFn = (id: string) => string | null;

function bindHooks(): { resolve: ResolveFn; load: LoadFn } {
  const plugin = cssRawForTestsPlugin();
  const resolveRaw = plugin.resolveId;
  const loadRaw = plugin.load;
  if (typeof resolveRaw !== 'function' || typeof loadRaw !== 'function') {
    throw new Error('expected function hooks');
  }
  return {
    resolve: (id, imp) => {
      const out = resolveRaw.call({}, id, imp) as unknown;
      if (typeof out === 'string') return out;
      return null;
    },
    load: (id) => {
      const out = loadRaw.call({}, id) as unknown;
      if (typeof out === 'string') return out;
      return null;
    },
  };
}

describe('cssRawForTestsPlugin (Shield BLOCK 5357119278)', () => {
  it('resolves in-tree .css?raw and loads real CSS text', () => {
    const { resolve, load } = bindHooks();
    // Same shape as WorkspaceTabBar.test.tsx: relative import beside the test file.
    const id = resolve('./WorkspaceTabBar.css?raw', importer);
    expect(id).toBeTypeOf('string');
    expect(id!.startsWith('\0mythos-css-raw:')).toBe(true);
    const mod = load(id!);
    expect(mod).toBeTypeOf('string');
    expect(mod!.startsWith('export default "')).toBe(true);
    expect(mod!).toContain('.wtb-tab');
  });

  // Shield (5): three refusal cases — go red if containment/allow-set is reverted.
  it('refuses relative traversal outside frontend/', () => {
    const { resolve } = bindHooks();
    expect(resolve('../../../../tmp/x.css?raw', importer)).toBeNull();
  });

  it('refuses absolute path outside frontend/', () => {
    const { resolve } = bindHooks();
    expect(resolve('/tmp/outside.css?raw')).toBeNull();
    expect(resolve('/etc/passwd.css?raw')).toBeNull();
  });

  it('refuses crafted \\0mythos-css-raw: id not issued by resolveId', () => {
    const { load } = bindHooks();
    expect(load('\0mythos-css-raw:/tmp/shield-canary.txt.rawtxt')).toBeNull();
    const forgedInTree = `\0mythos-css-raw:${path.join(frontendRoot, 'src/WorkspaceTabBar.css')}.rawtxt`;
    expect(load(forgedInTree)).toBeNull();
  });

  it('does not match non-.css?raw ids', () => {
    const { resolve } = bindHooks();
    expect(resolve('./src/WorkspaceTabBar.css')).toBeNull();
    expect(resolve('./src/WorkspaceTabBar.css?url')).toBeNull();
  });
});
