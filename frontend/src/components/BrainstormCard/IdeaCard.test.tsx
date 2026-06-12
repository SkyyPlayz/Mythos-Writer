import { render, screen, fireEvent } from '@testing-library/react';
import { IdeaCard } from './IdeaCard';

const longTitle = 'A'.repeat(90);

const baseIdea = {
  id: 'idea-1',
  title: longTitle,
  type: 'character' as const,
  linkedEntities: [
    { id: 'entity-1', name: 'Lyra Ashveil', type: 'character' as const },
    { id: 'scene-1', name: 'Moonlit Bridge', type: 'scene' as const },
  ],
  savedPath: 'Universes/First/Characters/Lyra Ashveil.md',
  updatedAt: '2026-06-11T00:55:00.000Z',
};

describe('IdeaCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T01:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the compact 72px layout with token padding and radius', () => {
    render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} />);

    expect(screen.getByTestId('idea-card-idea-1')).toHaveStyle({
      height: '72px',
      padding: 'var(--space-3)',
      borderRadius: 'var(--radius-md)',
    });
    expect(screen.getByRole('button', { name: /open idea detail/i })).toHaveTextContent(`${'A'.repeat(80)}…`);
    expect(screen.getByText('Character')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /idea actions/i })).toHaveStyle({ width: '28px', height: '28px' });
  });

  it('renders entity chips as overflow-hidden token pills and scene chips in inset cyan styling', () => {
    render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} />);

    expect(screen.getByTestId('idea-card-chips-idea-1')).toHaveStyle({ overflow: 'hidden' });
    expect(screen.getByText('Lyra Ashveil')).toHaveStyle({
      background: 'var(--entity-char-bg)',
      color: 'var(--entity-char-text)',
    });
    expect(screen.getByText('Moonlit Bridge')).toHaveStyle({
      background: 'var(--bg-inset)',
      color: 'var(--neon-cyan)',
    });
  });

  it('shows saved relative time and unsaved session metadata', () => {
    const { rerender } = render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} />);

    expect(screen.getByText('Last updated: 5 min ago')).toBeInTheDocument();

    rerender(<IdeaCard idea={{ ...baseIdea, savedPath: undefined }} onOpenDetail={() => {}} />);

    expect(screen.getByText('unsaved session idea')).toBeInTheDocument();
  });

  it('fires onOpenDetail with the idea id when the title is clicked', () => {
    const onOpenDetail = vi.fn();
    render(<IdeaCard idea={baseIdea} onOpenDetail={onOpenDetail} />);

    fireEvent.click(screen.getByRole('button', { name: /open idea detail/i }));

    expect(onOpenDetail).toHaveBeenCalledWith('idea-1');
  });

  describe('context menu', () => {
    it('renders all menu items when ⋮ button is clicked', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} onMenuAction={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /idea actions/i }));

      expect(screen.getByTestId('menu-item-edit')).toBeInTheDocument();
      expect(screen.getByTestId('menu-item-delete')).toBeInTheDocument();
      expect(screen.getByTestId('menu-item-link-entity')).toBeInTheDocument();
      expect(screen.getByTestId('menu-item-add-to-scene')).toBeInTheDocument();
      expect(screen.getByTestId('menu-item-copy-markdown')).toBeInTheDocument();
      expect(screen.getByTestId('menu-item-copy-vault-path')).toBeInTheDocument();
    });

    it('"Copy vault path" is disabled when idea has no savedPath', () => {
      const unsavedIdea = { ...baseIdea, savedPath: undefined };
      render(<IdeaCard idea={unsavedIdea} onOpenDetail={() => {}} onMenuAction={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /idea actions/i }));

      expect(screen.getByTestId('menu-item-copy-vault-path')).toBeDisabled();
    });

    it('"Copy vault path" is enabled when idea has a savedPath', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} onMenuAction={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /idea actions/i }));

      expect(screen.getByTestId('menu-item-copy-vault-path')).not.toBeDisabled();
    });

    it('calls onMenuAction with ideaId and actionId when a menu item is clicked', () => {
      const onMenuAction = vi.fn();
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} onMenuAction={onMenuAction} />);

      fireEvent.click(screen.getByRole('button', { name: /idea actions/i }));
      fireEvent.click(screen.getByTestId('menu-item-edit'));

      expect(onMenuAction).toHaveBeenCalledWith('idea-1', 'edit');
    });

    it('closes the menu and returns focus to ⋮ button on Escape', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} onMenuAction={() => {}} />);

      const menuBtn = screen.getByRole('button', { name: /idea actions/i });
      fireEvent.click(menuBtn);

      expect(screen.getByTestId('idea-context-menu')).toBeInTheDocument();

      fireEvent.keyDown(screen.getByTestId('idea-context-menu'), { key: 'Escape' });

      expect(screen.queryByTestId('idea-context-menu')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(menuBtn);
    });

    it('closes the menu on outside click', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} onMenuAction={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: /idea actions/i }));
      expect(screen.getByTestId('idea-context-menu')).toBeInTheDocument();

      fireEvent.mouseDown(document.body);

      expect(screen.queryByTestId('idea-context-menu')).not.toBeInTheDocument();
    });
  });

  describe('keyboard navigation (SKY-1196)', () => {
    it('renders as <li> (implicit listitem role)', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} />);
      expect(screen.getByTestId('idea-card-idea-1').tagName.toLowerCase()).toBe('li');
    });

    it('has tabIndex=0 in default (non-multi-select) mode', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} />);
      expect(screen.getByTestId('idea-card-idea-1').tabIndex).toBe(0);
    });

    it('fires onOpenDetail on Enter when the article itself is focused', () => {
      const onOpenDetail = vi.fn();
      render(<IdeaCard idea={baseIdea} onOpenDetail={onOpenDetail} />);
      const card = screen.getByTestId('idea-card-idea-1');
      // Simulate Enter key with target === currentTarget (focus on the article itself)
      fireEvent.keyDown(card, { key: 'Enter', target: card });
      expect(onOpenDetail).toHaveBeenCalledWith('idea-1');
    });

    it('does not fire onOpenDetail on Enter when focus is on an inner button', () => {
      const onOpenDetail = vi.fn();
      render(<IdeaCard idea={baseIdea} onOpenDetail={onOpenDetail} />);
      const titleBtn = screen.getByRole('button', { name: /open idea detail/i });
      // keyDown on the title button bubbles to the card but target !== card
      fireEvent.keyDown(titleBtn, { key: 'Enter' });
      // onOpenDetail fires from the button's onClick (click event), not from keyDown handler
      // The keyDown on the button should NOT double-fire via card's handler
      expect(onOpenDetail).not.toHaveBeenCalled();
    });
  });

  describe('chip-click navigation (SKY-1264)', () => {
    it('calls onChipClick with the chip when a chip button is clicked', () => {
      const onChipClick = vi.fn();
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} onChipClick={onChipClick} />);

      fireEvent.click(screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' }));

      expect(onChipClick).toHaveBeenCalledWith({ id: 'entity-1', name: 'Lyra Ashveil', type: 'character' });
    });

    it('calls onChipClick with scene chip when clicked', () => {
      const onChipClick = vi.fn();
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} onChipClick={onChipClick} />);

      fireEvent.click(screen.getByRole('button', { name: 'Navigate to Moonlit Bridge' }));

      expect(onChipClick).toHaveBeenCalledWith({ id: 'scene-1', name: 'Moonlit Bridge', type: 'scene' });
    });

    it('chips have role=button and are Tab-reachable', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} onChipClick={() => {}} />);

      const chip = screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' });
      expect(chip.tagName.toLowerCase()).toBe('button');
    });

    it('chip click does not open detail drawer in normal mode', () => {
      const onOpenDetail = vi.fn();
      render(<IdeaCard idea={baseIdea} onOpenDetail={onOpenDetail} onChipClick={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' }));

      expect(onOpenDetail).not.toHaveBeenCalled();
    });

    it('chip click does not toggle selection in multi-select mode', () => {
      const onToggleSelect = vi.fn();
      render(
        <IdeaCard
          idea={baseIdea}
          onOpenDetail={() => {}}
          onChipClick={() => {}}
          isMultiSelect
          isSelected={false}
          onToggleSelect={onToggleSelect}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' }));

      expect(onToggleSelect).not.toHaveBeenCalled();
    });

    it('chips without onChipClick still render as buttons with no clickable class', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} />);

      const chip = screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' });
      expect(chip).not.toHaveClass('idea-card-chip--clickable');
    });

    it('chips with onChipClick have the clickable modifier class', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} onChipClick={() => {}} />);

      expect(screen.getByRole('button', { name: 'Navigate to Lyra Ashveil' })).toHaveClass('idea-card-chip--clickable');
    });
  });

  describe('multi-select mode', () => {
    it('shows checkbox when isMultiSelect is true', () => {
      render(
        <IdeaCard
          idea={baseIdea}
          onOpenDetail={() => {}}
          isMultiSelect
          isSelected={false}
          onToggleSelect={() => {}}
        />,
      );

      expect(screen.getByTestId('idea-card-checkbox-idea-1')).toBeInTheDocument();
    });

    it('does not show checkbox when isMultiSelect is false', () => {
      render(<IdeaCard idea={baseIdea} onOpenDetail={() => {}} />);

      expect(screen.queryByTestId('idea-card-checkbox-idea-1')).not.toBeInTheDocument();
    });

    it('calls onToggleSelect when card is clicked in multi-select mode', () => {
      const onToggleSelect = vi.fn();
      render(
        <IdeaCard
          idea={baseIdea}
          onOpenDetail={() => {}}
          isMultiSelect
          isSelected={false}
          onToggleSelect={onToggleSelect}
        />,
      );

      fireEvent.click(screen.getByTestId('idea-card-idea-1'));

      expect(onToggleSelect).toHaveBeenCalledWith('idea-1');
    });

    it('calls onToggleSelect on Space key when focused in multi-select mode', () => {
      const onToggleSelect = vi.fn();
      render(
        <IdeaCard
          idea={baseIdea}
          onOpenDetail={() => {}}
          isMultiSelect
          isSelected={false}
          onToggleSelect={onToggleSelect}
        />,
      );

      fireEvent.keyDown(screen.getByTestId('idea-card-idea-1'), { key: ' ' });

      expect(onToggleSelect).toHaveBeenCalledWith('idea-1');
    });
  });
});
