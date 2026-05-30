// SKY-211: Regression tests for XSS in the WikiLink markdown-it renderer rule.
//
// The vulnerable path: when tiptap-markdown converts markdown to HTML it calls
// md.renderer.rules['wiki_link'], whose output is later set as innerHTML of a
// temp DOM element.  In Chromium (Electron), any live element in that HTML
// (e.g. <img onerror=…>) fires its event handler even in a detached tree.
//
// Fix: HTML-escape <, >, &, and " in both the attribute value and text content.
//
// These tests extract the renderer function directly from the extension storage
// so they exercise the exact bytes that reach innerHTML, without needing a
// full markdown-it instance or a running Tiptap editor.
import { describe, it, expect } from 'vitest';
import { WikiLink } from './WikiLinkExtension';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RendererRule = (tokens: unknown[], idx: number) => string;

/**
 * Extract the wiki_link renderer rule registered by the WikiLink extension
 * without spinning up a full Tiptap editor.  Returns null if the extension's
 * internal storage shape has changed (test will hard-fail in that case).
 */
function captureWikiLinkRendererRule(): RendererRule | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storageFactory = (WikiLink as any).config?.addStorage;
  if (typeof storageFactory !== 'function') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = storageFactory.call({}) as any;
  const setup = storage?.markdown?.parse?.setup;
  if (typeof setup !== 'function') return null;

  let capturedRule: RendererRule | null = null;

  // Minimal markdown-it mock: only intercepts renderer.rules assignment.
  const mockMd = {
    inline: { ruler: { before: () => {} } },
    renderer: {
      rules: new Proxy({} as Record<string, unknown>, {
        set(obj: Record<string, unknown>, prop: string, value: unknown): boolean {
          if (prop === 'wiki_link') capturedRule = value as RendererRule;
          obj[prop] = value;
          return true;
        },
      }),
    },
  };

  setup(mockMd);
  return capturedRule;
}

function makeToken(target: string): unknown {
  return { attrGet: (name: string) => (name === 'data-wiki-link' ? target : null) };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('WikiLinkExtension — markdown renderer HTML escaping (SKY-211)', () => {
  const rule = captureWikiLinkRendererRule();

  // If extraction failed the API has changed; hard-fail so the gap is visible.
  it('can extract the wiki_link renderer rule from extension storage', () => {
    expect(rule).not.toBeNull();
  });

  const XSS_PAYLOADS: Array<[string, string]> = [
    ['img onerror',    '<img src=x onerror=alert(1)>'],
    ['script tag',     '</span><script>alert(1)</script>'],
    ['iframe JS',      '<iframe src="javascript:alert(1)">'],
    ['attr breakout',  '"><img onerror=alert(1) src=x '],
    ['angle brackets', '<evil>'],
  ];

  for (const [label, payload] of XSS_PAYLOADS) {
    it(`escapes HTML in renderer text content: ${label}`, () => {
      if (!rule) throw new Error('renderer rule not extracted — see above failure');
      const output = rule([makeToken(payload)], 0);

      // No raw HTML element start-tags should appear in the output.
      // "onerror=" can legitimately appear inside &lt;…&gt; escaped text, so we
      // only check that the angle bracket is escaped, not the attribute name.
      expect(output).not.toMatch(/<img\b/i);
      expect(output).not.toMatch(/<script\b/i);
      expect(output).not.toMatch(/<iframe\b/i);
      // Angle brackets must be escaped in both attribute and text content.
      expect(output).not.toContain('<' + 'img');   // literal <img (unescaped)
      expect(output).not.toContain('<' + 'script'); // literal <script (unescaped)

      // The payload must still appear — but escaped.
      expect(output).toContain('&lt;');
    });
  }

  it('preserves benign wiki-link content without over-escaping', () => {
    if (!rule) throw new Error('renderer rule not extracted — see above failure');
    const output = rule([makeToken('Elara Voss')], 0);
    expect(output).toContain('Elara Voss');
    expect(output).toContain('data-wiki-link="Elara Voss"');
    expect(output).toContain('[[Elara Voss]]');
  });

  it('escapes ampersands in entity names', () => {
    if (!rule) throw new Error('renderer rule not extracted — see above failure');
    const output = rule([makeToken('Salt & Pepper'), 0], 0);
    // & must be escaped to &amp; — not left as a bare & which could be a
    // partial entity reference in an HTML attribute value.
    expect(output).toContain('&amp;');
    expect(output).not.toMatch(/(?<!&amp)&(?!amp;)/);
  });
});
