import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WritingPartnerSection from './WritingPartnerSection';

const baseSettings = {
  apiKey: '',
  theme: 'dark' as const,
  agents: {
    writingAssistant: { enabled: true, model: '', scanIntervalSeconds: 60 },
    brainstorm: { enabled: true, model: '' },
    archive: { enabled: true, model: '', continuityCheckIntervalSeconds: 60 },
  },
  agentNames: {},
} as unknown as AppSettings;

describe('WritingPartnerSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PLAN-058 Lane A: Writing Coach switch sits above personality teaching chips', () => {
    render(
      <WritingPartnerSection
        settings={baseSettings}
        setSettings={vi.fn()}
        setAgentDisplayName={vi.fn()}
        setSavedOk={vi.fn()}
      />,
    );
    expect(screen.getByTestId('writing-coach-settings')).toBeInTheDocument();
    expect(screen.getByTestId('writing-coach-mode-teacher')).toHaveTextContent('Teacher');
    expect(screen.getByTestId('writing-coach-mode-assistant')).toHaveTextContent('Assistant');
    const modes = screen.getByTestId('writing-coach-teaching-modes');
    expect(modes.querySelector('button')).toBeNull();
    expect(modes.querySelector('[aria-pressed]')).toBeNull();
    const coach = screen.getByTestId('writing-coach-settings');
    const personality = screen.getByTestId('wp-personality');
    expect(coach.compareDocumentPosition(personality) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders personality two-column layout and named Teaching chips', () => {
    const setSettings = vi.fn();
    const setAgentDisplayName = vi.fn();
    render(
      <WritingPartnerSection
        settings={baseSettings}
        setSettings={setSettings}
        setAgentDisplayName={setAgentDisplayName}
        setSavedOk={vi.fn()}
      />,
    );
    expect(screen.getByTestId('wp-personality-copy')).toBeInTheDocument();
    expect(screen.getByTestId('wp-behavior-spec')).toBeInTheDocument();
    expect(screen.getByTestId('wp-trait-teach-socratic')).toBeInTheDocument();
    expect(screen.getByTestId('wp-trait-teach-guided-practice')).toBeInTheDocument();
    expect(screen.getByTestId('wp-trait-teach-feynman')).toBeInTheDocument();
    expect(screen.getByTestId('wp-trait-teach-just-tell-me')).toBeInTheDocument();
    expect(screen.getByTestId('wp-trait-teach-adaptive')).toBeInTheDocument();
    expect(screen.getByTestId('wp-hb-dedupe')).toBeInTheDocument();
    expect(screen.getByTestId('wp-hb-run-dedupe')).toHaveTextContent('Run now');
  });

  it('renames partner via brainstorm identity store', () => {
    const setSettings = vi.fn();
    const setAgentDisplayName = vi.fn();
    render(
      <WritingPartnerSection
        settings={baseSettings}
        setSettings={setSettings}
        setAgentDisplayName={setAgentDisplayName}
        setSavedOk={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId('wp-name'), { target: { value: 'Athena' } });
    expect(setAgentDisplayName).toHaveBeenCalledWith('brainstorm', 'Athena');
  });

  it('F3: mounts partner Session history (brainstorm) for Earlier chats', () => {
    render(
      <WritingPartnerSection
        settings={baseSettings}
        setSettings={vi.fn()}
        setAgentDisplayName={vi.fn()}
        setSavedOk={vi.fn()}
      />,
    );
    expect(screen.getByTestId('wp-session-history')).toBeInTheDocument();
    expect(screen.getByTestId('session-history-toggle-brainstorm')).toBeInTheDocument();
  });
});
