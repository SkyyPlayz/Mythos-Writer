import { describe, expect, it } from 'vitest';
import { GLOBAL_SCOPE, PAGE_VIEWS, isGlobalScope, isPageView, pageScope, parseScope, scopePage } from './scopeModel';

describe('scopeModel', () => {
  it('builds one page scope per page view and maps it back to its page', () => {
    for (const view of PAGE_VIEWS) {
      const scope = pageScope(view);
      expect(scope).toBe(`page:${view}`);
      expect(isGlobalScope(scope)).toBe(false);
      expect(scopePage(scope)).toBe(view);
    }
  });

  it('treats global as having no page', () => {
    expect(isGlobalScope(GLOBAL_SCOPE)).toBe(true);
    expect(scopePage(GLOBAL_SCOPE)).toBeNull();
  });

  it('parses only well-formed scopes from untrusted input', () => {
    expect(parseScope('global')).toBe('global');
    expect(parseScope('page:beta')).toBe('page:beta');
    expect(parseScope('page:')).toBeNull();
    expect(parseScope('page:nope')).toBeNull();
    expect(parseScope('Global')).toBeNull();
    expect(parseScope('beta')).toBeNull();
    expect(parseScope(undefined)).toBeNull();
    expect(parseScope(42)).toBeNull();
    expect(parseScope({ scope: 'global' })).toBeNull();
  });

  it('recognises page views exactly', () => {
    expect(isPageView('editor')).toBe(true);
    expect(isPageView('settings')).toBe(true);
    expect(isPageView('coach')).toBe(false);
    expect(isPageView('')).toBe(false);
    expect(isPageView(null)).toBe(false);
  });
});
