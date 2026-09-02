// Beta 3 M13 / Beta 4 M11 — reader voice-picker enumeration tests.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isCatalogReaderVoice,
  isReaderVoiceAvailable,
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
    expect(options[0]).toEqual({ value: '', label: 'Default voice', engine: 'default', available: true });
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
    // SKY-11242/11243: Edge & Piper catalog entries are unavailable + carry a
    // hint; Kokoro now ships bundled, so its entries are available (no hint).
    for (const o of options.slice(1)) {
      if (o.value.startsWith('kokoro:')) {
        expect(o.available).toBe(true);
        expect(o.setupHint).toBeUndefined();
      } else {
        expect(o.available).toBe(false);
        expect(o.setupHint).toBeTruthy();
      }
    }
  });

  it('lists English OS voices first (prototype en filter), marked available', () => {
    stubVoices([
      { name: 'Aria', lang: 'en-US' },
      { name: 'Hans', lang: 'de-DE' },
      { name: 'Sonia', lang: 'en-GB' },
    ]);
    const options = listReaderVoices();
    expect(options.map((o) => o.value).slice(0, 3)).toEqual(['', 'Aria', 'Sonia']);
    expect(options[1]).toEqual({
      value: 'Aria',
      label: 'Aria — system',
      engine: 'system',
      available: true,
    });
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

  it('detects Windows Edge naturals, labels them available, and ranks them first', () => {
    stubVoices([
      { name: 'Zira', lang: 'en-US' },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
    ]);
    const options = listReaderVoices();
    expect(options[1]).toEqual({
      value: 'Microsoft Aria Online (Natural) - English (United States)',
      label: 'Aria — Edge natural',
      engine: 'edge',
      available: true,
    });
    expect(options[2].label).toBe('Zira — system');
    // Real naturals exist → no mocked Edge catalog entries.
    expect(options.some((o) => o.value.startsWith('edge:'))).toBe(false);
  });

  it('offers Edge catalog entries as unavailable, with setup hints, when the OS has no naturals', () => {
    stubVoices([{ name: 'Zira', lang: 'en-US' }]);
    const options = listReaderVoices();
    const aria = options.find((o) => o.value === 'edge:aria');
    expect(aria?.label).toBe('Aria Natural — Edge');
    expect(aria?.engine).toBe('edge');
    expect(aria?.available).toBe(false);
    expect(aria?.setupHint).toContain('Windows');
  });

  it('offers Piper catalog entries as unavailable that explain their setup', () => {
    stubVoices([{ name: 'Aria', lang: 'en-US' }]);
    const options = listReaderVoices();
    const amy = options.find((o) => o.value === 'piper:amy');
    expect(amy).toMatchObject({ label: 'Amy — Piper (offline)', engine: 'piper', available: false });
    expect(amy?.setupHint).toContain('Settings → Voice');
  });

  it('offers bundled Kokoro catalog entries as available and playable (SKY-11243)', () => {
    stubVoices([{ name: 'Aria', lang: 'en-US' }]);
    const options = listReaderVoices();
    const nicole = options.find((o) => o.value === 'kokoro:nicole');
    const sky = options.find((o) => o.value === 'kokoro:sky');
    expect(nicole).toMatchObject({ label: 'Nicole — Kokoro (offline)', engine: 'kokoro', available: true });
    expect(nicole?.setupHint).toBeUndefined();
    expect(sky).toMatchObject({ label: 'Sky — Kokoro (offline)', engine: 'kokoro', available: true });
    expect(sky?.setupHint).toBeUndefined();
    // Resolves through to the engine (not stripped to default like an unwired pick).
    expect(resolveReaderVoiceId('kokoro:sky')).toBe('kokoro:sky');
  });

  it('appends the configured Piper engine voice as an available Piper entry', () => {
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
      engine: 'piper',
      available: true,
    });
  });

  it('labels a cloud engine voice as an available cloud entry', () => {
    const options = listReaderVoices({
      enabled: true,
      provider: 'cloud',
      cloudApiKey: 'k',
      voiceId: 'alloy',
    });
    expect(options).toContainEqual({
      value: 'alloy',
      label: 'alloy — cloud',
      engine: 'cloud',
      available: true,
    });
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
      engine: 'system',
      available: true,
    });
  });

  it('surfaces a roamed catalog selection as an unavailable entry with its hint', () => {
    stubVoices([{ name: 'Aria', lang: 'en-US' }]);
    // A stored piper: pref roams in from a machine where Piper was set up.
    const options = listReaderVoices(undefined, 'piper:custom');
    const roamed = options.find((o) => o.value === 'piper:custom');
    expect(roamed?.engine).toBe('piper');
    expect(roamed?.available).toBe(false);
    expect(roamed?.setupHint).toContain('Piper');
  });

  it('deduplicates a selection that already matches an OS voice', () => {
    stubVoices([{ name: 'Aria', lang: 'en-US' }]);
    const options = listReaderVoices(undefined, 'Aria');
    expect(options.filter((o) => o.value === 'Aria')).toHaveLength(1);
  });

  it('tags every option with an engine so the picker can group them', () => {
    stubVoices([{ name: 'Aria', lang: 'en-US' }]);
    const engines = new Set(listReaderVoices().map((o) => o.engine));
    // default + system + the always-present piper/kokoro catalog + edge catalog.
    expect(engines).toEqual(new Set(['default', 'system', 'edge', 'piper', 'kokoro']));
  });
});

describe('catalog voice resolution (SKY-11242 — no silent wrong-voice playback)', () => {
  it('flags edge:/piper:/kokoro: values as catalog picks', () => {
    expect(isCatalogReaderVoice('edge:aria')).toBe(true);
    expect(isCatalogReaderVoice('piper:amy')).toBe(true);
    expect(isCatalogReaderVoice('kokoro:sky')).toBe(true);
    expect(isCatalogReaderVoice('Aria')).toBe(false);
    expect(isCatalogReaderVoice('')).toBe(false);
  });

  it('marks unwired catalog voices unavailable; bundled Kokoro + everything else available', () => {
    expect(isReaderVoiceAvailable('edge:aria')).toBe(false);
    expect(isReaderVoiceAvailable('piper:amy')).toBe(false);
    // SKY-11243: Kokoro ships bundled and is playable.
    expect(isReaderVoiceAvailable('kokoro:sky')).toBe(true);
    expect(isReaderVoiceAvailable('kokoro:nicole')).toBe(true);
    expect(isReaderVoiceAvailable('Aria')).toBe(true);
    expect(isReaderVoiceAvailable('en_US/vctk_low')).toBe(true);
    expect(isReaderVoiceAvailable('')).toBe(true);
  });

  it('resolves unavailable catalog picks to the engine default and passes real ids through', () => {
    // Safety net for a roamed/stored pref; the picker itself refuses to switch here.
    expect(resolveReaderVoiceId('piper:amy')).toBe('');
    expect(resolveReaderVoiceId('edge:jenny')).toBe('');
    expect(resolveReaderVoiceId('Aria')).toBe('Aria');
    expect(resolveReaderVoiceId('')).toBe('');
  });

  it('provides a per-engine explanation for catalog picks only', () => {
    expect(readerVoiceSetupHint('edge:aria')).toContain('Edge');
    expect(readerVoiceSetupHint('piper:ryan')).toContain('Piper');
    expect(readerVoiceSetupHint('kokoro:nicole')).toContain('Kokoro');
    expect(readerVoiceSetupHint('Aria')).toBeUndefined();
    expect(readerVoiceSetupHint('')).toBeUndefined();
  });
});
