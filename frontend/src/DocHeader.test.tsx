import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DocHeader from './DocHeader';

function baseProps() {
  return {
    title: 'Original Title',
    onTitleChange: vi.fn(),
    wordCount: 0,
    breadcrumb: ['Story', 'Chapter One', 'Original Title'],
    zoom: 1,
    onZoomChange: vi.fn(),
    isFocusMode: false,
    onFocusToggle: vi.fn(),
  };
}

describe('DocHeader', () => {
  it('renders the wordCount prop instead of a hardcoded value', () => {
    render(<DocHeader {...baseProps()} wordCount={1234} />);
    expect(screen.getByLabelText('1234 words')).toBeInTheDocument();
    expect(screen.getByText('1,234 words')).toBeInTheDocument();
  });

  it('commits a real title edit on blur', () => {
    const onTitleChange = vi.fn();
    render(<DocHeader {...baseProps()} onTitleChange={onTitleChange} />);
    const titleEl = screen.getByRole('textbox', { name: 'Scene title' });
    act(() => titleEl.focus());
    titleEl.textContent = 'New Scene Title';
    act(() => titleEl.blur());
    expect(onTitleChange).toHaveBeenCalledTimes(1);
    expect(onTitleChange).toHaveBeenCalledWith('New Scene Title');
  });

  it('does not fire onTitleChange when the title is unchanged', () => {
    const onTitleChange = vi.fn();
    render(<DocHeader {...baseProps()} onTitleChange={onTitleChange} />);
    const titleEl = screen.getByRole('textbox', { name: 'Scene title' });
    act(() => titleEl.focus());
    act(() => titleEl.blur());
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it('rejects a blank commit and restores the last known title instead of discarding it silently', () => {
    const onTitleChange = vi.fn();
    render(<DocHeader {...baseProps()} onTitleChange={onTitleChange} />);
    const titleEl = screen.getByRole('textbox', { name: 'Scene title' });
    act(() => titleEl.focus());
    titleEl.textContent = '   ';
    act(() => titleEl.blur());
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(titleEl.textContent).toBe('Original Title');
  });

  it('commits on Enter key without inserting a newline', () => {
    const onTitleChange = vi.fn();
    render(<DocHeader {...baseProps()} onTitleChange={onTitleChange} />);
    const titleEl = screen.getByRole('textbox', { name: 'Scene title' });
    act(() => titleEl.focus());
    titleEl.textContent = 'Renamed via Enter';
    act(() => {
      titleEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(onTitleChange).toHaveBeenCalledWith('Renamed via Enter');
  });
});
