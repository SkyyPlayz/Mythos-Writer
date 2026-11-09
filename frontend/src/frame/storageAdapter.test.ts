import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  settingsGet as readSettings,
  settingsGetIfPresent,
  settingsGetOrNull,
  settingsSet as writeSettings,
  settingsSetIfPresent,
} from './storageAdapter';

const adapterSrc = readFileSync(resolve(__dirname, 'storageAdapter.ts'), 'utf8');

function installApi(overrides: Partial<Window['api']> = {}): {
  settingsGet: ReturnType<typeof vi.fn>;
  settingsSet: ReturnType<typeof vi.fn>;
} {
  const settingsGet = vi.fn();
  const settingsSet = vi.fn();
  window.api = { settingsGet, settingsSet, ...overrides } as unknown as Window['api'];
  return { settingsGet, settingsSet };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'api');
});

describe('storageAdapter', () => {
  it('forwards settingsGet and settingsSet unchanged and adds no key', async () => {
    const payload = {
      apiKey: '',
      theme: 'dark',
      activeLayout: { tabShell: { activeTab: 'story' } },
      rightSidebarVisible: true,
      rightSidebarWidth: 300,
      rightSidebarPanels: [{ id: 'writing-assistant', collapsed: false }],
    } as unknown as AppSettings;
    const { settingsGet, settingsSet } = installApi();
    settingsGet.mockResolvedValue(payload);
    settingsSet.mockResolvedValue({ saved: true });
    const tokens = { sttBinaryToken: 'once' };

    await expect(readSettings()).resolves.toBe(payload);
    expect(settingsGet).toHaveBeenCalledTimes(1);
    expect(settingsGet).toHaveBeenCalledWith();

    await expect(writeSettings(payload)).resolves.toEqual({ saved: true });
    expect(settingsSet).toHaveBeenCalledTimes(1);
    expect(settingsSet).toHaveBeenCalledWith(payload);
    expect(settingsSet.mock.calls[0]).toHaveLength(1);

    await writeSettings(payload, tokens);
    expect(settingsSet).toHaveBeenLastCalledWith(payload, tokens);
    const sent = settingsSet.mock.calls[0][0] as AppSettings;
    expect(sent).toBe(payload);
    expect(sent).not.toHaveProperty('layoutV3');
    expect(Object.keys(sent)).not.toContain('layoutV3');
  });

  it('preserves the optional and null-fallback call shapes', async () => {
    const payload = { apiKey: '' } as AppSettings;
    const { settingsGet, settingsSet } = installApi();
    settingsGet.mockResolvedValue(payload);
    settingsSet.mockResolvedValue({ saved: true });

    await expect(settingsGetIfPresent()).resolves.toBe(payload);
    await expect(settingsGetOrNull()).resolves.toBe(payload);
    await expect(settingsSetIfPresent(payload)).resolves.toEqual({ saved: true });
    expect(settingsSet).toHaveBeenCalledWith(payload);

    settingsGet.mockRejectedValue(new Error('disk'));
    await expect(settingsGetOrNull()).resolves.toBeNull();

    window.api = { settingsSet } as unknown as Window['api'];
    await expect(settingsGetOrNull()).resolves.toBeNull();

    Reflect.deleteProperty(window, 'api');
    expect(settingsGetIfPresent()).toBeUndefined();
    expect(settingsSetIfPresent(payload)).toBeUndefined();
  });

  it('does not name a new settings key or a 0.5.9 flag', () => {
    expect(adapterSrc).not.toMatch(/layoutV3|widgetShell|artifactsEngine|localEngine/);
    expect(adapterSrc).toContain('window.api.settingsGet()');
    expect(adapterSrc).toContain('window.api.settingsSet(settings)');
    expect(adapterSrc).toContain('window.api.settingsSet(settings, tokens)');
    expect(adapterSrc).toContain('window.api?.settingsGet?.()');
    expect(adapterSrc).toContain('window.api.settingsGet?.()');
    expect(adapterSrc).toContain('window.api?.settingsSet?.(settings)');
  });

  it('is the only settingsGet/settingsSet path in DesktopShell', () => {
    const shell = readFileSync(resolve(__dirname, '../DesktopShell.tsx'), 'utf8');
    expect(shell).not.toMatch(/window\.api\??\.settings(?:Get|Set)/);
    expect(shell).toContain('settingsGetOrNull()');
    expect(shell).toContain('settingsGet()');
    expect(shell).toContain('settingsGetIfPresent()');
    expect(shell).toContain('settingsSet(');
    expect(shell).toContain('settingsSetIfPresent(');
    expect(shell).toContain('settingsSetIfPresent(next)?.catch(() => {})');
    expect(shell).not.toMatch(/layoutV3|widgetShell|artifactsEngine|localEngine/);
  });
});
