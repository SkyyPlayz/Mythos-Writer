/** Owns the one panel scope model: every panel is `global` or `page:<view>`. Pure data and helpers; imports nothing. */

/** Every page window the widget shell knows about, in nav order. */
export const PAGE_VIEWS = [
  'editor',
  'book',
  'structure',
  'notes',
  'boards',
  'crafter',
  'brainstorm',
  'beta',
  'timeline',
  'graph',
  'artifacts',
  'settings',
] as const;

export type PageView = (typeof PAGE_VIEWS)[number];

export const GLOBAL_SCOPE = 'global' as const;

/** `global` panels live in the global sidebars; `page:<view>` panels live inside that page's window. */
export type PanelScope = typeof GLOBAL_SCOPE | `page:${PageView}`;

const PAGE_PREFIX = 'page:';

export function isPageView(value: unknown): value is PageView {
  return typeof value === 'string' && (PAGE_VIEWS as readonly string[]).includes(value);
}

export function pageScope(view: PageView): PanelScope {
  return `${PAGE_PREFIX}${view}` as PanelScope;
}

export function isGlobalScope(scope: PanelScope): scope is typeof GLOBAL_SCOPE {
  return scope === GLOBAL_SCOPE;
}

/** The page a page-scoped panel belongs to, or null for a global panel. */
export function scopePage(scope: PanelScope): PageView | null {
  if (isGlobalScope(scope)) return null;
  const view = scope.slice(PAGE_PREFIX.length);
  return isPageView(view) ? view : null;
}

/** Parses an untrusted value (e.g. a future saved layout row) into a scope; anything else is null. */
export function parseScope(raw: unknown): PanelScope | null {
  if (raw === GLOBAL_SCOPE) return GLOBAL_SCOPE;
  if (typeof raw !== 'string' || !raw.startsWith(PAGE_PREFIX)) return null;
  const view = raw.slice(PAGE_PREFIX.length);
  return isPageView(view) ? pageScope(view) : null;
}
