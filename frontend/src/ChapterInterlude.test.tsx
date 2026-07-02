import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import ChapterInterlude, { splitChapterMeta, buildChapterFrontmatter } from './ChapterInterlude';
import type { Chapter } from './types';

// Stub the shared editor: capture props so tests can drive onChangeMarkdown
// without mounting Tiptap in jsdom.
const editorProps: { content?: string; onChangeMarkdown?: (md: string) => void } = {};
vi.mock('./RichTextEditor', () => ({
  default: (props: { content: string; onChangeMarkdown?: (md: string) => void }) => {
    editorProps.content = props.content;
    editorProps.onChangeMarkdown = props.onChangeMarkdown;
    return <div data-testid="rte-stub">{props.content}</div>;
  },
}));

const chapter: Chapter = {
  id: 'ch-1',
  title: 'Opening',
  path: '01 - Opening',
  order: 0,
  scenes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const FM = '---\nid: ch-1\ntitle: Opening\norder: 0\nschemaVersion: 1\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n';

function stubApi(overrides: Partial<Window['api']> = {}) {
  (window as unknown as { api: Partial<Window['api']> }).api = {
    readVault: vi.fn().mockResolvedValue({ content: `${FM}The interlude.`, path: '01 - Opening/chapter.md' }),
    writeVault: vi.fn().mockResolvedValue({ path: '01 - Opening/chapter.md', bytes: 1 }),
    ...overrides,
  };
}

beforeEach(() => {
  editorProps.content = undefined;
  editorProps.onChangeMarkdown = undefined;
  stubApi();
});

describe('splitChapterMeta', () => {
  it('separates the frontmatter block verbatim from the prose', () => {
    const { fmRaw, prose } = splitChapterMeta(`${FM}Hello`);
    expect(fmRaw).toBe(FM);
    expect(prose).toBe('Hello');
  });

  it('returns null frontmatter when none exists', () => {
    const { fmRaw, prose } = splitChapterMeta('Just prose');
    expect(fmRaw).toBeNull();
    expect(prose).toBe('Just prose');
  });
});

describe('buildChapterFrontmatter', () => {
  it('mirrors the vault serializer shape', () => {
    const fm = buildChapterFrontmatter(chapter, 'story-1');
    expect(fm.startsWith('---\nid: ch-1\ntitle: Opening\nstoryId: story-1\norder: 0\nschemaVersion: 1\nupdatedAt: ')).toBe(true);
    expect(fm.endsWith('---\n')).toBe(true);
  });
});

describe('ChapterInterlude (GH #631)', () => {
  it('loads chapter.md and shows the prose without frontmatter', async () => {
    render(<ChapterInterlude chapter={chapter} />);
    await waitFor(() => expect(screen.getByTestId('chapter-interlude')).toBeInTheDocument());
    expect(window.api.readVault).toHaveBeenCalledWith('01 - Opening/chapter.md');
    expect(editorProps.content).toBe('The interlude.');
  });

  it('starts empty when chapter.md does not exist', async () => {
    stubApi({ readVault: vi.fn().mockRejectedValue(new Error('not found')) });
    render(<ChapterInterlude chapter={chapter} />);
    await waitFor(() => expect(screen.getByTestId('chapter-interlude')).toBeInTheDocument());
    expect(editorProps.content).toBe('');
  });

  it('saves edits with the original frontmatter preserved byte-for-byte', async () => {
    render(<ChapterInterlude chapter={chapter} />);
    await waitFor(() => expect(screen.getByTestId('chapter-interlude')).toBeInTheDocument());
    await act(async () => { editorProps.onChangeMarkdown?.('New interlude text.\n'); });
    await waitFor(() =>
      expect(window.api.writeVault).toHaveBeenCalledWith('01 - Opening/chapter.md', `${FM}New interlude text.\n`),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('creates default frontmatter on first save when chapter.md was missing', async () => {
    stubApi({ readVault: vi.fn().mockRejectedValue(new Error('not found')) });
    render(<ChapterInterlude chapter={chapter} storyId="story-1" />);
    await waitFor(() => expect(screen.getByTestId('chapter-interlude')).toBeInTheDocument());
    await act(async () => { editorProps.onChangeMarkdown?.('First words.\n'); });
    await waitFor(() => expect(window.api.writeVault).toHaveBeenCalled());
    const written = (window.api.writeVault as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(written).toMatch(/^---\nid: ch-1\ntitle: Opening\nstoryId: story-1\norder: 0\nschemaVersion: 1\n/);
    expect(written.endsWith('---\nFirst words.\n')).toBe(true);
  });

  it('surfaces a save failure in the status region', async () => {
    stubApi({ writeVault: vi.fn().mockRejectedValue(new Error('disk full')) });
    render(<ChapterInterlude chapter={chapter} />);
    await waitFor(() => expect(screen.getByTestId('chapter-interlude')).toBeInTheDocument());
    await act(async () => { editorProps.onChangeMarkdown?.('x'); });
    expect(await screen.findByText(/save failed/i)).toBeInTheDocument();
  });

  it('normalizes Windows-style chapter paths to vault-relative posix', async () => {
    render(<ChapterInterlude chapter={{ ...chapter, path: '01 - Opening\\Sub' }} />);
    await waitFor(() => expect(window.api.readVault).toHaveBeenCalledWith('01 - Opening/Sub/chapter.md'));
  });
});
