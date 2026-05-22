import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the heading', () => {
    render(<App />);
    expect(screen.getByText('Mythos Writer')).toBeInTheDocument();
  });

  it('renders the generate button', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /generate story/i })).toBeInTheDocument();
  });

  it('shows a friendly error when streaming responses are unsupported', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: null,
    } as Response);

    render(<App />);

    fireEvent.change(screen.getByLabelText(/story prompt/i), {
      target: { value: 'A brave fox finds a hidden moon garden.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate story/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/streaming story responses are not supported/i)
      ).toBeInTheDocument();
    });
  });
});
