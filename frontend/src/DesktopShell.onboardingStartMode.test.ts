/**
 * Probe C7 / #33 — DesktopShell must not null onboardingStartMode after vault
 * create, and Skip must persist complete+skip. Source + race pins; RED on revert.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const SRC = resolve(process.cwd(), 'src');
const shellSrc = () => readFileSync(resolve(SRC, 'DesktopShell.tsx'), 'utf-8');

describe('DesktopShell C7 onboardingStartMode (Probe VERIFY FAIL 5374426332)', () => {
  it('create-vault onCreated syncs from settingsGet and does not stale-overwrite mode', () => {
    const src = shellSrc();
    const hook = src.indexOf('useCreateMythosVaultFlow(');
    expect(hook).toBeGreaterThan(-1);
    const onCreated = src.slice(hook, hook + 700);
    expect(onCreated).toContain('settingsGet');
    expect(onCreated).toContain('setAppSettings');
    // Sync-only — must not call settingsSet inside create-vault onCreated.
    expect(onCreated).not.toMatch(/settingsSet\?\.\(/);
    expect(onCreated).not.toMatch(/settingsSet\(/);
  });

  it('#33 Skip persists onboardingComplete + onboardingStartMode skip', () => {
    const src = shellSrc();
    const skipIdx = src.indexOf("onboardingStartMode: 'skip'");
    expect(skipIdx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, skipIdx - 400), skipIdx + 200);
    expect(window).toContain('onboardingComplete: true');
    expect(window).toMatch(/settingsSet/);
    expect(window).toContain('markWelcomeOverlayDismissed');
  });
});

describe('C7 race: disk keeps start mode when shell callback runs after hook', () => {
  let dir: string;
  let settingsPath: string;
  let disk: Record<string, unknown>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mythos-c7-'));
    settingsPath = join(dir, 'app-settings.json');
    disk = { onboardingComplete: false, theme: 'dark' };
    writeFileSync(settingsPath, JSON.stringify(disk, null, 2));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function settingsGet() {
    return Promise.resolve(JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>);
  }

  function settingsSet(next: Record<string, unknown>) {
    disk = { ...next };
    writeFileSync(settingsPath, JSON.stringify(disk, null, 2));
    return Promise.resolve(undefined);
  }

  /** Mirrors fixed DesktopShell onCreated (fresh get; no stale overwrite). */
  async function shellOnCreatedFixed() {
    const fresh = await settingsGet();
    if (fresh?.onboardingComplete === true) {
      return; // sync UI only — no settingsSet
    }
    await settingsSet({ ...fresh, onboardingComplete: true });
  }

  /** Broken tip-3448 pattern: stale prev nulls the mode. */
  async function shellOnCreatedBroken() {
    const prev = { onboardingComplete: false, theme: 'dark', onboardingStartMode: null as string | null };
    if (!prev || prev.onboardingComplete) return;
    const next = { ...prev, onboardingComplete: true };
    await settingsSet(next);
  }

  it('template/blank/import modes survive shell callback (disk, not mocked away)', async () => {
    for (const mode of ['template', 'blank', 'import'] as const) {
      writeFileSync(settingsPath, JSON.stringify({ onboardingComplete: false, theme: 'dark' }, null, 2));
      // Hook write (useCreateMythosVaultFlow :208) — real file.
      await settingsSet({
        ...(await settingsGet()),
        onboardingComplete: true,
        onboardingStartMode: mode,
      });
      await shellOnCreatedFixed();
      const onDisk = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
        onboardingComplete?: boolean;
        onboardingStartMode?: string | null;
      };
      expect(onDisk.onboardingComplete).toBe(true);
      expect(onDisk.onboardingStartMode).toBe(mode);
    }
  });

  it('documents that stale shell overwrite nulls the mode (why the fix exists)', async () => {
    await settingsSet({
      onboardingComplete: true,
      onboardingStartMode: 'template',
      theme: 'dark',
    });
    await shellOnCreatedBroken();
    const onDisk = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      onboardingStartMode?: string | null;
    };
    expect(onDisk.onboardingStartMode).toBeNull();
  });
});
