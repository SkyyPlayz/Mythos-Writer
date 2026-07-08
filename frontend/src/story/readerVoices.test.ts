// Beta 3 M13 — reader voice-picker enumeration tests.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listReaderVoices } from './readerVoices';

function stubVoices(voices: Array<{ name: string; lang: string }>) {
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    getVoices: () => voices,
  };
}

beforeEach(() => {
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
});

afterEach(() => {
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
});

describe('listReaderVoices', () => {
  it('degrades to a single Default entry when speechSynthesis is missing', () => {
    expect(listReaderVoices()).toEqual([{ value: '', label: 'Default voice' }]);
  });

  it('lists English OS voices first (prototype en filter)', () => {
    stubVoices([
      { name: 'Aria (Natural)', lang: 'en-US' },
      { name: 'Hans', lang: 'de-DE' },
      { name: 'Sonia', lang: 'en-GB' },
    ]);
    const options = listReaderVoices();
    expect(options.map((o) => o.value)).toEqual(['', 'Aria (Natural)', 'Sonia']);
    expect(options[1].label).toBe('Aria — system');
  });

  it('falls back to all OS voices when none are English', () => {
    stubVoices([
      { name: 'Hans', lang: 'de-DE' },
      { name: 'Yuki', lang: 'ja-JP' },
    ]);
    expect(listReaderVoices().map((o) => o.value)).toEqual(['', 'Hans', 'Yuki']);
  });

  it('appends the configured Piper engine voice when an engine is set up', () => {
    stubVoices([{ name: 'Aria', lang: 'en-US' }]);
    const options = listReaderVoices({
      enabled: true,
      provider: 'local',
      localBinaryPath: '/usr/local/bin/piper',
      voiceId: 'en_US/vctk_low',
    });
    expect(options).toContainEqual({
      value: 'en_US/vctk_low',
      label: 'en_US/vctk_low — Piper (local)',
    });
  });

  it('labels a cloud engine voice as cloud', () => {
    const options = listReaderVoices({
      enabled: true,
      provider: 'cloud',
      cloudApiKey: 'k',
      voiceId: 'alloy',
    });
    expect(options).toContainEqual({ value: 'alloy', label: 'alloy — cloud' });
  });

  it('omits the engine voice when the engine is not actually configured', () => {
    const options = listReaderVoices({ enabled: false, provider: 'local', voiceId: 'ghost' });
    expect(options.some((o) => o.value === 'ghost')).toBe(false);
  });

  it('keeps the current selection selectable even when unknown to the OS', () => {
    stubVoices([{ name: 'Aria', lang: 'en-US' }]);
    const options = listReaderVoices(undefined, 'my-roaming-voice');
    expect(options).toContainEqual({
      value: 'my-roaming-voice',
      label: 'my-roaming-voice — configured',
    });
  });

  it('deduplicates a selection that already matches an OS voice', () => {
    stubVoices([{ name: 'Aria', lang: 'en-US' }]);
    const options = listReaderVoices(undefined, 'Aria');
    expect(options.filter((o) => o.value === 'Aria')).toHaveLength(1);
  });
});
