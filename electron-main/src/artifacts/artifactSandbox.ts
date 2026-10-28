// Sandboxed artifact frame: opaque srcdoc, CSP with no connect-src, no same-origin.

export const ARTIFACT_SANDBOX = 'allow-scripts';

export const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

const FORBIDDEN_SANDBOX = ['allow-same-origin', 'allow-top-navigation', 'allow-popups', 'allow-forms'] as const;

export function unsafeInlineAllowed(sandbox: string, csp: string): boolean {
  const tokens = sandbox.split(/\s+/).filter((part) => part.length > 0);
  if (tokens.some((token) => (FORBIDDEN_SANDBOX as readonly string[]).includes(token))) return false;
  if (/\bconnect-src\b/.test(csp)) return false;
  if (!/default-src\s+'none'/.test(csp)) return false;
  if (/\bframe-src\b/.test(csp)) return false;
  return /script-src\s+'unsafe-inline'/.test(csp) && /style-src\s+'unsafe-inline'/.test(csp);
}

export function sandboxAllowsSameOrigin(sandbox: string): boolean {
  return sandbox.split(/\s+/).includes('allow-same-origin');
}

export function buildArtifactSrcdoc(body: string, vars: Record<string, string>): string {
  if (!unsafeInlineAllowed(ARTIFACT_SANDBOX, ARTIFACT_CSP)) {
    throw new Error('artifact sandbox refused: unsafe-inline requires an opaque origin and no connect-src');
  }
  const style = Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
  const safeBody = body.replace(/[<>&]/g, (ch) => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&amp;'));
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}"></head><body style="${style}">${safeBody}</body></html>`;
}

/** Artifact-frame navigations and popups are denied. http(s) still goes to the system browser. */
export function denyArtifactNavigation(url: string, fromArtifactFrame: boolean): { action: 'deny' } {
  if (fromArtifactFrame) return { action: 'deny' };
  if (/^https?:\/\//i.test(url)) return { action: 'deny' };
  return { action: 'deny' };
}
