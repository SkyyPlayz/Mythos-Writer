import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

function readButtonCss() {
  return readFileSync(
    resolve(process.cwd(), 'src/components/ui/Button.css'),
    'utf-8',
  );
}

function cssRule(css: string, selector: string) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${esc}\\s*\\{(?<body>[^}]*)\\}`, 'm'));
  return m?.groups?.body ?? '';
}

// ─── Render / Props ────────────────────────────────────────────────────────────

describe('Button — render and props', () => {
  it('renders children', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('defaults to type="button" to prevent accidental form submit', () => {
    render(<Button>X</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('accepts type="submit"', () => {
    render(<Button type="submit">Go</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('forwards extra HTML attributes', () => {
    render(<Button data-testid="my-btn">OK</Button>);
    expect(screen.getByTestId('my-btn')).toBeInTheDocument();
  });

  it('calls onClick handler', () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const handler = vi.fn();
    render(<Button disabled onClick={handler}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('merges extra className with btn classes', () => {
    render(<Button className="my-extra">X</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('btn');
    expect(btn).toHaveClass('my-extra');
  });
});

// ─── Variants ─────────────────────────────────────────────────────────────────

describe('Button — variants', () => {
  it('defaults to primary variant', () => {
    render(<Button>X</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--primary');
  });

  it('applies secondary variant class', () => {
    render(<Button variant="secondary">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--secondary');
    expect(screen.getByRole('button')).not.toHaveClass('btn--primary');
  });

  it('applies tertiary variant class', () => {
    render(<Button variant="tertiary">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--tertiary');
  });

  it('applies destructive variant class', () => {
    render(<Button variant="destructive">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--destructive');
  });
});

// ─── Sizes ────────────────────────────────────────────────────────────────────

describe('Button — sizes', () => {
  it('defaults to md size', () => {
    render(<Button>X</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--md');
  });

  it('applies sm size class', () => {
    render(<Button size="sm">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--sm');
  });

  it('applies lg size class', () => {
    render(<Button size="lg">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--lg');
  });

  it('applies xl size class', () => {
    render(<Button size="xl">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--xl');
  });
});

// ─── Disabled state ───────────────────────────────────────────────────────────

describe('Button — disabled state', () => {
  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>X</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('sets aria-disabled when disabled', () => {
    render(<Button disabled>X</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not set aria-disabled when not disabled', () => {
    render(<Button>X</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-disabled');
  });
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe('Button — loading state', () => {
  it('renders spinner when loading', () => {
    render(<Button loading>Saving</Button>);
    expect(document.querySelector('.btn__spinner')).toBeInTheDocument();
  });

  it('adds btn--loading class when loading', () => {
    render(<Button loading>X</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn--loading');
  });

  it('is disabled when loading', () => {
    render(<Button loading>X</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('sets aria-busy="true" when loading', () => {
    render(<Button loading>X</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('does not call onClick when loading', () => {
    const handler = vi.fn();
    render(<Button loading onClick={handler}>X</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('spinner has aria-hidden to avoid screen-reader noise', () => {
    render(<Button loading>X</Button>);
    const spinner = document.querySelector('.btn__spinner');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });
});

// ─── CSS token compliance ─────────────────────────────────────────────────────

describe('Button — Liquid Neon token compliance', () => {
  it('has no literal hex colors in primary rule', () => {
    const css = readButtonCss();
    const primary = cssRule(css, '.btn--primary');
    expect(primary).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(primary).not.toMatch(/rgba?\(/i);
    expect(primary).not.toMatch(/hsla?\(/i);
  });

  it('primary hover uses accent token for border', () => {
    const css = readButtonCss();
    // Extract all .btn--primary hover rule bodies by scanning for the selector substring
    const m = css.match(/\.btn--primary:hover[^{]*\{([^}]*)\}/);
    expect(m?.[1] ?? '').toContain('var(--accent)');
  });

  it('destructive hover uses neon-magenta token', () => {
    const css = readButtonCss();
    const m = css.match(/\.btn--destructive:hover[^{]*\{([^}]*)\}/);
    expect(m?.[1] ?? '').toContain('var(--neon-magenta)');
  });

  it('focus ring uses focus-ring token', () => {
    const css = readButtonCss();
    const focusRule = cssRule(css, '.btn:focus-visible');
    expect(focusRule).toContain('var(--focus-ring)');
  });

  it('hover transition is within 180ms', () => {
    const css = readButtonCss();
    const base = cssRule(css, '.btn');
    expect(base).toContain('var(--dur-hover-in)');
  });

  it('reduced-motion block zeroes all transitions', () => {
    const css = readButtonCss();
    const m = css.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\{([\s\S]*?)\}\s*\}/,
    );
    expect(m).not.toBeNull();
    expect(m?.[1]).toContain('transition: none');
  });

  it('high-contrast block removes box-shadow from primary hover', () => {
    const css = readButtonCss();
    const m = css.match(/\[data-contrast="high"\]\s*\.btn--primary:hover[^{]*\{([^}]*)\}/);
    expect(m?.[1] ?? '').toContain('box-shadow: none');
  });

  it('high-contrast block uses 2px solid border on primary', () => {
    const css = readButtonCss();
    const m = css.match(/\[data-contrast="high"\]\s*\.btn--primary\s*\{([^}]*)\}/);
    expect(m?.[1] ?? '').toContain('2px');
  });

  it('base .btn class uses border-radius token', () => {
    const css = readButtonCss();
    const base = cssRule(css, '.btn');
    expect(base).toContain('var(--radius-md)');
  });
});
