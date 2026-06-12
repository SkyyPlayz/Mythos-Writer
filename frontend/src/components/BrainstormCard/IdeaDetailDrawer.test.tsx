import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { IdeaDetailDrawer } from './IdeaDetailDrawer';
import type { IdeaCardIdea } from './IdeaCard';

const baseIdea: IdeaCardIdea = {
  id: 'idea-1',
  title: 'The Crystal Spire',
  type: 'location',
  linkedEntities: [{ id: 'e1', name: 'Aria Voss', type: 'character' }],
  savedPath: 'Universes/First/Locations/The Crystal Spire.md',
  updatedAt: '2026-06-10T12:00:00.000Z',
};

function buildApi(overrides: Record<string, unknown> = {}) {
  return {
    entityList: vi.fn().mockResolvedValue({ entities: [] }),
    ...overrides,
  };
}

beforeEach(() => {
  (window as unknown as { api: ReturnType<typeof buildApi> }).api = buildApi();
});

describe('IdeaDetailDrawer', () => {
  it('renders drawer with correct aria-label and close button', () => {
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId('idea-detail-drawer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close idea detail' })).toBeInTheDocument();
  });

  it('shows title input pre-filled with idea title', () => {
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText('Idea title')).toHaveValue('The Crystal Spire');
  });

  it('clean close (no edits) calls onClose without showing discard dialog', () => {
    const onClose = vi.fn();
    render(<IdeaDetailDrawer idea={baseIdea} onClose={onClose} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close idea detail' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument();
  });

  it('dirty close shows discard dialog', () => {
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Idea title'), { target: { value: 'Edited Title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close idea detail' }));
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument();
  });

  it('dirty Escape shows discard dialog', () => {
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Idea title'), { target: { value: 'Edited' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument();
  });

  it('discard dialog Discard button calls onClose', () => {
    const onClose = vi.fn();
    render(<IdeaDetailDrawer idea={baseIdea} onClose={onClose} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Idea title'), { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close idea detail' }));
    const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('discard dialog Save button calls onSave with updated title', () => {
    const onSave = vi.fn();
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Idea title'), { target: { value: 'New Title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close idea detail' }));
    const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Title' }));
  });

  it('footer is hidden when clean, visible when dirty', () => {
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Idea title'), { target: { value: 'X' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('footer Discard resets fields', () => {
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Idea title'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('Idea title')).toHaveValue('The Crystal Spire');
  });

  it('renders overlay scrim', () => {
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);
    const scrim = document.querySelector('.idd-scrim');
    expect(scrim).toBeInTheDocument();
  });

  it('entity picker opens and closes with Escape', async () => {
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add entity' }));
    await waitFor(() => expect(screen.getByLabelText('Search entities')).toBeInTheDocument());
    fireEvent.keyDown(screen.getByLabelText('Search entities'), { key: 'Escape' });
    expect(screen.queryByLabelText('Search entities')).not.toBeInTheDocument();
  });

  describe('drawer chip-click navigation (SKY-1264)', () => {
    it('renders entity name as button and calls onChipClick when clicked', () => {
      const onChipClick = vi.fn();
      render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} onChipClick={onChipClick} />);

      fireEvent.click(screen.getByRole('button', { name: 'Navigate to Aria Voss' }));

      expect(onChipClick).toHaveBeenCalledWith({ id: 'e1', name: 'Aria Voss', type: 'character' });
    });

    it('renders entity name as plain span when onChipClick is not provided', () => {
      render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);

      expect(screen.queryByRole('button', { name: 'Navigate to Aria Voss' })).not.toBeInTheDocument();
      expect(screen.getByText('Aria Voss')).toBeInTheDocument();
    });

    it('remove button still works independently of onChipClick', () => {
      const onSave = vi.fn();
      render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={onSave} onChipClick={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Remove Aria Voss' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ linkedEntities: [] }));
    });
  });

  it('body textarea enforces 8000 char max', () => {
    render(<IdeaDetailDrawer idea={baseIdea} onClose={vi.fn()} onSave={vi.fn()} />);
    const textarea = screen.getByLabelText('Idea notes');
    const long = 'x'.repeat(8500);
    fireEvent.change(textarea, { target: { value: long } });
    expect((textarea as HTMLTextAreaElement).value.length).toBe(8000);
  });
});
