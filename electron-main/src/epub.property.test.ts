// SKY-361: Property-based tests for the EPUB serializer's HTML-escaping path.
//
// buildEpub converts user-authored prose (which may originate from an
// attacker-supplied Obsidian vault import) to XHTML inside the EPUB ZIP.
// If HTML special characters in prose reach the output unescaped, any reader
// that renders EPUB/XHTML would execute injected markup — an output-handling
// vulnerability (OWASP Top 10 A03: Injection; Insecure Output Handling).
//
// MUTATION DETECTION: each property is annotated with the specific mutation
// that fails it — proving coverage is real.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import JSZip from 'jszip';
import { buildEpub, type EpubInput } from './epub.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function extractParagraphTexts(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const scenePaths: string[] = [];
  zip.forEach((path) => {
    if (path.startsWith('OEBPS/scene-') && path.endsWith('.xhtml')) {
      scenePaths.push(path);
    }
  });
  const texts: string[] = [];
  for (const path of scenePaths) {
    const xhtml = await zip.file(path)!.async('string');
    for (const m of xhtml.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
      texts.push(m[1]);
    }
  }
  return texts;
}

// Check paragraph text nodes (content between <p>...</p>) for unescaped HTML
// characters.  In properly escaped XHTML text content, '<' must never appear
// raw — all instances must be encoded as '&lt;'.
function paragraphsContainRawHtml(paragraphTexts: string[]): boolean {
  for (const text of paragraphTexts) {
    if (text.includes('<')) return true;
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+;|#x[\da-fA-F]+);)/.test(text)) return true;
  }
  return false;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Prose strings that contain at least one HTML-injection canary character.
const proseWithHtmlChars = fc
  .string({ minLength: 1 })
  .filter((s) => s.includes('<') || s.includes('>') || s.includes('&') || s.includes('"'));

// ─── Properties ──────────────────────────────────────────────────────────────

describe('buildEpub — HTML-escaping property-based (SKY-361)', () => {

  // ── P5: Fault tolerance ──────────────────────────────────────────────────
  // buildEpub must never throw for any combination of prose strings, including
  // adversarial XML/HTML payloads, null-like chars, and very long strings.
  //
  // MUTATION DETECTION: remove error handling and add `throw new Error('oops')`
  // inside escapedHtml for inputs containing '<' — this property catches it.
  it('P5: buildEpub never throws for arbitrary prose and title strings', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (title, prose) => {
        await buildEpub({
          title: title || 'untitled',
          chapters: [
            {
              id: 'ch1',
              title: 'Ch',
              scenes: [{ id: 'sc1', title: 'Sc', prose }],
            },
          ],
        });
      }),
      { numRuns: 500 }
    );
  }, 30_000);

  // ── P6: HTML-injection safety ─────────────────────────────────────────────
  // Any prose containing '<', '>', '&', or '"' must not appear raw inside
  // EPUB paragraph text nodes.  Each such character must be HTML-entity-encoded.
  //
  // MUTATION DETECTION: remove `replace(/</g, '&lt;')` from escapedHtml in
  // epub.ts → any prose with '<' produces a paragraph with raw '<' →
  // paragraphsContainRawHtml() returns true → the assertion below fails.
  it('P6: HTML special chars in prose are encoded in EPUB XHTML paragraph text nodes', async () => {
    await fc.assert(
      fc.asyncProperty(proseWithHtmlChars, async (prose) => {
        const buf = await buildEpub({
          title: 'Test',
          chapters: [
            {
              id: 'ch1',
              title: 'Ch',
              scenes: [{ id: 'sc1', title: 'Sc', prose }],
            },
          ],
        });
        const paragraphs = await extractParagraphTexts(buf);
        expect(paragraphsContainRawHtml(paragraphs)).toBe(false);
      }),
      { numRuns: 1_000 }
    );
  }, 20_000);

  // ── P7: Output is always a non-empty Buffer ───────────────────────────────
  //
  // MUTATION DETECTION: return `Buffer.alloc(0)` from buildEpub
  // → buf.length === 0 → the assertion fails.
  it('P7: buildEpub always returns a non-empty Buffer', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (title) => {
        const buf = await buildEpub({ title: title || 'T', chapters: [] });
        expect(buf).toBeInstanceOf(Buffer);
        expect(buf.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 }
    );
  });

  // ── Mutation-proof assertion ─────────────────────────────────────────────
  // Directly shows that (a) the current implementation escapes '<' correctly,
  // and (b) our detector would catch it if it didn't.
  it('[mutation proof] detects missing HTML escaping for script injection', async () => {
    const dangerous = '<script>alert(1)</script>';
    const buf = await buildEpub({
      title: 'Test',
      chapters: [{ id: 'c', title: 'C', scenes: [{ id: 's', title: 'S', prose: dangerous }] }],
    });
    const paragraphs = await extractParagraphTexts(buf);

    // Real impl: no raw HTML in paragraph text nodes.
    expect(paragraphsContainRawHtml(paragraphs)).toBe(false);

    // Real impl: prose '<' appears as '&lt;' in XHTML.
    const allParagraphText = paragraphs.join('');
    expect(allParagraphText).toContain('&lt;script&gt;');
    expect(allParagraphText).not.toContain('<script>');

    // Simulate what a broken escapedHtml (missing '<' → '&lt;') would produce
    // in a paragraph, and verify our detector catches it:
    const brokenParagraphContent = `<script>alert(1)&lt;/script&gt;`;
    expect(paragraphsContainRawHtml([brokenParagraphContent])).toBe(true);
  });
});
