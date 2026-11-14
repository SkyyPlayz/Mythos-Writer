import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TagPane from './index';

function tag(name: string, count: number): NotesTagEntry {
  return { name, fullName: name, count, paths: [], children: [] };
}

const mockTagList = vi.fn();
const mockTagRename = vi.fn();
const mockTagMerge = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as { api: unknown }).api = {
    notesTagList: mockTagList,
    notesTagRename: mockTagRename,
    notesTagMerge: mockTagMerge,
  };
});

describe('TagPane rename', () => {
  it('reloads the tag list after a partial rename and keeps the skipped notice visible', async () => {
    mockTagList
      .mockResolvedValueOnce({ tags: [tag('draft', 3)] })
      .mockResolvedValueOnce({ tags: [tag('draft', 1), tag('wip', 2)] });
    mockTagRename.mockResolvedValue({ affectedFiles: 2, skipped: ['a.md: reason'] });

    render(<TagPane onTagFilter={vi.fn()} activeTag={null} />);

    await screen.findByTestId('tp-tag-draft');
    fireEvent.click(screen.getByTitle('Rename tag'));
    const input = screen.getByRole('textbox', { name: 'Rename tag' });
    fireEvent.change(input, { target: { value: 'wip' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByTestId('tp-tag-wip')).toBeInTheDocument();
    expect(mockTagRename).toHaveBeenCalledWith('draft', 'wip');
    expect(mockTagList).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tag-skip-notice')).toHaveTextContent('a.md: reason');
    expect(screen.queryByRole('textbox', { name: 'Rename tag' })).not.toBeInTheDocument();
  });
});
