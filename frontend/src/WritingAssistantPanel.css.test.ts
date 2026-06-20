import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const srcDir = __dirname;

function readSrcCss(filename: string): string {
  return readFileSync(resolve(srcDir, filename), 'utf8');
}

describe('WritingAssistantPanel Liquid Neon CSS', () => {
  it('uses Liquid Neon tokens for voice-adjacent status and warning surfaces', () => {
    const css = readSrcCss('WritingAssistantPanel.css');
    const tokens = readSrcCss('tokens.css');

    expect(tokens).toContain('--success: var(--state-success);');
    expect(tokens).toContain('--text-muted:');
    expect(tokens).toContain('--bg-muted:');

    expect(css).toContain('color: var(--text, #ede9fe);');
    expect(css).toContain('background: color-mix(in srgb, var(--success, #4ade80) 12%, transparent);');
    expect(css).toContain('color: var(--success, #4ade80);');
    expect(css).toContain('border: 1px solid color-mix(in srgb, var(--success, #4ade80) 30%, transparent);');
    expect(css).toContain('background: var(--bg-muted, #1c1917);');
    expect(css).toContain('color: var(--text-muted, #a8a29e);');
    expect(css).toContain('border: 1px solid var(--border, #44403c);');
    expect(css).toContain('background: color-mix(in srgb, var(--danger, #f87171) 12%, transparent);');
    expect(css).toContain('border: 1px solid color-mix(in srgb, var(--danger, #f87171) 30%, transparent);');
    expect(css).toContain('background: color-mix(in srgb, var(--warning, #fbbf24) 12%, transparent);');
    expect(css).toContain('border: 1px solid color-mix(in srgb, var(--warning, #fbbf24) 30%, transparent);');
    expect(css).toContain('color: var(--warning, #fbbf24);');
  });

  it('provides keyboard-visible focus rings for voice controls', () => {
    const css = readSrcCss('WritingAssistantPanel.css');

    expect(css).toContain('.wa-mic-btn:focus-visible,\n.wa-hear-btn:focus-visible,\n.wa-mute-btn:focus-visible');
    expect(css).toContain('outline: 2px solid var(--accent, #00f0ff);');
    expect(css).toContain('outline-offset: 2px;');
  });
});
