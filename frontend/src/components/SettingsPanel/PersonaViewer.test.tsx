// Beta 3 M22 — PersonaViewer: identity-file editor (agent.md / instructions.md /
// learning.md / soul.md + descriptive tools.md) for all four named agents.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PersonaViewer from './PersonaViewer';

const mockRead = vi.fn();
const mockReset = vi.fn();
const mockWrite = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { api: Record<string, unknown> }).api = {
    agentPersonaRead: mockRead,
    agentPersonaReset: mockReset,
    agentPersonaWrite: mockWrite,
  };
  mockRead.mockImplementation(async (_agent: string, key: string) => ({
    content: `# ${key} default body`,
    isCustom: false,
  }));
  mockReset.mockResolvedValue({ success: true });
  mockWrite.mockResolvedValue({ success: true });
});

async function openViewer(agentName: 'writingAssistant' | 'brainstorm' | 'archive' | 'betaReader' = 'betaReader') {
  render(<PersonaViewer agentName={agentName} />);
  fireEvent.click(screen.getByRole('button', { name: /identity & files/i }));
  await waitFor(() => expect(mockRead).toHaveBeenCalled());
}

describe('PersonaViewer (Beta 3 M22)', () => {
  it('shows the four identity file tabs plus tools.md', async () => {
    await openViewer('betaReader');
    for (const fileName of ['agent.md', 'instructions.md', 'learning.md', 'soul.md', 'tools.md']) {
      expect(screen.getByRole('tab', { name: new RegExp(fileName.replace('.', '\\.')) })).toBeInTheDocument();
    }
  });

  it('loads content for every tab of the given agent (archive supported)', async () => {
    await openViewer('archive');
    for (const key of ['AGENTS', 'HEARTBEAT', 'LEARNING', 'SOUL', 'TOOLS']) {
      await waitFor(() => expect(mockRead).toHaveBeenCalledWith('archive', key));
    }
  });

  it('editing + Save file writes the override through agentPersonaWrite', async () => {
    await openViewer('betaReader');
    const editor = await screen.findByTestId('persona-editor-betaReader');
    fireEvent.change(editor, { target: { value: 'be kinder' } });
    fireEvent.click(screen.getByTestId('persona-save-betaReader'));

    await waitFor(() => expect(mockWrite).toHaveBeenCalledWith('betaReader', 'AGENTS', 'be kinder'));
    // Save reloads the file so the custom badge reflects main-process state.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
  });

  it('Save is disabled until the draft differs from the loaded content', async () => {
    await openViewer('betaReader');
    await screen.findByTestId('persona-editor-betaReader');
    expect(screen.getByTestId('persona-save-betaReader')).toBeDisabled();
  });

  it('selecting the soul.md tab saves against the SOUL key', async () => {
    await openViewer('betaReader');
    fireEvent.click(screen.getByRole('tab', { name: /soul\.md/ }));
    const editor = await screen.findByTestId('persona-editor-betaReader');
    fireEvent.change(editor, { target: { value: '# SOUL default body — moody' } });
    fireEvent.click(screen.getByTestId('persona-save-betaReader'));

    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    expect(mockWrite.mock.calls[0][1]).toBe('SOUL');
  });

  it('Reset to default appears for custom files and calls agentPersonaReset', async () => {
    mockRead.mockImplementation(async (_agent: string, key: string) => ({
      content: `# ${key} custom body`,
      isCustom: true,
    }));
    await openViewer('writingAssistant');
    const resetBtn = await screen.findByRole('button', { name: /reset to default/i });
    fireEvent.click(resetBtn);
    await waitFor(() => expect(mockReset).toHaveBeenCalledWith('writingAssistant', 'AGENTS'));
  });
});
