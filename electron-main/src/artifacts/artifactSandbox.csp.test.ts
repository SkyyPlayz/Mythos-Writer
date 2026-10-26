// S3.3 — the artifact frame is an opaque srcdoc with no connect-src and no same-origin.
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CSP,
  ARTIFACT_SANDBOX,
  buildArtifactSrcdoc,
  denyArtifactNavigation,
  unsafeInlineAllowed,
} from './artifactSandbox.js';

describe('artifact sandbox CSP (S3.3)', () => {
  it('allows scripts only, and unsafe-inline only while the origin is opaque and there is no connect-src', () => {
    expect(ARTIFACT_SANDBOX).toBe('allow-scripts');
    expect(ARTIFACT_SANDBOX.split(/\s+/)).not.toContain('allow-same-origin');
    expect(ARTIFACT_SANDBOX.split(/\s+/)).not.toContain('allow-top-navigation');
    expect(ARTIFACT_SANDBOX.split(/\s+/)).not.toContain('allow-popups');
    expect(ARTIFACT_SANDBOX.split(/\s+/)).not.toContain('allow-forms');
    expect(ARTIFACT_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'",
    );
    expect(ARTIFACT_CSP).not.toContain('connect-src');
    expect(ARTIFACT_CSP).not.toContain('frame-src');
    expect(unsafeInlineAllowed(ARTIFACT_SANDBOX, ARTIFACT_CSP)).toBe(true);
    expect(unsafeInlineAllowed('allow-scripts allow-same-origin', ARTIFACT_CSP)).toBe(false);
    expect(unsafeInlineAllowed(ARTIFACT_SANDBOX, `${ARTIFACT_CSP}; connect-src https://evil.test`)).toBe(false);
    expect(unsafeInlineAllowed(ARTIFACT_SANDBOX, ARTIFACT_CSP.replace("default-src 'none'", "default-src 'self'"))).toBe(false);
  });

  it('builds a srcdoc that carries that CSP and denies artifact navigations', () => {
    const doc = buildArtifactSrcdoc('<script>alert(1)</script>', { '--ink': '#111111' });
    expect(doc).toContain(`content="${ARTIFACT_CSP}"`);
    expect(doc).toContain('&lt;script&gt;');
    expect(doc).not.toContain('<script>alert');
    expect(denyArtifactNavigation('https://evil.test', true)).toEqual({ action: 'deny' });
    expect(denyArtifactNavigation('file:///etc/passwd', true)).toEqual({ action: 'deny' });
  });
});
