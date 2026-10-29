/**
 * Test-only copy of the production Electron build that reveals the hidden
 * timeline modes. The shipped `out/` tree is never modified, and the app
 * has no localStorage key, URL param, env var, or debug toggle that unhides
 * those views. Specs that must exercise Spreadsheet, Tension,
 * Relationships, or Subway launch `revealedTimelineMainJs()`; product-chrome
 * specs keep launching `out/main/main.js`.
 */
import fs from 'fs';
import path from 'path';

const PRODUCT_OUT = path.resolve(__dirname, '../out');
// Sibling of `out/` so `out-revealed/main/main.js` still resolves
// `../../package.json` to the repo root, the same way the production build does.
const REVEALED_OUT = path.resolve(__dirname, '../out-revealed');

const MEMBERSHIP = 'HIDDEN_TIMELINE_MODES.has(';

let revealed: { dir: string; mainJs: string } | null = null;

function rendererBundle(outDir: string): string {
  const assetsDir = path.join(outDir, 'renderer', 'assets');
  const bundles = fs.readdirSync(assetsDir).filter((name) => /^index-.*\.js$/.test(name));
  if (bundles.length !== 1) {
    throw new Error(`expected one renderer bundle in ${assetsDir}, found: ${bundles.join(', ') || '(none)'}`);
  }
  return path.join(assetsDir, bundles[0]);
}

/**
 * Path to a temp copy of `out/main/main.js` whose bundled visibility check
 * treats every timeline mode as visible. Fails if the production bundle
 * still contains an unhide switch, or if the membership call this copy
 * rewrites is no longer present (a minify change must break here, not
 * silently leave the views hidden).
 */
export function revealedTimelineMainJs(): string {
  if (revealed) return revealed.mainJs;

  const productBundle = rendererBundle(PRODUCT_OUT);
  const productSource = fs.readFileSync(productBundle, 'utf8');
  if (productSource.includes('timeline:hiddenModesOverride') || productSource.includes('hiddenModesInEffect')) {
    throw new Error(`product bundle ${productBundle} still contains a timeline unhide switch`);
  }
  const memberships = productSource.split(MEMBERSHIP).length - 1;
  if (memberships < 1) {
    throw new Error(`product bundle ${productBundle} has no ${MEMBERSHIP} call to rewrite`);
  }

  fs.rmSync(REVEALED_OUT, { recursive: true, force: true });
  fs.cpSync(PRODUCT_OUT, REVEALED_OUT, { recursive: true });
  const bundlePath = rendererBundle(REVEALED_OUT);
  const source = fs.readFileSync(bundlePath, 'utf8');
  const patched = source.split(MEMBERSHIP).join('new Set().has(');
  if (patched === source || patched.includes(MEMBERSHIP)) {
    throw new Error(`failed to rewrite ${MEMBERSHIP} in ${bundlePath}`);
  }
  fs.writeFileSync(bundlePath, patched);
  revealed = { dir: REVEALED_OUT, mainJs: path.join(REVEALED_OUT, 'main', 'main.js') };
  return revealed.mainJs;
}
