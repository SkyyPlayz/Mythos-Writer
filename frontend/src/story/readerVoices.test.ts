// Beta 3 M13 / Beta 4 M11 — reader voice-picker enumeration tests.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isCatalogReaderVoice,
  listReaderVoices,
  readerVoiceSetupHint,
  resolveReaderVoiceId,
} from './readerVoices';

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
  it('degrades to Default + self-explaining catalog when speechSynthesis is missing', () => {
    const options = listReaderVoices();
    expect(options[0]).toEqual({ value: '', label: 'Default voice' });
    // Catalog entries survive so the picker is never empty — each explains itself.
    expect(options.map((o) => o.value)).toEqual([
      '',
      'edge:aria',
      'edge:guy',
      'edge:jenny',
      'piper:amy',
      'piper:ryan',
      'kokoro:nicole',
      'kokoro:sky',
    ]);
    for (const o of options.slice(1)) expect(o.setupHint).toBeTruthy();
  });

  it('lists English OS voices first (prototype en filter)', () => {
    stubVoices([
      { name: 'Aria', lang: 'en-US' },
      { name: 'Hans', lang: 'de-DE' },
      { name: 'Sonia', lang: 'en-GB' },
    ]);
    const options = listReaderVoices();
    expect(options.map((o) => o.value).slice(0, 3)).toEqual(['', 'Aria', 'Sonia']);
    expect(options[1].label).toBe('Aria — system');
    expect(options[1].setupHint).toBeUndefined();
  });

  it('falls back to all OS voices when none are English', () => {
    stubVoices([
      { name: 'Hans', lang: 'de-DE' },
      { name: 'Yuki', lang: 'ja-JP' },
    ]);
    const values = listReaderVoices().map((o) => o.value);
    expect(values.slice(0, 3)).toEqual(['', 'Hans', 'Yuki']);
  });

  it('detects Windows Edge naturals, labels them, and ranks them first', () => {
    stubVoices([
      { name: 'Zira', lang: 'en-US' },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
    ]);
    const options = listReaderVoices();
    expect(options[1]).toEqual({
      value: 'Microsoft Aria Online (Natural) - English (United States)',
      label: 'Aria — Edge natural',
    });
    expect(options[2].label).toBe('Zira — system');
    // Real naturals exist → no mocked Edge catalog entries.
    expect(options.some((o) => o.value.startsWith('edge:'))).toBe(false);
  });

  it('offers Edge catalog entries with setup hints when the OS has no naturals', () => {
    stubVoices([{ name: 'Zira', lang: 'en-US' }]);
    const options = listReaderVoices();
    const aria = options.find((o) => o.value === 'edge:aria');
    expect(aria?.label).toBe('Aria Natural — Edge');
    expect(aria?.setupHint).toContain('default voice');
  });

  it('always offers Piper/Kokoro catalog entries that explain their setup', () => {
    stubVoices([{ name: 'Aria', lang: 'en-US' }]);
    const options = listReaderVoices();
    const amy = options.find((o) => o.value === 'piper:amy');
    const sky = options.find((o) => o.value === 'kokoro:sky');
    expect(amy?.label).toBe('Amy — Piper (offline)');
    expect(amy?.setupHint).toContain('Settings → Voice');
    expect(sky?.label).toBe('Sky — Kokoro (offline)');
    expect(sky?.setupHint).toContain('Settings → Voice');
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

describe('catalog voice resolution (§1.2 never dead)', () => {
  it('flags edge:/piper:/kokoro: values as catalog picks', () => {
    expect(isCatalogReaderVoice('edge:aria')).toBe(true);
    expect(isCatalogReaderVoice('piper:amy')).toBe(true);
    expect(isCatalogReaderVoice('kokoro:sky')).toBe(true);
    expect(isCatalogReaderVoice('Aria')).toBe(false);
    expect(isCatalogReaderVoice('')).toBe(false);
  });

  it('resolves catalog picks to the engine default and passes real ids through', () => {
    expect(resolveReaderVoiceId('piper:amy')).toBe('');
    expect(resolveReaderVoiceId('edge:jenny')).toBe('');
    expect(resolveReaderVoiceId('Aria')).toBe('Aria');
    expect(resolveReaderVoiceId('')).toBe('');
  });

  it('provides a per-engine explanation for catalog picks only', () => {
    expect(readerVoiceSetupHint('edge:aria')).toContain('Edge natural');
    expect(readerVoiceSetupHint('piper:ryan')).toContain('Piper');
    expect(readerVoiceSetupHint('kokoro:nicole')).toContain('Kokoro');
    expect(readerVoiceSetupHint('Aria')).toBeUndefined();
    expect(readerVoiceSetupHint('')).toBeUndefined();
  });
});
