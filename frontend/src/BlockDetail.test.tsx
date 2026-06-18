// SKY-2451 — BlockDetail popover unit tests.

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BlockDetail from './BlockDetail';
import type { BlockDetailProps } from './BlockDetail';

function makeProps(overrides: Partial<BlockDetailProps> = {}): BlockDetailProps {
  return {
    sceneId: 'scene-uuid-1',
    sceneName: 'Arrival',
    chapterNumber: 1,
    timestamp: 'Day 2, dawn',
    confidence: 0.75,
    rawCue: 'At dawn, Eira stepped off the transport.',
    isWritten: true,
    onEditTimestamp: vi.fn(),
    onOpenInEditor: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('BlockDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders scene name', () => {
    render(<BlockDetail {...makeProps()} />);
    expect(screen.getByText('Arrival')).toBeInTheDocument();
  });

  it('renders chapter number', () => {
    render(<BlockDetail {...makeProps({ chapterNumber: 3 })} />);
    expect(screen.getByText('Chapter 3')).toBeInTheDocument();
  });

  it('renders timestamp', () => {
    render(<BlockDetail {...makeProps()} />);
    expect(screen.getByTestId('bd-timestamp')).toHaveTextContent('Day 2, dawn');
  });

  it('renders Written status for isWritten=true', () => {
    render(<BlockDetail {...makeProps({ isWritten: true })} />);
    expect(screen.getByTestId('bd-status')).toHaveTextContent('Written');
    expect(screen.getByTestId('bd-status')).toHaveClass('bd-status--written');
  });

  it('renders Planned status for isWritten=false', () => {
    render(<BlockDetail {...makeProps({ isWritten: false })} />);
    expect(screen.getByTestId('bd-status')).toHaveTextContent('Planned');
    expect(screen.getByTestId('bd-status')).toHaveClass('bd-status--planned');
  });

  it('renders raw cue text', () => {
    render(<BlockDetail {...makeProps()} />);
    expect(screen.getByTestId('bd-raw-cue')).toHaveTextContent(
      'At dawn, Eira stepped off the transport.',
    );
  });

  it('does not render raw cue section when rawCue is empty', () => {
    render(<BlockDetail {...makeProps({ rawCue: '' })} />);
    expect(screen.queryByTestId('bd-raw-cue')).not.toBeInTheDocument();
  });

  // ── Confidence bar ─────────────────────────────────────────────────────────

  it('confidence bar has progressbar role with correct aria values', () => {
    render(<BlockDetail {...makeProps({ confidence: 0.75 })} />);
    const bar = screen.getByTestId('bd-confidence-bar');
    expect(bar).toHaveAttribute('role', 'progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '75');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('confidence fill width matches confidence percentage', () => {
    render(<BlockDetail {...makeProps({ confidence: 0.75 })} />);
    const fill = screen.getByTestId('bd-confidence-fill');
    expect(fill).toHaveStyle({ width: '75%' });
  });

  it('confidence fill uses high (cyan) class at ≥0.6', () => {
    render(<BlockDetail {...makeProps({ confidence: 0.6 })} />);
    expect(screen.getByTestId('bd-confidence-fill')).toHaveClass('bd-confidence-fill--high');
    expect(screen.getByTestId('bd-confidence-fill')).not.toHaveClass('bd-confidence-fill--low');
  });

  it('confidence fill uses low (magenta) class below 0.6', () => {
    render(<BlockDetail {...makeProps({ confidence: 0.59 })} />);
    expect(screen.getByTestId('bd-confidence-fill')).toHaveClass('bd-confidence-fill--low');
    expect(screen.getByTestId('bd-confidence-fill')).not.toHaveClass('bd-confidence-fill--high');
  });

  it('renders confidence percentage label', () => {
    render(<BlockDetail {...makeProps({ confidence: 0.75 })} />);
    expect(screen.getByTestId('bd-confidence-label')).toHaveTextContent('75% confident');
  });

  it('rounds confidence percentage correctly at 0.999', () => {
    render(<BlockDetail {...makeProps({ confidence: 0.999 })} />);
    expect(screen.getByTestId('bd-confidence-label')).toHaveTextContent('100% confident');
  });

  // ── Raw cue truncation ─────────────────────────────────────────────────────

  it('does not truncate short cue (≤120 chars)', () => {
    const shortCue = 'A short cue.';
    render(<BlockDetail {...makeProps({ rawCue: shortCue })} />);
    expect(screen.getByTestId('bd-raw-cue')).toHaveTextContent(shortCue);
    expect(screen.getByTestId('bd-raw-cue')).not.toHaveAttribute('title');
  });

  it('truncates cue >120 chars with ellipsis and sets title to full text', () => {
    const longCue =
      'A'.repeat(50) + ' ' + 'B'.repeat(50) + ' ' + 'C'.repeat(50);
    render(<BlockDetail {...makeProps({ rawCue: longCue })} />);
    const el = screen.getByTestId('bd-raw-cue');
    const displayed = el.textContent ?? '';
    // Displayed text ends with "…"
    expect(displayed.endsWith('…')).toBe(true);
    // Displayed text is shorter than the full cue
    expect(displayed.length).toBeLessThan(longCue.length);
    // Full text is preserved in title attribute
    expect(el).toHaveAttribute('title', longCue);
  });

  it('truncates at exactly 120-char boundary', () => {
    const exactCue = 'X'.repeat(120);
    render(<BlockDetail {...makeProps({ rawCue: exactCue })} />);
    // Exactly 120 chars → no truncation
    expect(screen.getByTestId('bd-raw-cue')).toHaveTextContent(exactCue);

    const { unmount } = render(<BlockDetail {...makeProps({ rawCue: exactCue + 'Y' })} />);
    const els = screen.getAllByTestId('bd-raw-cue');
    const secondEl = els[els.length - 1];
    expect(secondEl.textContent?.endsWith('…')).toBe(true);
    unmount();
  });

  // ── Button callbacks ───────────────────────────────────────────────────────

  it('onEditTimestamp fires when Edit timestamp clicked', () => {
    const onEditTimestamp = vi.fn();
    render(<BlockDetail {...makeProps({ onEditTimestamp })} />);
    fireEvent.click(screen.getByTestId('bd-edit-timestamp'));
    expect(onEditTimestamp).toHaveBeenCalledOnce();
  });

  it('onOpenInEditor fires when Open in editor clicked', () => {
    const onOpenInEditor = vi.fn();
    render(<BlockDetail {...makeProps({ onOpenInEditor })} />);
    fireEvent.click(screen.getByTestId('bd-open-editor'));
    expect(onOpenInEditor).toHaveBeenCalledOnce();
  });

  it('onClose fires when Close button clicked', () => {
    const onClose = vi.fn();
    render(<BlockDetail {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('bd-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Dismiss: backdrop click ────────────────────────────────────────────────

  it('onClose fires when clicking the backdrop', () => {
    const onClose = vi.fn();
    render(<BlockDetail {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('block-detail-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('onClose does NOT fire when clicking inside the dialog', () => {
    const onClose = vi.fn();
    render(<BlockDetail {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('block-detail'));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Keyboard: Escape ───────────────────────────────────────────────────────

  it('Escape key fires onClose', () => {
    const onClose = vi.fn();
    render(<BlockDetail {...makeProps({ onClose })} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('non-Escape keys do not fire onClose', () => {
    const onClose = vi.fn();
    render(<BlockDetail {...makeProps({ onClose })} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Focus management ───────────────────────────────────────────────────────

  it('focuses the first button (Edit timestamp) on mount', () => {
    render(<BlockDetail {...makeProps()} />);
    expect(document.activeElement).toBe(screen.getByTestId('bd-edit-timestamp'));
  });

  it('Tab from last button wraps focus to first button', () => {
    render(<BlockDetail {...makeProps()} />);
    const closeBtn = screen.getByTestId('bd-close');
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(screen.getByTestId('bd-edit-timestamp'));
  });

  it('Shift+Tab from first button wraps focus to last button', () => {
    render(<BlockDetail {...makeProps()} />);
    const editBtn = screen.getByTestId('bd-edit-timestamp');
    editBtn.focus();
    expect(document.activeElement).toBe(editBtn);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('bd-close'));
  });

  // ── ARIA ───────────────────────────────────────────────────────────────────

  it('dialog has role="dialog" and aria-modal="true"', () => {
    render(<BlockDetail {...makeProps()} />);
    const dialog = screen.getByTestId('block-detail');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('dialog aria-label includes scene name', () => {
    render(<BlockDetail {...makeProps({ sceneName: 'The Departure' })} />);
    expect(screen.getByTestId('block-detail')).toHaveAttribute(
      'aria-label',
      'Scene details: The Departure',
    );
  });

  it('Edit timestamp button has aria-label', () => {
    render(<BlockDetail {...makeProps()} />);
    expect(screen.getByTestId('bd-edit-timestamp')).toHaveAttribute(
      'aria-label',
      'Edit timestamp for this scene',
    );
  });

  it('Open in editor button has aria-label', () => {
    render(<BlockDetail {...makeProps()} />);
    expect(screen.getByTestId('bd-open-editor')).toHaveAttribute(
      'aria-label',
      'Open this scene in the editor',
    );
  });

  it('Close button has aria-label', () => {
    render(<BlockDetail {...makeProps()} />);
    expect(screen.getByTestId('bd-close')).toHaveAttribute(
      'aria-label',
      'Close scene detail popover',
    );
  });

  it('confidence bar has aria-label describing confidence level', () => {
    render(<BlockDetail {...makeProps({ confidence: 0.75 })} />);
    expect(screen.getByTestId('bd-confidence-bar')).toHaveAttribute(
      'aria-label',
      'Confidence: 75%',
    );
  });

  // ── Accent color ──────────────────────────────────────────────────────────

  it('accentColor sets the --bd-accent CSS custom property on the dialog', () => {
    render(<BlockDetail {...makeProps({ accentColor: '#00f0ff' })} />);
    const dialog = screen.getByTestId('block-detail') as HTMLElement;
    expect(dialog.style.getPropertyValue('--bd-accent')).toBe('#00f0ff');
  });

  it('does not set inline style when accentColor is absent', () => {
    render(<BlockDetail {...makeProps({ accentColor: undefined })} />);
    const dialog = screen.getByTestId('block-detail') as HTMLElement;
    expect(dialog.style.getPropertyValue('--bd-accent')).toBe('');
  });

  // ── Data attribute ─────────────────────────────────────────────────────────

  it('dialog carries the sceneId as data-scene-id', () => {
    render(<BlockDetail {...makeProps({ sceneId: 'scene-abc-123' })} />);
    expect(screen.getByTestId('block-detail')).toHaveAttribute(
      'data-scene-id',
      'scene-abc-123',
    );
  });
});
