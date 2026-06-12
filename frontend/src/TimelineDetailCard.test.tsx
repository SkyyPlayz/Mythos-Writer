// SKY-793 — Detail card + context menu smoke tests.

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TimelineDetailCard, {
  TimelineSceneContextMenu,
} from './TimelineDetailCard';
import type { SpreadsheetScene } from './TimelineSpreadsheet';

const ARCS = [
  { id: 'arc-alpha', title: 'Alpha Arc', color: '#7c6af7' },
  { id: 'arc-beta', title: 'Beta Arc', color: '#00f0ff' },
];
const CHARS = [
  { id: 'char-1', name: 'Alice' },
  { id: 'char-2', name: 'Bob' },
];
const LOCATIONS = [{ id: 'loc-1', name: 'Castle Library' }];

function makeScene(overrides: Partial<SpreadsheetScene> = {}): SpreadsheetScene {
  return {
    id: 'scene-1',
    title: 'The Reveal',
    chapterId: 'chap-1',
    date: '2025-04-12',
    pov: 'char-1',
    arcIds: ['arc-alpha', 'arc-beta'],
    characterIds: ['char-1'],
    wordCount: 1234,
    mood: 'tense, hopeful',
    locationId: 'loc-1',
    ...overrides,
  };
}

describe('TimelineDetailCard', () => {
  it('renders the full scene metadata block', () => {
    render(
      <TimelineDetailCard
        scene={makeScene()}
        state="hover"
        arcs={ARCS}
        characters={CHARS}
        locations={LOCATIONS}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText('The Reveal')).toBeInTheDocument();
    expect(screen.getByTestId('tdc-pov')).toHaveTextContent('Alice');
    expect(screen.getByTestId('tdc-words')).toHaveTextContent('1,234');
    expect(screen.getByTestId('tdc-location')).toHaveTextContent('Castle Library');
    expect(screen.getByText('Alpha Arc')).toBeInTheDocument();
    expect(screen.getByText('Beta Arc')).toBeInTheDocument();
    expect(screen.getByText('tense')).toBeInTheDocument();
    expect(screen.getByText('hopeful')).toBeInTheDocument();
  });

  it('fires onEdit with the scene id when the Edit button is clicked', () => {
    const onEdit = vi.fn();
    render(
      <TimelineDetailCard
        scene={makeScene()}
        state="selected"
        arcs={ARCS}
        characters={CHARS}
        locations={LOCATIONS}
        onEdit={onEdit}
      />,
    );
    fireEvent.click(screen.getByTestId('timeline-detail-card-edit'));
    expect(onEdit).toHaveBeenCalledWith('scene-1');
  });

  it('renders nothing when scene is null', () => {
    const { container } = render(
      <TimelineDetailCard
        scene={null}
        state="hover"
        arcs={ARCS}
        characters={CHARS}
        locations={LOCATIONS}
        onEdit={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('annotates the data-state attribute so CSS state styling activates', () => {
    const { rerender } = render(
      <TimelineDetailCard
        scene={makeScene()}
        state="hover"
        arcs={ARCS}
        characters={CHARS}
        locations={LOCATIONS}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByTestId('timeline-detail-card')).toHaveAttribute(
      'data-state',
      'hover',
    );

    rerender(
      <TimelineDetailCard
        scene={makeScene()}
        state="selected"
        arcs={ARCS}
        characters={CHARS}
        locations={LOCATIONS}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByTestId('timeline-detail-card')).toHaveAttribute(
      'data-state',
      'selected',
    );
  });

  it('uses an em-dash for missing metadata fields', () => {
    render(
      <TimelineDetailCard
        scene={makeScene({
          pov: '',
          wordCount: null,
          locationId: '',
          arcIds: [],
          mood: '',
        })}
        state="hover"
        arcs={ARCS}
        characters={CHARS}
        locations={LOCATIONS}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tdc-pov')).toHaveTextContent('—');
    expect(screen.getByTestId('tdc-words')).toHaveTextContent('—');
    expect(screen.getByTestId('tdc-location')).toHaveTextContent('—');
    expect(screen.getByText('No arcs')).toBeInTheDocument();
    expect(screen.getByText('No mood')).toBeInTheDocument();
  });

  it('routes its own right-click to onRequestContextMenu and suppresses the native menu', () => {
    const onRequestContextMenu = vi.fn();
    render(
      <TimelineDetailCard
        scene={makeScene()}
        state="hover"
        arcs={ARCS}
        characters={CHARS}
        locations={LOCATIONS}
        onEdit={vi.fn()}
        onRequestContextMenu={onRequestContextMenu}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('timeline-detail-card'), {
      clientX: 120,
      clientY: 240,
    });
    expect(onRequestContextMenu).toHaveBeenCalledWith('scene-1', 120, 240);
  });
});

describe('TimelineSceneContextMenu', () => {
  it('renders all five spec actions in order', () => {
    render(
      <TimelineSceneContextMenu
        sceneId="scene-1"
        x={10}
        y={20}
        onAction={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('timeline-scene-context-edit')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-scene-context-change-pov')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-scene-context-change-arc')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-scene-context-duplicate')).toBeInTheDocument();
    expect(
      screen.getByTestId('timeline-scene-context-delete-from-timeline'),
    ).toBeInTheDocument();
  });

  it('calls onAction with the chosen action then dismisses', () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <TimelineSceneContextMenu
        sceneId="scene-1"
        x={10}
        y={20}
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId('timeline-scene-context-duplicate'));
    expect(onAction).toHaveBeenCalledWith('duplicate');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape', () => {
    const onDismiss = vi.fn();
    render(
      <TimelineSceneContextMenu
        sceneId="scene-1"
        x={10}
        y={20}
        onAction={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('dismisses on an outside mousedown', () => {
    const onDismiss = vi.fn();
    render(
      <div>
        <TimelineSceneContextMenu
          sceneId="scene-1"
          x={10}
          y={20}
          onAction={vi.fn()}
          onDismiss={onDismiss}
        />
        <div data-testid="outside">outside</div>
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
