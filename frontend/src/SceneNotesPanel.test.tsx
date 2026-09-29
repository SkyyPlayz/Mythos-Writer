import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SceneNotesPanel from './SceneNotesPanel';
import { SCENE_NOTE_DRAG_MIME, SCENE_NOTE_SEPARATOR } from './sceneNotes';
import type { Scene } from './types';

const scene: Scene = {
  id: 'sc1', title: 'Into the Undercity', path: 's/ch1/sc1', order: 0,
  chapterId: 'ch1', storyId: 's1', blocks: [], createdAt: '', updatedAt: '',
} as Scene;

let notesGet: ReturnType<typeof vi.fn>;
let notesSet: ReturnType<typeof vi.fn>;
let notesTierContext: ReturnType<typeof vi.fn>;

beforeEach(() => {
  notesGet = vi.fn().mockResolvedValue({ content: `First note${SCENE_NOTE_SEPARATOR}Second note` });
  notesSet = vi.fn().mockResolvedValue({ saved: true });
  notesTierContext = vi.fn().mockResolvedValue({
    ok: true, bookId: 's1', partId: 'p1', chapterId: 'ch1', sceneId: 'sc1',
  });
  (window as unknown as { api: unknown }).api = { notesGet, notesSet, notesTierContext };
});

describe('SceneNotesPanel (M9b, SKY-9823)', () => {
  it('renders the stored notes as pinned cards with the prototype copy', async () => {
    render(<SceneNotesPanel scene={scene} />);
    expect(await screen.findByText('First note')).toBeInTheDocument();
    expect(screen.getByText('Second note')).toBeInTheDocument();
    expect(screen.getByText('SCENE NOTES')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Pinned to this scene — promote a note to the vault by dragging it onto the navigator.',
      ),
    ).toBeInTheDocument();
    expect(notesGet).toHaveBeenCalledWith('sc1');
  });

  it('Add appends the trimmed draft and persists the serialized list', async () => {
    render(<SceneNotesPanel scene={scene} />);
    await screen.findByText('First note');
    fireEvent.change(screen.getByLabelText('New scene note'), { target: { value: '  Third note  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Third note')).toBeInTheDocument();
    expect(notesSet).toHaveBeenCalledWith(
      'sc1',
      ['First note', 'Second note', 'Third note'].join(SCENE_NOTE_SEPARATOR),
    );
    expect((screen.getByLabelText('New scene note') as HTMLInputElement).value).toBe('');
  });

  it('Add is disabled for an empty draft', async () => {
    render(<SceneNotesPanel scene={scene} />);
    await screen.findByText('First note');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('Enter in the input adds the note', async () => {
    render(<SceneNotesPanel scene={scene} />);
    await screen.findByText('First note');
    fireEvent.change(screen.getByLabelText('New scene note'), { target: { value: 'Via enter' } });
    fireEvent.keyDown(screen.getByLabelText('New scene note'), { key: 'Enter' });
    expect(screen.getByText('Via enter')).toBeInTheDocument();
  });

  it('remove button unpins a note and persists the remainder', async () => {
    render(<SceneNotesPanel scene={scene} />);
    await screen.findByText('First note');
    fireEvent.click(screen.getByRole('button', { name: 'Remove note: First note' }));
    expect(screen.queryByText('First note')).not.toBeInTheDocument();
    expect(notesSet).toHaveBeenCalledWith('sc1', 'Second note');
  });

  it('dragging a card sets the scene-note MIME payload', async () => {
    render(<SceneNotesPanel scene={scene} />);
    await screen.findByText('First note');
    const setData = vi.fn();
    fireEvent.dragStart(screen.getAllByTestId('snp-note')[0], {
      dataTransfer: { setData, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith(
      SCENE_NOTE_DRAG_MIME,
      JSON.stringify({ sceneId: 'sc1', index: 0, text: 'First note' }),
    );
    expect(setData).toHaveBeenCalledWith('text/plain', 'First note');
  });

  it('Enter on a focused card invokes the keyboard promote path', async () => {
    const onPromoteNote = vi.fn();
    render(<SceneNotesPanel scene={scene} onPromoteNote={onPromoteNote} />);
    await screen.findByText('First note');
    fireEvent.keyDown(screen.getAllByTestId('snp-note')[1], { key: 'Enter' });
    expect(onPromoteNote).toHaveBeenCalledWith({ sceneId: 'sc1', index: 1, text: 'Second note' });
  });

  it('Delete on a focused card removes it', async () => {
    render(<SceneNotesPanel scene={scene} />);
    await screen.findByText('First note');
    fireEvent.keyDown(screen.getAllByTestId('snp-note')[0], { key: 'Delete' });
    expect(screen.queryByText('First note')).not.toBeInTheDocument();
  });

  it('a refreshToken bump re-fetches from the store (post-promote)', async () => {
    const { rerender } = render(<SceneNotesPanel scene={scene} refreshToken={0} />);
    await screen.findByText('First note');
    notesGet.mockResolvedValue({ content: 'Second note' });
    rerender(<SceneNotesPanel scene={scene} refreshToken={1} />);
    await waitFor(() => expect(screen.queryByText('First note')).not.toBeInTheDocument());
    expect(screen.getByText('Second note')).toBeInTheDocument();
  });

  it('shows the empty state when no scene is selected', () => {
    render(<SceneNotesPanel scene={null} />);
    expect(screen.getByText('Select a scene to add notes.')).toBeInTheDocument();
  });
});

describe('SceneNotesPanel F5 notes per tier', () => {
  it('renders Book/Part/Chapter/Scene tier tabs', async () => {
    render(<SceneNotesPanel scene={scene} />);
    await screen.findByTestId('snp-tiers');
    expect(screen.getByTestId('snp-tier-book')).toBeInTheDocument();
    expect(screen.getByTestId('snp-tier-part')).toBeInTheDocument();
    expect(screen.getByTestId('snp-tier-chapter')).toBeInTheDocument();
    expect(screen.getByTestId('snp-tier-scene')).toBeInTheDocument();
  });

  it('switching to Book loads and persists under book:<storyId>', async () => {
    notesGet.mockImplementation(async (key: string) => {
      if (key === 'book:s1') return { content: 'Book-level note' };
      return { content: `First note${SCENE_NOTE_SEPARATOR}Second note` };
    });
    render(<SceneNotesPanel scene={scene} />);
    await screen.findByText('First note');
    fireEvent.click(screen.getByTestId('snp-tier-book'));
    expect(await screen.findByText('Book-level note')).toBeInTheDocument();
    expect(screen.getByText('BOOK NOTES')).toBeInTheDocument();
    expect(notesGet).toHaveBeenCalledWith('book:s1');

    fireEvent.change(screen.getByLabelText('New book note'), { target: { value: 'Outline beat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(notesSet).toHaveBeenCalledWith(
      'book:s1',
      ['Book-level note', 'Outline beat'].join(SCENE_NOTE_SEPARATOR),
    );
  });

  it('Part tier uses resolved partId from notesTierContext', async () => {
    notesGet.mockImplementation(async (key: string) => {
      if (key === 'part:p1') return { content: 'Part note' };
      return { content: '' };
    });
    render(<SceneNotesPanel scene={scene} />);
    await waitFor(() => expect(notesTierContext).toHaveBeenCalledWith('sc1'));
    await waitFor(() => expect(screen.getByTestId('snp-tier-part')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('snp-tier-part'));
    expect(await screen.findByText('Part note')).toBeInTheDocument();
    expect(notesGet).toHaveBeenCalledWith('part:p1');
  });

  it('resets resolvedPartId to null on scene switch until tierContext returns', async () => {
    let resolveCtx!: (v: unknown) => void;
    notesTierContext.mockImplementation(
      () => new Promise((resolve) => { resolveCtx = resolve; }),
    );
    const { rerender } = render(<SceneNotesPanel scene={scene} />);
    // First scene's context still pending — Part must stay disabled (null part).
    expect(screen.getByTestId('snp-tier-part')).toBeDisabled();
    resolveCtx({ ok: true, bookId: 's1', partId: 'p1', chapterId: 'ch1', sceneId: 'sc1' });
    await waitFor(() => expect(screen.getByTestId('snp-tier-part')).not.toBeDisabled());

    const scene2 = { ...scene, id: 'sc2', chapterId: 'ch2' } as Scene;
    let resolveCtx2!: (v: unknown) => void;
    notesTierContext.mockImplementation(
      () => new Promise((resolve) => { resolveCtx2 = resolve; }),
    );
    rerender(<SceneNotesPanel scene={scene2} />);
    // Critic soft: must not keep p1 while sc2 context is in flight.
    expect(screen.getByTestId('snp-tier-part')).toBeDisabled();
    resolveCtx2({ ok: true, bookId: 's1', partId: 'p2', chapterId: 'ch2', sceneId: 'sc2' });
    await waitFor(() => expect(screen.getByTestId('snp-tier-part')).not.toBeDisabled());
  });

  it('Chapter tier persists under chapter:<chapterId>', async () => {
    notesGet.mockResolvedValue({ content: '' });
    render(<SceneNotesPanel scene={scene} />);
    fireEvent.click(screen.getByTestId('snp-tier-chapter'));
    await waitFor(() => expect(notesGet).toHaveBeenCalledWith('chapter:ch1'));
    fireEvent.change(screen.getByLabelText('New chapter note'), { target: { value: 'Ch note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(notesSet).toHaveBeenCalledWith('chapter:ch1', 'Ch note');
  });
});
