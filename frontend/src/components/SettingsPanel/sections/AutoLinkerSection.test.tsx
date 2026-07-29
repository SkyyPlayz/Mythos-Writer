// SKY-8833 / GH #1149 — the 'Format delay (ms)' field must be clearable while
// editing. The old NaN-guard skipped the settings update on empty input, so the
// controlled value re-rendered the previous number and the field snapped back
// mid-edit. These tests render a stateful harness (settings round-trip through
// setSettings like the real panel) so the snap-back would reproduce if present.
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AutoLinkerSection from './AutoLinkerSection';

const baseSettings = {
  autoLinkerSettings: {
    formatOnSave: true,
    includeAliases: true,
    proximityPreference: true,
    ignoreCase: false,
    preventSelfLink: true,
    ignoreDates: true,
    formatDelay: 2000,
    excludedFolders: [],
  },
} as unknown as AppSettings;

function Harness({ onSettings }: { onSettings: (s: AppSettings) => void }) {
  const [settings, setSettings] = useState<AppSettings>(baseSettings);
  onSettings(settings);
  return <AutoLinkerSection settings={settings} setSettings={setSettings} setSavedOk={vi.fn()} />;
}

function setup() {
  let latest: AppSettings = baseSettings;
  render(<Harness onSettings={(s) => { latest = s; }} />);
  const input = screen.getByLabelText('Format delay (ms)') as HTMLInputElement;
  return { input, delay: () => latest.autoLinkerSettings?.formatDelay };
}

describe('AutoLinkerSection format delay field (SKY-8833)', () => {
  it('stays empty while editing after clearing, keeping the last committed value', () => {
    const { input, delay } = setup();
    expect(input.value).toBe('2000');
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(delay()).toBe(2000);
  });

  it('clear-to-empty then type commits the new value', () => {
    const { input, delay } = setup();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.change(input, { target: { value: '500' } });
    expect(input.value).toBe('500');
    expect(delay()).toBe(500);
  });

  it('blur on an empty field falls back to the last committed value', () => {
    const { input, delay } = setup();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input.value).toBe('2000');
    expect(delay()).toBe(2000);
  });

  it('clamps out-of-range input on commit without reformatting mid-keystroke', () => {
    const { input, delay } = setup();
    fireEvent.change(input, { target: { value: '50000' } });
    expect(input.value).toBe('50000');
    expect(delay()).toBe(30000);
    fireEvent.blur(input);
    expect(input.value).toBe('30000');
  });
});
