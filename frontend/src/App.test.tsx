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



  it('fetches a server-side browser session and sends only the CSRF proof when generating', async () => {
    const chunks = new TextEncoder().encode('data: {"chunk":"Once upon"}\n\ndata: [DONE]\n\n');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'browser-csrf-token' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(chunks);
            controller.close();
          },
        }),
      } as Response);

    render(<App />);

    fireEvent.change(screen.getByLabelText(/story prompt/i), {
      target: { value: 'A brave fox finds a hidden moon garden.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate story/i }));

    await waitFor(() => expect(screen.getByText(/Once upon/i)).toBeInTheDocument());

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/stories/session', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/stories/generate',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Story-CSRF': 'browser-csrf-token',
        },
      })
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('Bearer');
  });

  it('shows a friendly error when streaming responses are unsupported', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: null }),
      } as Response)
      .mockResolvedValueOnce({
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
