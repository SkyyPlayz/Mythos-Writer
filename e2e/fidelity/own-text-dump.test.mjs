// SKY-10591 regression fixture.
//
// rightpanel.mjs and sky10508-m9-repass.mjs both build their text dumps with
// an in-browser `page.evaluate()` closure that can't import a shared helper
// (Playwright serializes the function source into the page — it can't reach
// back into this module). So this test keeps its own copy of the extraction
// algorithm and asserts it against the exact ScenesPanel-shaped fixture from
// the bug report: any change to that inlined algorithm in either harness
// should be mirrored here, and this fixture re-run to confirm mixed-content
// text still survives the dump.
//
// Run: node --test e2e/fidelity/own-text-dump.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

// Old (broken) algorithm: skip any element with element children.
function leafOnlyDump(doc) {
  const out = [];
  doc.querySelectorAll('body *').forEach((el) => {
    if (el.children.length) return;
    const t = (el.textContent || '').trim();
    if (t) out.push(t);
  });
  return [...new Set(out)].join('\n');
}

// Fixed algorithm, mirrored from rightpanel.mjs / sky10508-m9-repass.mjs:
// emit each element's OWN text nodes, regardless of whether it also has
// element children.
function ownTextDump(doc) {
  const out = [];
  doc.querySelectorAll('body *').forEach((el) => {
    const t = [...el.childNodes].filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).filter(Boolean).join(' ');
    if (t) out.push(t);
  });
  return [...new Set(out)].join('\n');
}

const FIXTURE_HTML = `<p>Draft one in the <button>Scene Crafter</button> and it appears here.</p>`;

test('leaf-only dump drops mixed-content text (proves the bug)', () => {
  const { window } = new JSDOM(`<body>${FIXTURE_HTML}</body>`);
  const dump = leafOnlyDump(window.document);
  assert.equal(dump, 'Scene Crafter');
  assert.ok(!dump.includes('Draft one in the'));
  assert.ok(!dump.includes('and it appears here.'));
});

test('own-text-node dump preserves every fragment of a mixed-content paragraph', () => {
  const { window } = new JSDOM(`<body>${FIXTURE_HTML}</body>`);
  const dump = ownTextDump(window.document);
  assert.ok(dump.includes('Draft one in the'), `expected leading text in dump, got: ${dump}`);
  assert.ok(dump.includes('and it appears here.'), `expected trailing text in dump, got: ${dump}`);
  assert.ok(dump.includes('Scene Crafter'), `expected inline child text in dump, got: ${dump}`);
});
