import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DepthSlider, { type ViewDepth } from './DepthSlider';

const DEFAULT_PROPS = {
  depth: 'scene' as ViewDepth,
  onDepthChange: vi.fn(),
  canPrev: true,
  canNext: true,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  contextLabel: 'My Story › Scene 1',
};

describe('DepthSlider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all three depth buttons', () => {
    render(<DepthSlider {...DEFAULT_PROPS} />);
    expect(screen.getByRole('button', { name: /full book/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /chapter/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scene/i })).toBeInTheDocument();
  });

  it('marks the active depth button as pressed', () => {
    render(<DepthSlider {...DEFAULT_PROPS} depth="chapter" />);
    expect(screen.getByRole('button', { name: /chapter/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /full book/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /scene/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onDepthChange with correct value when depth button clicked', () => {
    const onDepthChange = vi.fn();
    render(<DepthSlider {...DEFAULT_PROPS} onDepthChange={onDepthChange} />);
    fireEvent.click(screen.getByRole('button', { name: /full book/i }));
    expect(onDepthChange).toHaveBeenCalledWith('book');
  });

  it('calls onPrev when prev button is clicked', () => {
    const onPrev = vi.fn();
    render(<DepthSlider {...DEFAULT_PROPS} onPrev={onPrev} canPrev={true} />);
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('calls onNext when next button is clicked', () => {
    const onNext = vi.fn();
    render(<DepthSlider {...DEFAULT_PROPS} onNext={onNext} canNext={true} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('disables prev button when canPrev is false', () => {
    render(<DepthSlider {...DEFAULT_PROPS} canPrev={false} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
  });

  it('disables next button when canNext is false', () => {
    render(<DepthSlider {...DEFAULT_PROPS} canNext={false} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('shows the context label', () => {
    render(<DepthSlider {...DEFAULT_PROPS} contextLabel="Act I › Chapter 3" />);
    expect(screen.getByText('Act I › Chapter 3')).toBeInTheDocument();
  });

  describe('keyboard shortcuts', () => {
    it('Ctrl+Alt+ArrowDown moves depth from book to chapter', () => {
      const onDepthChange = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} depth="book" onDepthChange={onDepthChange} />);
      fireEvent.keyDown(window, { key: 'ArrowDown', ctrlKey: true, altKey: true });
      expect(onDepthChange).toHaveBeenCalledWith('chapter');
    });

    it('Ctrl+Alt+ArrowDown moves depth from chapter to scene', () => {
      const onDepthChange = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} depth="chapter" onDepthChange={onDepthChange} />);
      fireEvent.keyDown(window, { key: 'ArrowDown', ctrlKey: true, altKey: true });
      expect(onDepthChange).toHaveBeenCalledWith('scene');
    });

    it('Ctrl+Alt+ArrowUp moves depth from scene to chapter', () => {
      const onDepthChange = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} depth="scene" onDepthChange={onDepthChange} />);
      fireEvent.keyDown(window, { key: 'ArrowUp', ctrlKey: true, altKey: true });
      expect(onDepthChange).toHaveBeenCalledWith('chapter');
    });

    it('Ctrl+Alt+ArrowUp moves depth from chapter to book', () => {
      const onDepthChange = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} depth="chapter" onDepthChange={onDepthChange} />);
      fireEvent.keyDown(window, { key: 'ArrowUp', ctrlKey: true, altKey: true });
      expect(onDepthChange).toHaveBeenCalledWith('book');
    });

    it('Ctrl+Alt+ArrowDown does not go past scene', () => {
      const onDepthChange = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} depth="scene" onDepthChange={onDepthChange} />);
      fireEvent.keyDown(window, { key: 'ArrowDown', ctrlKey: true, altKey: true });
      expect(onDepthChange).not.toHaveBeenCalled();
    });

    it('Ctrl+Alt+ArrowUp does not go past book', () => {
      const onDepthChange = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} depth="book" onDepthChange={onDepthChange} />);
      fireEvent.keyDown(window, { key: 'ArrowUp', ctrlKey: true, altKey: true });
      expect(onDepthChange).not.toHaveBeenCalled();
    });

    it('Ctrl+Alt+ArrowLeft calls onPrev when canPrev is true', () => {
      const onPrev = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} canPrev={true} onPrev={onPrev} />);
      fireEvent.keyDown(window, { key: 'ArrowLeft', ctrlKey: true, altKey: true });
      expect(onPrev).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Alt+ArrowRight calls onNext when canNext is true', () => {
      const onNext = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} canNext={true} onNext={onNext} />);
      fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true });
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Alt+ArrowLeft does not call onPrev when canPrev is false', () => {
      const onPrev = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} canPrev={false} onPrev={onPrev} />);
      fireEvent.keyDown(window, { key: 'ArrowLeft', ctrlKey: true, altKey: true });
      expect(onPrev).not.toHaveBeenCalled();
    });

    it('Ctrl+Alt+ArrowRight does not call onNext when canNext is false', () => {
      const onNext = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} canNext={false} onNext={onNext} />);
      fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true });
      expect(onNext).not.toHaveBeenCalled();
    });

    it('ignores ArrowUp without modifier keys', () => {
      const onDepthChange = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} depth="scene" onDepthChange={onDepthChange} />);
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      expect(onDepthChange).not.toHaveBeenCalled();
    });

    it('ignores ArrowDown with only Ctrl (no Alt)', () => {
      const onDepthChange = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} depth="book" onDepthChange={onDepthChange} />);
      fireEvent.keyDown(window, { key: 'ArrowDown', ctrlKey: true });
      expect(onDepthChange).not.toHaveBeenCalled();
    });

    it('Meta+Alt+ArrowDown (Cmd on macOS) also works', () => {
      const onDepthChange = vi.fn();
      render(<DepthSlider {...DEFAULT_PROPS} depth="book" onDepthChange={onDepthChange} />);
      fireEvent.keyDown(window, { key: 'ArrowDown', metaKey: true, altKey: true });
      expect(onDepthChange).toHaveBeenCalledWith('chapter');
    });

    it('removes keydown listener on unmount', () => {
      const onDepthChange = vi.fn();
      const { unmount } = render(
        <DepthSlider {...DEFAULT_PROPS} depth="book" onDepthChange={onDepthChange} />,
      );
      unmount();
      fireEvent.keyDown(window, { key: 'ArrowDown', ctrlKey: true, altKey: true });
      expect(onDepthChange).not.toHaveBeenCalled();
    });
  });

  describe('§4 writing-mode attribute', () => {
    it('sets data-writing-mode="normal" by default', () => {
      render(<DepthSlider {...DEFAULT_PROPS} />);
      expect(screen.getByTestId('depth-slider')).toHaveAttribute('data-writing-mode', 'normal');
    });

    it('sets data-writing-mode="focus" in focus mode', () => {
      render(<DepthSlider {...DEFAULT_PROPS} writingMode="focus" />);
      expect(screen.getByTestId('depth-slider')).toHaveAttribute('data-writing-mode', 'focus');
    });

    it('sets data-writing-mode="edit" in edit mode', () => {
      render(<DepthSlider {...DEFAULT_PROPS} writingMode="edit" />);
      expect(screen.getByTestId('depth-slider')).toHaveAttribute('data-writing-mode', 'edit');
    });
  });

  describe('§6 empty state', () => {
    it('shows "No scenes in this chapter" when isEmpty is true', () => {
      render(<DepthSlider {...DEFAULT_PROPS} isEmpty={true} />);
      expect(screen.getByRole('status')).toHaveTextContent('No scenes in this chapter');
    });

    it('hides context label when isEmpty is true', () => {
      render(<DepthSlider {...DEFAULT_PROPS} isEmpty={true} contextLabel="My Story › Scene 1" />);
      expect(screen.queryByText('My Story › Scene 1')).not.toBeInTheDocument();
    });

    it('shows context label when isEmpty is false', () => {
      render(<DepthSlider {...DEFAULT_PROPS} isEmpty={false} contextLabel="My Story › Scene 1" />);
      expect(screen.getByText('My Story › Scene 1')).toBeInTheDocument();
    });
  });

  describe('§6 loading state', () => {
    it('sets aria-busy when isLoading is true', () => {
      render(<DepthSlider {...DEFAULT_PROPS} isLoading={true} />);
      expect(screen.getByTestId('depth-slider')).toHaveAttribute('aria-busy', 'true');
    });

    it('hides depth buttons when isLoading is true', () => {
      render(<DepthSlider {...DEFAULT_PROPS} isLoading={true} />);
      expect(screen.queryByRole('button', { name: /full book/i })).not.toBeInTheDocument();
    });

    it('shows skeleton accessible label when isLoading is true', () => {
      render(<DepthSlider {...DEFAULT_PROPS} isLoading={true} />);
      expect(screen.getByLabelText(/loading navigation/i)).toBeInTheDocument();
    });

    it('passes writingMode to skeleton container', () => {
      render(<DepthSlider {...DEFAULT_PROPS} isLoading={true} writingMode="focus" />);
      expect(screen.getByTestId('depth-slider')).toHaveAttribute('data-writing-mode', 'focus');
    });
  });
});
