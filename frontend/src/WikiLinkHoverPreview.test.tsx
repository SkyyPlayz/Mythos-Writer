// M16: wiki-link hover preview — excerpt extraction + card behavior.
import { useRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import WikiLinkHoverPreview, {
  extractPreviewExcerpt,
  type WikiLinkPreviewResolver,
} from './WikiLinkHoverPreview';

describe('extractPreviewExcerpt (M16)', () => {
  it('strips frontmatter and heading markers', () => {
    const md = '---\ntype: location\n---\n\n# The Sunken Gate\n\nAn ancient floodgate.';
    const out = extractPreviewExcerpt(md);
    expect(out).not.toContain('type: location');
    expect(out).not.toContain('#');
    expect(out).toContain('The Sunken Gate');
    expect(out).toContain('An ancient floodgate.');
  });

  it('flattens bold/italic/code and blockquotes', () => {
    expect(extractPreviewExcerpt('**bold** *em* `code`\n> quoted')).toBe('bold em code\nquoted');
  });

  it('truncates long bodies on a word boundary with an ellipsis', () => {
    const long = Array(200).fill('word').join(' ');
    const out = extractPreviewExcerpt(long, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns short bodies unchanged', () => {
    expect(extractPreviewExcerpt('Short note.')).toBe('Short note.');
  });

  // W0.2: hover previews route through the shared frontmatter engine.
  it('strips kanban frontmatter and the %% kanban:settings %% trailer', () => {
    const md = [
      '---',
      'kanban-plugin: board',
      'story-id: abc-123',
      '---',
      '',
      '## To Do',
      '',
      '- [ ] Draft the flood scene',
      '',
      '%% kanban:settings',
      '```json',
      '{"kanban-plugin":"board"}',
      '```',
      '%%',
    ].join('\n');
    const out = extractPreviewExcerpt(md);
    expect(out).not.toContain('kanban-plugin');
    expect(out).not.toContain('story-id');
    expect(out).not.toContain('kanban:settings');
    expect(out).toContain('Draft the flood scene');
  });

  it('keeps an unterminated frontmatter fence visible as body', () => {
    const md = '---\ntitle: broken fence\n\nStill visible prose.';
    const out = extractPreviewExcerpt(md);
    expect(out).toContain('Still visible prose.');
    expect(out).toContain('title: broken fence');
  });
});

function Harness({ resolve }: { resolve: WikiLinkPreviewResolver }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="hover-container">
      <span data-wiki-link="The Sunken Gate">[[The Sunken Gate]]</span>
      <button type="button" data-wiki-target="Ghost Note" data-testid="preview-btn">[[Ghost Note]]</button>
      <WikiLinkHoverPreview containerRef={ref} resolvePreview={resolve} hoverDelayMs={0} />
    </div>
  );
}

describe('WikiLinkHoverPreview card (M16)', () => {
  it('shows a note preview card with title, kind, and excerpt on hover', async () => {
    const resolve = vi.fn(async () => ({
      kind: 'note' as const,
      title: 'The Sunken Gate',
      subtitle: 'Locations/The Sunken Gate.md',
      markdown: '---\ntype: location\n---\nAn ancient floodgate built by a lost civilization.',
    }));
    render(<Harness resolve={resolve} />);
    fireEvent.mouseOver(screen.getByText('[[The Sunken Gate]]'));
    await waitFor(() => expect(screen.getByTestId('wiki-link-hover-preview')).toBeInTheDocument());
    expect(resolve).toHaveBeenCalledWith('The Sunken Gate');
    expect(screen.getByTestId('wiki-link-hover-kind')).toHaveTextContent('NOTE');
    expect(screen.getByTestId('wiki-link-hover-body')).toHaveTextContent('An ancient floodgate');
    expect(screen.getByTestId('wiki-link-hover-body')).not.toHaveTextContent('type: location');
  });

  it('shows the STORY badge for scene previews', async () => {
    const resolve = vi.fn(async () => ({
      kind: 'scene' as const,
      title: 'Opening Scene',
      subtitle: 'Test Story › Chapter One',
      markdown: 'She reached the gate at dawn.',
    }));
    render(<Harness resolve={resolve} />);
    fireEvent.mouseOver(screen.getByText('[[The Sunken Gate]]'));
    await waitFor(() => expect(screen.getByTestId('wiki-link-hover-kind')).toHaveTextContent('STORY'));
  });

  it('shows the click-would-create hint for unresolved targets (data-wiki-target hook)', async () => {
    const resolve = vi.fn(async () => null);
    render(<Harness resolve={resolve} />);
    fireEvent.mouseOver(screen.getByTestId('preview-btn'));
    await waitFor(() => expect(screen.getByTestId('wiki-link-hover-unresolved')).toBeInTheDocument());
    expect(resolve).toHaveBeenCalledWith('Ghost Note');
    expect(screen.getByTestId('wiki-link-hover-unresolved')).toHaveTextContent('click to create');
  });

  it('hides the card when the pointer leaves the link', async () => {
    const resolve = vi.fn(async () => ({
      kind: 'note' as const,
      title: 'The Sunken Gate',
      markdown: 'Body.',
    }));
    render(<Harness resolve={resolve} />);
    const link = screen.getByText('[[The Sunken Gate]]');
    fireEvent.mouseOver(link);
    await waitFor(() => expect(screen.getByTestId('wiki-link-hover-preview')).toBeInTheDocument());
    fireEvent.mouseOut(link, { relatedTarget: document.body });
    await waitFor(() => expect(screen.queryByTestId('wiki-link-hover-preview')).not.toBeInTheDocument());
  });

  it('does not show a card for non-link hovers', async () => {
    const resolve = vi.fn(async () => null);
    render(<Harness resolve={resolve} />);
    fireEvent.mouseOver(screen.getByTestId('hover-container'));
    await new Promise((r) => setTimeout(r, 20));
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.queryByTestId('wiki-link-hover-preview')).not.toBeInTheDocument();
  });
});
