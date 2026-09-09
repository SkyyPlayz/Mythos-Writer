// SKY-11151 / SKY-11452 — the shared template / blank / import radiogroup.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VaultCreateModePicker, { VAULT_CREATE_MODES } from './VaultCreateModePicker';

describe('VaultCreateModePicker', () => {
  it('renders the same three options for every kind, template marked RECOMMENDED', () => {
    for (const kind of ['notes', 'story', 'mythos'] as const) {
      expect(VAULT_CREATE_MODES[kind].map((m) => m.key)).toEqual(['template', 'blank', 'import']);
      expect(VAULT_CREATE_MODES[kind].filter((m) => m.recommended).map((m) => m.key)).toEqual(['template']);
    }
    render(<VaultCreateModePicker kind="mythos" value="template" onChange={vi.fn()} testIdPrefix="pick" />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByTestId('pick-template')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('pick-template').textContent).toContain('RECOMMENDED');
    expect(screen.getByTestId('pick-blank')).toHaveAttribute('aria-checked', 'false');
    // The mythos copy must never promise sample content (§3 removed it).
    expect(screen.getByRole('radiogroup', { name: 'How to start' }).textContent).not.toMatch(/Veynn|demo|sample/i);
  });

  it('reports the clicked mode and honours disabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(<VaultCreateModePicker kind="notes" value="template" onChange={onChange} testIdPrefix="pick" />);
    fireEvent.click(screen.getByTestId('pick-import'));
    expect(onChange).toHaveBeenCalledWith('import');
    rerender(<VaultCreateModePicker kind="notes" value="import" onChange={onChange} disabled testIdPrefix="pick" />);
    expect(screen.getByTestId('pick-import')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('pick-blank'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
