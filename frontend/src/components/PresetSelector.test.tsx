import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PresetSelector from './PresetSelector';
import { BUNDLED_PRESETS } from '../presets';

describe('PresetSelector', () => {
  const defaultProps = {
    activePresetId: BUNDLED_PRESETS[0].id,
    onSelect: vi.fn(),
    onCustomize: vi.fn(),
  };

  it('renders the active preset name', () => {
    render(<PresetSelector {...defaultProps} />);
    expect(screen.getByText(BUNDLED_PRESETS[0].name)).toBeInTheDocument();
  });

  it('opens dropdown on trigger click', () => {
    render(<PresetSelector {...defaultProps} />);
    const trigger = screen.getByRole('button', { name: /Writing preset/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('lists all bundled presets in the dropdown', () => {
    render(<PresetSelector {...defaultProps} />);
    const trigger = screen.getByRole('button', { name: /Writing preset/i });
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    for (const preset of BUNDLED_PRESETS) {
      // getByText may match the trigger chip too; scope to the listbox
      expect(listbox.textContent).toContain(preset.name);
    }
  });

  it('calls onSelect with the correct preset id when clicking an item', () => {
    const onSelect = vi.fn();
    render(<PresetSelector {...defaultProps} onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: /Writing preset/i });
    fireEvent.click(trigger);
    const target = BUNDLED_PRESETS[1];
    const option = screen.getAllByRole('option').find((el) => el.textContent?.includes(target.name));
    fireEvent.click(option!);
    expect(onSelect).toHaveBeenCalledWith(target.id);
  });

  it('closes on Escape key', () => {
    render(<PresetSelector {...defaultProps} />);
    const trigger = screen.getByRole('button', { name: /Writing preset/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows checkmark on the active preset', () => {
    render(<PresetSelector {...defaultProps} />);
    const trigger = screen.getByRole('button', { name: /Writing preset/i });
    fireEvent.click(trigger);
    const active = screen.getAllByRole('option').find((el) =>
      el.getAttribute('aria-selected') === 'true',
    );
    expect(active).toBeDefined();
    expect(active!.textContent).toContain('✓');
  });

  it('calls onCustomize when Customize is clicked', () => {
    const onCustomize = vi.fn();
    render(<PresetSelector {...defaultProps} onCustomize={onCustomize} />);
    fireEvent.click(screen.getByRole('button', { name: /Customize preset/i }));
    expect(onCustomize).toHaveBeenCalled();
  });
});
