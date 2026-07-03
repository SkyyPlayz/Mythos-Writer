/**
 * Shared prefers-reduced-motion helpers (Liquid Neon MYT-520 §5.3).
 *
 * CSS-driven motion is neutralised globally (index.css reset + tokens.css
 * duration collapse), but JS-driven motion — programmatic smooth scrolling,
 * imperative animations — must check the media query itself. This mirrors the
 * guard pattern already used inside VaultGraphView so call sites share one
 * implementation instead of re-deriving it.
 */

/** True when the user's OS/browser asks for reduced motion. Safe in non-DOM
 *  environments (jsdom without matchMedia, SSR): defaults to false. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** ScrollBehavior for programmatic scrolls (scrollIntoView / scrollTo):
 *  'auto' (instant) under reduced motion, 'smooth' otherwise. */
export function scrollBehavior(): 'smooth' | 'auto' {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
