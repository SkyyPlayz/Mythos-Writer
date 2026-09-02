// SKY-11223 — AiActivityIndicator: the always-visible surface naming what's
// running and letting the user stop it (AC1/AC3/AC5).

import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiActivityIndicator } from './AiActivityIndicator';
import { resetAiActivityForTests } from '../../agents/aiActivity';

function makeEntry(overrides: Partial<AiActivityEntry> = {}): AiActivityEntry {
  return {
    requestId: 'req-1',
    agent: 'writingAssistant',
    agentLabel: 'Writing Coach',
    surface: 'writing-coach',
    surfaceLabel: 'Writing Coach',
    provider: { kind: 'lmstudio', model: 'qwen3.6-35b-a3b' },
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('AiActivityIndicator', () => {
  let updateListener: (entries: AiActivityEntry[]) => void;
  let cancelSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetAiActivityForTests();
    cancelSpy = vi.fn();
    (window as any).api = {
      getAiActivitySnapshot: vi.fn().mockResolvedValue([]),
      onAiActivityUpdate: (cb: (entries: AiActivityEntry[]) => void) => {
        updateListener = cb;
        return () => {};
      },
      onAiActivityTerminal: () => () => {},
      cancelAiActivity: cancelSpy,
    };
  });

  it('renders nothing while idle', async () => {
    render(<AiActivityIndicator />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('ai-activity-indicator')).not.toBeInTheDocument();
  });

  it('names the agent, surface, and provider/model while a request is running', async () => {
    render(<AiActivityIndicator />);
    await act(async () => { await Promise.resolve(); });
    act(() => { updateListener([makeEntry()]); });

    const row = screen.getByTestId('ai-activity-indicator');
    expect(row.textContent).toContain('Writing Coach');
    expect(row.textContent).toContain('lmstudio');
    expect(row.textContent).toContain('qwen3.6-35b-a3b');
  });

  it('Stop calls through to cancelAiActivity with the request id', async () => {
    render(<AiActivityIndicator />);
    await act(async () => { await Promise.resolve(); });
    act(() => { updateListener([makeEntry({ requestId: 'req-42' })]); });

    screen.getByRole('button', { name: /stop writing coach/i }).click();
    expect(cancelSpy).toHaveBeenCalledWith('req-42');
  });
});
