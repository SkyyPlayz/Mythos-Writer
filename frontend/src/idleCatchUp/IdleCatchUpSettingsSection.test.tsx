// PLAN-IDLE-CATCH-UP — Settings → Editor → Idle catch-up card. Renders a
// stateful harness (settings round-trip through setSettings like the real
// panel) so draft / clamp behaviour is exercised end to end.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import IdleCatchUpSettingsSection from './IdleCatchUpSettingsSection';
import { idleCatchUpGate } from './idleCatchUpGate';

// vitest-axe@0.1.0's legacy matcher typing — same registration as accessibility.test.tsx.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
expect.extend(axeMatchers);
// colour-contrast needs computed styles jsdom doesn't have.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

function Harness({ initial, onSettings, setSavedOk }: {
  initial: AppSettings;
  onSettings: (s: AppSettings) => void;
  setSavedOk: (ok: boolean) => void;
}) {
  const [settings, setSettings] = useState<AppSettings>(initial);
  onSettings(settings);
  return <IdleCatchUpSettingsSection settings={settings} setSettings={setSettings} setSavedOk={setSavedOk} />;
}

function setup(idleCatchUp?: { enabled: boolean; minutes: number }) {
  const configure = vi.spyOn(idleCatchUpGate, 'configure').mockImplementation(() => {});
  const setSavedOk = vi.fn();
  const initial = (idleCatchUp ? { idleCatchUp } : {}) as unknown as AppSettings;
  let latest: AppSettings = initial;
  const view = render(<Harness initial={initial} onSettings={(s) => { latest = s; }} setSavedOk={setSavedOk} />);
  const checkbox = screen.getByLabelText('Wait for a typing pause before background scans') as HTMLInputElement;
  const minutes = screen.getByLabelText('Minutes without typing') as HTMLInputElement;
  return { ...view, checkbox, minutes, configure, setSavedOk, saved: () => latest.idleCatchUp };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IdleCatchUpSettingsSection', () => {
  it('renders the defaults when idleCatchUp is missing: on, 2 minutes, 1..30 step 1', () => {
    const { checkbox, minutes, configure, setSavedOk, saved } = setup();
    expect(screen.getByRole('heading', { name: 'Idle catch-up' })).toBeInTheDocument();
    expect(checkbox.type).toBe('checkbox');
    expect(checkbox.checked).toBe(true);
    expect(minutes.type).toBe('number');
    expect(minutes.value).toBe('2');
    expect(minutes.min).toBe('1');
    expect(minutes.max).toBe('30');
    expect(minutes.step).toBe('1');
    expect(minutes.disabled).toBe(false);
    // Rendering alone writes nothing.
    expect(saved()).toBeUndefined();
    expect(configure).not.toHaveBeenCalled();
    expect(setSavedOk).not.toHaveBeenCalled();
  });

  it('hint is tied to both controls and keeps the plain "may finish" sentence', () => {
    const { checkbox, minutes } = setup();
    const hint = document.getElementById(checkbox.getAttribute('aria-describedby') ?? '');
    expect(hint).not.toBeNull();
    expect(minutes.getAttribute('aria-describedby')).toBe(hint!.id);
    expect(hint!.textContent).toContain('If a background scan already started, it may finish after you start typing again.');
    expect(hint!.textContent).toContain('may finish after you start typing again');
    expect(hint!.textContent).not.toContain('Off: background scans start right away.');
    expect(hint!.textContent).not.toMatch(/paused|stopped|killed/i);
  });

  it('turning it off writes enabled:false, disables the minutes field, applies live and adds the off hint', () => {
    const { checkbox, minutes, configure, setSavedOk, saved } = setup();
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(saved()).toEqual({ enabled: false, minutes: 2 });
    expect(minutes.disabled).toBe(true);
    expect(setSavedOk).toHaveBeenCalledWith(false);
    expect(configure).toHaveBeenLastCalledWith({ enabled: false, minutes: 2 });
    const hint = document.getElementById(checkbox.getAttribute('aria-describedby') ?? '');
    expect(hint!.textContent).toContain('Off: background scans start right away.');

    fireEvent.click(checkbox);
    expect(saved()).toEqual({ enabled: true, minutes: 2 });
    expect(minutes.disabled).toBe(false);
    expect(configure).toHaveBeenLastCalledWith({ enabled: true, minutes: 2 });
  });

  it('renders a saved off state', () => {
    const { checkbox, minutes } = setup({ enabled: false, minutes: 7 });
    expect(checkbox.checked).toBe(false);
    expect(minutes.value).toBe('7');
    expect(minutes.disabled).toBe(true);
  });

  it('clamps 0 up to 1 on blur', () => {
    const { minutes, configure, saved } = setup();
    fireEvent.change(minutes, { target: { value: '0' } });
    // Out of range: shown as typed, not written yet.
    expect(minutes.value).toBe('0');
    expect(saved()).toBeUndefined();
    fireEvent.blur(minutes);
    expect(minutes.value).toBe('1');
    expect(saved()).toEqual({ enabled: true, minutes: 1 });
    expect(configure).toHaveBeenLastCalledWith({ enabled: true, minutes: 1 });
  });

  it('clamps 45 down to 30 on Enter', () => {
    const { minutes, configure, saved } = setup();
    fireEvent.change(minutes, { target: { value: '45' } });
    expect(saved()).toBeUndefined();
    fireEvent.keyDown(minutes, { key: 'Enter' });
    expect(minutes.value).toBe('30');
    expect(saved()).toEqual({ enabled: true, minutes: 30 });
    expect(configure).toHaveBeenLastCalledWith({ enabled: true, minutes: 30 });
  });

  it('typing "1" then "15" lands on 15 and applies it live', () => {
    const { minutes, configure, setSavedOk, saved } = setup();
    fireEvent.change(minutes, { target: { value: '1' } });
    fireEvent.change(minutes, { target: { value: '15' } });
    expect(minutes.value).toBe('15');
    fireEvent.blur(minutes);
    expect(minutes.value).toBe('15');
    expect(saved()).toEqual({ enabled: true, minutes: 15 });
    expect(setSavedOk).toHaveBeenCalledWith(false);
    expect(configure).toHaveBeenLastCalledWith({ enabled: true, minutes: 15 });
  });

  it('an emptied field falls back to the last value on blur', () => {
    const { minutes, saved } = setup({ enabled: true, minutes: 4 });
    fireEvent.change(minutes, { target: { value: '' } });
    expect(minutes.value).toBe('');
    fireEvent.blur(minutes);
    expect(minutes.value).toBe('4');
    expect(saved()).toEqual({ enabled: true, minutes: 4 });
  });

  it('has no axe violations, on and off', async () => {
    const { container, checkbox } = setup();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(checkbox);
    expect(await axe(container)).toHaveNoViolations();
  });
});
