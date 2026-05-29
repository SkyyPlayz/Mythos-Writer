import { render } from '@testing-library/react';
import { renderSnippet } from './SearchBar';

// Unit tests for the FTS5 snippet renderer — verifies XSS safety and highlight rendering.

describe('renderSnippet', () => {
  it('renders plain text without marks', () => {
    const { container } = render(<>{renderSnippet('hello world')}</>);
    expect(container.textContent).toBe('hello world');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('wraps [[…]] markers in <mark> elements', () => {
    const { container } = render(<>{renderSnippet('see [[highlighted]] term')}</>);
    const mark = container.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('highlighted');
    expect(container.textContent).toBe('see highlighted term');
  });

  it('handles multiple highlight markers', () => {
    const { container } = render(<>{renderSnippet('[[foo]] and [[bar]]')}</>);
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('foo');
    expect(marks[1].textContent).toBe('bar');
  });

  it('does NOT inject raw HTML from snippet content (XSS guard)', () => {
    // A crafted vault note containing an XSS payload that SQLite FTS5 would return verbatim
    const xssSnippet = '<script>alert(1)</script> [[match]]';
    const { container } = render(<>{renderSnippet(xssSnippet)}</>);
    // The script tag must appear as escaped text, not as a live DOM element
    expect(container.querySelector('script')).toBeNull();
    // The text content still contains the literal angle-bracket characters as text
    expect(container.textContent).toContain('<script>alert(1)</script>');
    // The legitimate match is still highlighted
    expect(container.querySelector('mark')?.textContent).toBe('match');
  });

  it('does NOT inject HTML attributes through snippet content', () => {
    const payload = '<img src=x onerror=alert(1)> [[term]]';
    const { container } = render(<>{renderSnippet(payload)}</>);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('mark')?.textContent).toBe('term');
  });

  it('handles ellipsis snippets with no highlight markers', () => {
    const { container } = render(<>{renderSnippet('…some context text…')}</>);
    expect(container.textContent).toBe('…some context text…');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('handles unclosed [[ marker gracefully without throwing', () => {
    const { container } = render(<>{renderSnippet('text [[unclosed')}</>);
    expect(container.textContent).toContain('[[unclosed');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('handles empty string', () => {
    const { container } = render(<>{renderSnippet('')}</>);
    expect(container.textContent).toBe('');
  });
});
