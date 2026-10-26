/**
 * S1a IPC channel snapshot. Records today's channel strings from
 * electron-main/src/ipc.ts (IPC_CHANNELS values) and electron-main/src/preload.ts
 * (ipcRenderer / invokeEnvelope string arguments). Adding, removing, or
 * renaming a channel fails this file's equality check. No channel is added here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(SRC_DIR, '__snapshots__', 'ipcChannels.json');

interface IpcChannelSnapshot {
  ipcChannels: string[];
  preloadChannels: string[];
  onlyInIpc: string[];
  onlyInPreload: string[];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function collectIpcChannelSnapshot(ipcSrc: string, preloadSrc: string): IpcChannelSnapshot {
  const start = ipcSrc.indexOf('export const IPC_CHANNELS = {');
  const end = ipcSrc.indexOf('} as const;', start);
  if (start < 0 || end < 0) {
    throw new Error('IPC_CHANNELS object not found in ipc.ts');
  }
  const ipcChannels = uniqueSorted(
    [...ipcSrc.slice(start, end).matchAll(/:\s*'([^']+)'/g)].map((match) => match[1] ?? ''),
  );
  const preloadChannels = uniqueSorted([
    ...[...preloadSrc.matchAll(/ipcRenderer\.(?:invoke|send|on|once)\(\s*'([^']+)'/g)].map((match) => match[1] ?? ''),
    ...[...preloadSrc.matchAll(/invokeEnvelope\(\s*'([^']+)'/g)].map((match) => match[1] ?? ''),
  ]);
  return {
    ipcChannels,
    preloadChannels,
    onlyInIpc: ipcChannels.filter((channel) => !preloadChannels.includes(channel)),
    onlyInPreload: preloadChannels.filter((channel) => !ipcChannels.includes(channel)),
  };
}

function readLiveSnapshot(): IpcChannelSnapshot {
  const ipcSrc = readFileSync(path.join(SRC_DIR, 'ipc.ts'), 'utf8');
  const preloadSrc = readFileSync(path.join(SRC_DIR, 'preload.ts'), 'utf8');
  return collectIpcChannelSnapshot(ipcSrc, preloadSrc);
}

describe('ipc channel snapshot', () => {
  it('matches the committed ipc.ts and preload.ts channel lists', () => {
    const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as IpcChannelSnapshot;
    expect(readLiveSnapshot()).toEqual(committed);
  });

  it('goes red when a channel is added', () => {
    const live = readLiveSnapshot();
    const ipcSrc = readFileSync(path.join(SRC_DIR, 'ipc.ts'), 'utf8');
    const end = ipcSrc.indexOf('} as const;', ipcSrc.indexOf('export const IPC_CHANNELS = {'));
    const withFake = `${ipcSrc.slice(0, end)}\n  WIDGET_FAKE: 'widget:not-a-real-channel',\n${ipcSrc.slice(end)}`;
    const mutated = collectIpcChannelSnapshot(
      withFake,
      readFileSync(path.join(SRC_DIR, 'preload.ts'), 'utf8'),
    );
    expect(mutated.ipcChannels).toContain('widget:not-a-real-channel');
    expect(mutated).not.toEqual(live);
    expect(mutated.ipcChannels.filter((channel) => !live.ipcChannels.includes(channel))).toEqual([
      'widget:not-a-real-channel',
    ]);
  });
});
