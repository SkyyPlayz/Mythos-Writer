// SKY-11151 / SKY-11452 / Slice D — shared create-mode radiogroup.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VaultCreateModePicker, { VAULT_CREATE_MODES } from './VaultCreateModePicker';

describe('VaultCreateModePicker', () => {
  it('keeps notes/story at three options; mythos has Slice D five-path', () => {
    expect(VAULT_CREATE_MODES.notes.map((m) => m.key)).toEqual(['template', 'blank', 'import']);
    expect(VAULT_CREATE_MODES.story.map((m) => m.key)).toEqual(['template', 'blank', 'import']);
    expect(VAULT_CREATE_MODES.mythos.map((m) => m.key)).toEqual([
      'template', 'blank', 'import', 'restore', 'openin',
    ]);
    expect(VAULT_CREATE_MODES.mythos.filter((m) => m.recommended).map((m) => m.key)).toEqual(['template']);
    render(<VaultCreateModePicker kind="mythos" value="template" onChange={vi.fn()} testIdPrefix="pick" />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(screen.getByTestId('pick-template')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('pick-openin')).toBeInTheDocument();
    expect(screen.getByTestId('pick-openin-chip')).toHaveTextContent('IN PLACE');
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
