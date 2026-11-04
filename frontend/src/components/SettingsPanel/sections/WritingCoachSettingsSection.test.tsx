/**
 * PLAN-COACHING-OPT-IN — Settings › Writing partner › Writing Coach card.
 *
 * Owns: the Coaching opt-in + Teacher / Assistant pick as a user drives it
 * (default off, dormant Teacher, mode writes, persistence across a remount,
 * malformed fallback) and the guarantee that Coaching never flips the
 * Writing Coach master pair (waEnabled / agents.writingAssistant.enabled).
 * Never touches: prompt text (partnerPersonality.coaching.test.ts owns that).
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import WritingCoachSettingsSection from './WritingCoachSettingsSection';

// vitest-axe legacy matcher typing — same registration as accessibility.test.tsx.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
expect.extend(axeMatchers);
// colour-contrast needs computed styles jsdom doesn't have.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

function baseSettings(extra: Record<string, unknown> = {}): AppSettings {
  return {
    apiKey: '',
    theme: 'dark',
    waEnabled: true,
    agents: {
      writingAssistant: { enabled: true, model: '', scanIntervalSeconds: 60 },
      brainstorm: { enabled: true, model: '' },
      archive: { enabled: true, model: '', continuityCheckIntervalSeconds: 60 },
    },
    ...extra,
  } as unknown as AppSettings;
}

/** Real state wiring (as SettingsPanel does) so clicks round-trip through setSettings. */
function renderCard(initial: AppSettings) {
  const latest: { current: AppSettings } = { current: initial };
  const setSavedOk = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState<AppSettings>(initial);
    latest.current = settings;
    return (
      <WritingCoachSettingsSection
        settings={settings}
        setSettings={setSettings}
        setSavedOk={setSavedOk}
      />
    );
  }
  const view = render(<Harness />);
  return { ...view, latest, setSavedOk };
}

const optIn = () => screen.getByRole('checkbox', { name: 'Enable coaching' }) as HTMLInputElement;
const radio = (name: 'Teacher' | 'Assistant') =>
  screen.getByRole('radio', { name }) as HTMLInputElement;

describe('WritingCoachSettingsSection — Coaching opt-in', () => {
  it('fresh profile: Coaching off, modes disabled, Teacher waits dormant', () => {
    renderCard(baseSettings());
    expect(optIn().checked).toBe(false);
    expect(radio('Teacher').checked).toBe(true);
    expect(radio('Teacher')).toBeDisabled();
    expect(radio('Assistant')).toBeDisabled();
    expect(screen.getByTestId('writing-coach-mode-hint')).toHaveTextContent(/Coaching is off/);
    expect(screen.queryByText('Mode behavior coming soon.')).toBeNull();
  });

  it('turning Coaching on lands on Teacher and leaves the Writing Coach master pair alone', () => {
    const { latest, setSavedOk } = renderCard(baseSettings());
    fireEvent.click(optIn());
    expect(optIn().checked).toBe(true);
    expect(radio('Teacher').checked).toBe(true);
    expect(radio('Teacher')).toBeEnabled();
    expect(latest.current.coaching).toEqual({ optIn: true, mode: 'teacher' });
    expect(latest.current.waEnabled).toBe(true);
    expect(latest.current.agents.writingAssistant.enabled).toBe(true);
    expect(setSavedOk).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('writing-coach-mode-hint')).toHaveTextContent(/Names the craft/);
  });

  it('Coaching changes never flip a Writing Coach that is off', () => {
    const { latest } = renderCard(baseSettings({
      waEnabled: false,
      agents: {
        writingAssistant: { enabled: false, model: '', scanIntervalSeconds: 60 },
        brainstorm: { enabled: true, model: '' },
        archive: { enabled: true, model: '', continuityCheckIntervalSeconds: 60 },
      },
    }));
    fireEvent.click(optIn());
    fireEvent.click(radio('Assistant'));
    fireEvent.click(optIn());
    expect(latest.current.coaching).toEqual({ optIn: false, mode: 'assistant' });
    expect(latest.current.waEnabled).toBe(false);
    expect(latest.current.agents.writingAssistant.enabled).toBe(false);
  });

  it('picking Assistant writes the mode', () => {
    const { latest } = renderCard(baseSettings({ coaching: { optIn: true, mode: 'teacher' } }));
    fireEvent.click(radio('Assistant'));
    expect(radio('Assistant').checked).toBe(true);
    expect(latest.current.coaching).toEqual({ optIn: true, mode: 'assistant' });
    expect(screen.getByTestId('writing-coach-mode-hint')).toHaveTextContent(/no lessons unless you ask/);
  });

  it('a stored Assistant (Coaching off) is restored when Coaching is turned back on', () => {
    const { latest } = renderCard(baseSettings({ coaching: { optIn: false, mode: 'assistant' } }));
    expect(radio('Assistant').checked).toBe(true);
    fireEvent.click(optIn());
    expect(latest.current.coaching).toEqual({ optIn: true, mode: 'assistant' });
  });

  it('Assistant → off → relaunch (remount from saved settings) → on keeps Assistant', () => {
    const first = renderCard(baseSettings({ coaching: { optIn: true, mode: 'assistant' } }));
    fireEvent.click(optIn());
    const saved = first.latest.current;
    expect(saved.coaching).toEqual({ optIn: false, mode: 'assistant' });
    first.unmount();

    const second = renderCard(saved);
    expect(optIn().checked).toBe(false);
    expect(radio('Assistant').checked).toBe(true);
    fireEvent.click(optIn());
    expect(second.latest.current.coaching).toEqual({ optIn: true, mode: 'assistant' });
  });

  it('malformed stored coaching falls back safely (mode → Teacher, garbage optIn → off)', () => {
    const { unmount } = renderCard(baseSettings({ coaching: { optIn: true, mode: 'lecturer' } }));
    expect(optIn().checked).toBe(true);
    expect(radio('Teacher').checked).toBe(true);
    unmount();

    renderCard(baseSettings({ coaching: { optIn: 'yes', mode: 'assistant' } }));
    expect(optIn().checked).toBe(false);
    expect(radio('Assistant')).toBeDisabled();
  });

  it('the Writing Coach master switch still writes only the master pair', () => {
    const { latest } = renderCard(baseSettings({ coaching: { optIn: true, mode: 'assistant' } }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Writing Coach' }));
    expect(latest.current.waEnabled).toBe(false);
    expect(latest.current.agents.writingAssistant.enabled).toBe(false);
    expect(latest.current.coaching).toEqual({ optIn: true, mode: 'assistant' });
  });

  it('has no axe violations with Coaching off and on', async () => {
    const { container } = renderCard(baseSettings());
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(optIn());
    expect(await axe(container)).toHaveNoViolations();
  });
});
