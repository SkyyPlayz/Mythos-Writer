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

  it('renders personality two-column layout and named Teaching chips', () => {
    const setSettings = vi.fn();
    const setAgentDisplayName = vi.fn();
    render(
      <WritingPartnerSection
        settings={baseSettings}
        setSettings={setSettings}
        setAgentDisplayName={setAgentDisplayName}
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
      />,
    );
    fireEvent.change(screen.getByTestId('wp-name'), { target: { value: 'Athena' } });
    expect(setAgentDisplayName).toHaveBeenCalledWith('brainstorm', 'Athena');
  });

  it('F3#11: confidence slider defaults to Confident and syncs hand thresholds', () => {
    let latest: AppSettings = baseSettings;
    const setSettings = vi.fn((updater: AppSettings | ((prev: AppSettings) => AppSettings)) => {
      latest = typeof updater === 'function' ? updater(latest) : updater;
    });
    const { rerender } = render(
      <WritingPartnerSection
        settings={latest}
        setSettings={setSettings}
        setAgentDisplayName={vi.fn()}
      />,
    );
    expect(screen.getByTestId('wp-confidence-value')).toHaveTextContent('Confident');
    expect(screen.getByTestId('wp-confidence-threshold')).toHaveTextContent('0.85');

    fireEvent.change(screen.getByTestId('wp-confidence-slider'), { target: { value: '1' } });
    expect(setSettings).toHaveBeenCalled();
    expect(latest.writingPartner?.confidence).toBe('Cautious');
    expect(latest.agents?.brainstorm?.confidenceThreshold).toBeCloseTo(0.65);
    expect(latest.agents?.writingAssistant?.confidenceThreshold).toBeCloseTo(0.65);

    rerender(
      <WritingPartnerSection
        settings={latest}
        setSettings={setSettings}
        setAgentDisplayName={vi.fn()}
      />,
    );
    expect(screen.getByTestId('wp-confidence-value')).toHaveTextContent('Cautious');
    expect(screen.getByTestId('wp-confidence-threshold')).toHaveTextContent('0.65');
  });

  it('F3: mounts partner Session history (brainstorm) for Earlier chats', () => {
    render(
      <WritingPartnerSection
        settings={baseSettings}
        setSettings={vi.fn()}
        setAgentDisplayName={vi.fn()}
      />,
    );
    expect(screen.getByTestId('wp-session-history')).toBeInTheDocument();
    expect(screen.getByTestId('session-history-toggle-brainstorm')).toBeInTheDocument();
  });
});
