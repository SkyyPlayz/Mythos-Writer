// SKY-2461 — TimelineBlock unit tests (vitest + @testing-library/react).

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TimelineBlock from './TimelineBlock';
import type { TimelineBlockProps } from './TimelineBlock';

function makeProps(overrides: Partial<TimelineBlockProps> = {}): TimelineBlockProps {
  return {
    sceneId: 'scene-uuid-1',
    sceneName: 'Scene 1: Arrival',
    chapterNumber: 1,
    timestamp: 'Day 2, dawn',
    confidence: 0.92,
    isWritten: true,
    ...overrides,
  };
}

describe('TimelineBlock', () => {
  it('renders all required text content', () => {
    render(<TimelineBlock {...makeProps()} />);
    expect(screen.getByText('Scene 1: Arrival')).toBeInTheDocument();
    expect(screen.getByText('Day 2, dawn')).toBeInTheDocument();
    expect(screen.getByText('Ch. 1')).toBeInTheDocument();
  });

  it('written block has the written modifier class', () => {
    render(<TimelineBlock {...makeProps({ isWritten: true })} />);
    expect(screen.getByTestId('timeline-block')).toHaveClass('tb-root--written');
    expect(screen.getByTestId('timeline-block')).not.toHaveClass('tb-root--planned');
  });

  it('planned block has the planned modifier class', () => {
    render(<TimelineBlock {...makeProps({ isWritten: false })} />);
    expect(screen.getByTestId('timeline-block')).toHaveClass('tb-root--planned');
    expect(screen.getByTestId('timeline-block')).not.toHaveClass('tb-root--written');
  });

  it('confidence ✓ appears at ≥80% (high: 0.92)', () => {
    render(<TimelineBlock {...makeProps({ confidence: 0.92 })} />);
    expect(screen.getByTestId('confidence-badge')).toHaveTextContent('✓');
    expect(screen.getByTestId('confidence-badge')).toHaveClass('tb-confidence-badge--high');
  });

  it('confidence ✓ appears exactly at the 0.80 threshold', () => {
    render(<TimelineBlock {...makeProps({ confidence: 0.8 })} />);
    expect(screen.getByTestId('confidence-badge')).toHaveTextContent('✓');
    expect(screen.getByTestId('confidence-badge')).toHaveClass('tb-confidence-badge--high');
  });

  it('confidence ? appears at <80% (low: 0.65)', () => {
    render(<TimelineBlock {...makeProps({ confidence: 0.65 })} />);
    expect(screen.getByTestId('confidence-badge')).toHaveTextContent('?');
    expect(screen.getByTestId('confidence-badge')).toHaveClass('tb-confidence-badge--low');
  });

  it('onClick fires with the correct sceneId on click', () => {
    const onClick = vi.fn();
    render(<TimelineBlock {...makeProps({ onClick })} />);
    fireEvent.click(screen.getByTestId('timeline-block'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith('scene-uuid-1');
  });

  it('onHover fires with (sceneId, true) on mouseenter', () => {
    const onHover = vi.fn();
    render(<TimelineBlock {...makeProps({ onHover })} />);
    fireEvent.mouseEnter(screen.getByTestId('timeline-block'));
    expect(onHover).toHaveBeenCalledWith('scene-uuid-1', true);
  });

  it('onHover fires with (sceneId, false) on mouseleave', () => {
    const onHover = vi.fn();
    render(<TimelineBlock {...makeProps({ onHover })} />);
    fireEvent.mouseLeave(screen.getByTestId('timeline-block'));
    expect(onHover).toHaveBeenCalledWith('scene-uuid-1', false);
  });

  it('isSelected=true adds the selected class and aria-pressed=true', () => {
    render(<TimelineBlock {...makeProps({ isSelected: true })} />);
    const el = screen.getByTestId('timeline-block');
    expect(el).toHaveClass('tb-root--selected');
    expect(el).toHaveAttribute('aria-pressed', 'true');
  });

  it('isSelected=false (default) does not add selected class and aria-pressed=false', () => {
    render(<TimelineBlock {...makeProps({ isSelected: false })} />);
    const el = screen.getByTestId('timeline-block');
    expect(el).not.toHaveClass('tb-root--selected');
    expect(el).toHaveAttribute('aria-pressed', 'false');
  });

  it('generates the correct ARIA label', () => {
    render(
      <TimelineBlock
        {...makeProps({ sceneName: 'Arrival', chapterNumber: 1, timestamp: 'Day 2 dawn', confidence: 0.92 })}
      />,
    );
    expect(screen.getByTestId('timeline-block')).toHaveAttribute(
      'aria-label',
      'Scene: Arrival, Chapter 1, Day 2 dawn, 92% confidence',
    );
  });

  it('has role="button" for clickable interactivity', () => {
    render(<TimelineBlock {...makeProps()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('has tabIndex=0 for keyboard navigation', () => {
    render(<TimelineBlock {...makeProps()} />);
    expect(screen.getByTestId('timeline-block')).toHaveAttribute('tabindex', '0');
  });

  it('fires onClick on Enter key', () => {
    const onClick = vi.fn();
    render(<TimelineBlock {...makeProps({ onClick })} />);
    fireEvent.keyDown(screen.getByTestId('timeline-block'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith('scene-uuid-1');
  });

  it('fires onClick on Space key', () => {
    const onClick = vi.fn();
    render(<TimelineBlock {...makeProps({ onClick })} />);
    fireEvent.keyDown(screen.getByTestId('timeline-block'), { key: ' ' });
    expect(onClick).toHaveBeenCalledWith('scene-uuid-1');
  });

  it('does not crash when onClick and onHover are omitted', () => {
    render(<TimelineBlock {...makeProps({ onClick: undefined, onHover: undefined })} />);
    expect(() => {
      fireEvent.click(screen.getByTestId('timeline-block'));
      fireEvent.mouseEnter(screen.getByTestId('timeline-block'));
      fireEvent.mouseLeave(screen.getByTestId('timeline-block'));
    }).not.toThrow();
  });

  it('compact size applies the compact modifier class', () => {
    render(<TimelineBlock {...makeProps({ size: 'compact' })} />);
    expect(screen.getByTestId('timeline-block')).toHaveClass('tb-root--compact');
  });

  it('default size applies the default modifier class', () => {
    render(<TimelineBlock {...makeProps({ size: 'default' })} />);
    expect(screen.getByTestId('timeline-block')).toHaveClass('tb-root--default');
  });

  it('storyAccentColor sets the --tb-accent CSS custom property', () => {
    render(<TimelineBlock {...makeProps({ storyAccentColor: '#ec4899' })} />);
    const el = screen.getByTestId('timeline-block') as HTMLElement;
    expect(el.style.getPropertyValue('--tb-accent')).toBe('#ec4899');
  });

  it('confidence badge is aria-hidden so screen readers use the aria-label instead', () => {
    render(<TimelineBlock {...makeProps()} />);
    expect(screen.getByTestId('confidence-badge')).toHaveAttribute('aria-hidden', 'true');
  });
});
