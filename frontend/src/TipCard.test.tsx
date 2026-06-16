import { render, screen, fireEvent } from '@testing-library/react';
import { TipCard } from './TipCard';
import type { WritingAssistantTip, WritingTipCategory } from './hooks/useWritingScheduler';

const categoryCases: Array<[WritingTipCategory, RegExp]> = [
  ['grammar', /grammar tip/i],
  ['pacing', /pacing tip/i],
  ['clarity', /clarity tip/i],
  ['style', /style tip/i],
  ['tone', /tone tip/i],
];

function makeTip(category: WritingTipCategory, text = 'This sentence could be tighter.'): WritingAssistantTip {
  return {
    id: `tip-${category}`,
    category,
    text,
    sceneAnchor: 'Scene 1 · Opening',
    sceneId: 'scene-1',
    scenePath: '/Story/Scene 1.md',
    sceneUpdatedAt: '2026-06-15T12:00:00.000Z',
  };
}

describe('TipCard', () => {
  it.each(categoryCases)('renders %s category badge with accessible label', (category, label) => {
    render(
      <TipCard
        tip={makeTip(category)}
        onNote={() => {}}
        onIgnore={() => {}}
        onReport={() => {}}
      />,
    );

    const badge = screen.getByRole('img', { name: label });
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass(`tc-category-badge--${category}`);
  });

  it('expands and collapses long tip text inline', () => {
    render(
      <TipCard
        tip={makeTip('clarity', 'A long clarity tip that should start clamped and expand when the author asks to see the rest.')}
        onNote={() => {}}
        onIgnore={() => {}}
        onReport={() => {}}
      />,
    );

    const toggle = screen.getByRole('button', { name: /show more/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /show less/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('emits note, ignore, and report actions', () => {
    const onNote = vi.fn();
    const onIgnore = vi.fn();
    const onReport = vi.fn();

    render(
      <TipCard
        tip={makeTip('tone')}
        onNote={onNote}
        onIgnore={onIgnore}
        onReport={onReport}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /note it/i }));
    fireEvent.click(screen.getByRole('button', { name: /ignore tip/i }));
    fireEvent.click(screen.getByRole('button', { name: /report tip/i }));

    expect(onNote).toHaveBeenCalledWith('tip-tone');
    expect(onIgnore).toHaveBeenCalledWith('tip-tone');
    expect(onReport).toHaveBeenCalledWith('tip-tone');
  });
});
