import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropdownSelect } from './DropdownSelect';
import type { SelectOption } from './DropdownSelect';

const SELECT_CSS = readFileSync(resolve(process.cwd(), 'src/components/ui/DropdownSelect.css'), 'utf-8');

const OPTIONS: SelectOption[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'durian', label: 'Durian', disabled: true },
];

function renderSelect(props: Partial<Parameters<typeof DropdownSelect>[0]> = {}) {
  const defaults = {
    value: 'apple',
    options: OPTIONS,
    onChange: vi.fn(),
  };
  return render(<DropdownSelect {...defaults} {...props} />);
}

describe('DropdownSelect', () => {
  describe('trigger rendering', () => {
    it('renders the selected option label in the trigger', () => {
      renderSelect({ value: 'banana' });
      expect(screen.getByRole('combobox')).toHaveTextContent('Banana');
    });

    it('renders placeholder when value does not match any option', () => {
      renderSelect({ value: '' });
      expect(screen.getByRole('combobox')).toHaveTextContent('Select…');
    });

    it('renders custom placeholder', () => {
      renderSelect({ value: '', placeholder: 'Choose one' });
      expect(screen.getByRole('combobox')).toHaveTextContent('Choose one');
    });

    it('trigger is disabled when disabled prop is true', () => {
      renderSelect({ disabled: true });
      expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('has aria-expanded="false" when closed', () => {
      renderSelect();
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('open / close', () => {
    it('opens listbox on trigger click', () => {
      renderSelect();
      fireEvent.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('closes listbox on second trigger click', () => {
      renderSelect();
      const trigger = screen.getByRole('combobox');
      fireEvent.click(trigger);
      fireEvent.click(trigger);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('has aria-expanded="true" when open', () => {
      renderSelect();
      fireEvent.click(screen.getByRole('combobox'));
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes on Escape and returns focus to trigger', () => {
      renderSelect();
      fireEvent.click(screen.getByRole('combobox'));
      const listbox = screen.getByRole('listbox');
      fireEvent.keyDown(listbox, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes on outside click', () => {
      renderSelect();
      fireEvent.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes on Tab', () => {
      renderSelect();
      fireEvent.click(screen.getByRole('combobox'));
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('option selection', () => {
    it('renders all options in the listbox', () => {
      renderSelect();
      fireEvent.click(screen.getByRole('combobox'));
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(OPTIONS.length);
    });

    it('marks the current value option as selected', () => {
      renderSelect({ value: 'banana' });
      fireEvent.click(screen.getByRole('combobox'));
      expect(screen.getByTestId('select-option-banana')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('select-option-apple')).toHaveAttribute('aria-selected', 'false');
    });

    it('calls onChange with the clicked option value', () => {
      const onChange = vi.fn();
      renderSelect({ onChange });
      fireEvent.click(screen.getByRole('combobox'));
      fireEvent.click(screen.getByTestId('select-option-banana'));
      expect(onChange).toHaveBeenCalledWith('banana');
    });

    it('closes the listbox after selecting an option', () => {
      renderSelect();
      fireEvent.click(screen.getByRole('combobox'));
      fireEvent.click(screen.getByTestId('select-option-cherry'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('does not call onChange when clicking a disabled option', () => {
      const onChange = vi.fn();
      renderSelect({ onChange });
      fireEvent.click(screen.getByRole('combobox'));
      fireEvent.click(screen.getByTestId('select-option-durian'));
      expect(onChange).not.toHaveBeenCalled();
    });

    it('marks disabled options with aria-disabled', () => {
      renderSelect();
      fireEvent.click(screen.getByRole('combobox'));
      expect(screen.getByTestId('select-option-durian')).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('keyboard navigation', () => {
    it('opens the listbox on ArrowDown from trigger', () => {
      renderSelect();
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('opens the listbox on Enter from trigger', () => {
      renderSelect();
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('moves focus to next enabled option on ArrowDown in listbox', async () => {
      renderSelect({ value: 'apple' });
      fireEvent.click(screen.getByRole('combobox'));
      const listbox = screen.getByRole('listbox');
      const appleOpt = screen.getByTestId('select-option-apple');
      appleOpt.focus();
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      expect(screen.getByTestId('select-option-banana')).toHaveFocus();
    });

    it('selects the focused option on Enter in listbox', () => {
      const onChange = vi.fn();
      renderSelect({ onChange, value: 'apple' });
      fireEvent.click(screen.getByRole('combobox'));
      const listbox = screen.getByRole('listbox');
      // Navigate to banana
      const appleOpt = screen.getByTestId('select-option-apple');
      appleOpt.focus();
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      fireEvent.keyDown(listbox, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith('banana');
    });

    it('moves focus to first enabled option on Home', () => {
      renderSelect({ value: 'cherry' });
      fireEvent.click(screen.getByRole('combobox'));
      const listbox = screen.getByRole('listbox');
      const cherryOpt = screen.getByTestId('select-option-cherry');
      cherryOpt.focus();
      fireEvent.keyDown(listbox, { key: 'Home' });
      expect(screen.getByTestId('select-option-apple')).toHaveFocus();
    });

    it('moves focus to last enabled option on End', () => {
      renderSelect({ value: 'apple' });
      fireEvent.click(screen.getByRole('combobox'));
      const listbox = screen.getByRole('listbox');
      const appleOpt = screen.getByTestId('select-option-apple');
      appleOpt.focus();
      fireEvent.keyDown(listbox, { key: 'End' });
      // 'durian' is disabled so last enabled is 'cherry'
      expect(screen.getByTestId('select-option-cherry')).toHaveFocus();
    });

    it('skips disabled options on ArrowDown navigation', () => {
      // cherry is right before durian (disabled)
      renderSelect({ value: 'cherry' });
      fireEvent.click(screen.getByRole('combobox'));
      const listbox = screen.getByRole('listbox');
      const cherryOpt = screen.getByTestId('select-option-cherry');
      cherryOpt.focus();
      // ArrowDown from cherry: durian is disabled, so no next item
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      // cherry should remain focused (no next enabled option after cherry)
      expect(screen.getByTestId('select-option-cherry')).toHaveFocus();
    });
  });
});

// ─── Liquid Neon a11y — CSS regression ───────────────────────────────────────

describe('DropdownSelect — Liquid Neon a11y CSS', () => {
  it('trigger focus ring uses --focus-ring token', () => {
    const m = SELECT_CSS.match(/\.ln-select-trigger:focus-visible[^{]*\{([^}]*)\}/);
    expect(m?.[1] ?? '').toContain('var(--focus-ring)');
  });

  it('reduced-motion block removes listbox open animation', () => {
    expect(SELECT_CSS).toContain('@media (prefers-reduced-motion');
    const m = SELECT_CSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\{([\s\S]*?)\}\s*\}/,
    );
    expect(m?.[1] ?? '').toContain('animation: none');
  });

  it('high-contrast block uses solid border on trigger', () => {
    expect(SELECT_CSS).toContain('[data-contrast="high"]');
    const m = SELECT_CSS.match(
      /\[data-contrast="high"\]\s*\.ln-select-trigger\s*\{([^}]*)\}/,
    );
    expect(m?.[1] ?? '').toContain('border-color');
  });

  it('trigger has role="combobox" and aria-haspopup="listbox"', () => {
    renderSelect();
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('selected option has aria-selected="true"', () => {
    renderSelect({ value: 'apple' });
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByTestId('select-option-apple')).toHaveAttribute('aria-selected', 'true');
  });
});
