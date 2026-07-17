import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeSceneFile } from './vault.js';
import { readSceneProseTracked } from './exportProse.js';

describe('readSceneProseTracked', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-export-prose-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('missing .md file: returns empty prose, records the scene id, and warns once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = new Set<string>();

    const prose = readSceneProseTracked(tmpDir, { id: 'scene-1', path: 'scenes/scene-1.md' }, missing);

    expect(prose).toBe('');
    expect(missing.has('scene-1')).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('scene-1');
    warnSpy.mockRestore();
  });

  it('present-but-empty .md file: returns empty prose but is NOT recorded as missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeSceneFile(tmpDir, 'scenes/scene-2.md', { id: 'scene-2', title: 'Empty Scene', prose: '' });
    const missing = new Set<string>();

    const prose = readSceneProseTracked(tmpDir, { id: 'scene-2', path: 'scenes/scene-2.md' }, missing);

    expect(prose).toBe('');
    expect(missing.has('scene-2')).toBe(false);
    expect(missing.size).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('present file with prose: returns the prose and is not recorded as missing', () => {
    writeSceneFile(tmpDir, 'scenes/scene-3.md', { id: 'scene-3', title: 'Scene', prose: 'Hello world.' });
    const missing = new Set<string>();

    const prose = readSceneProseTracked(tmpDir, { id: 'scene-3', path: 'scenes/scene-3.md' }, missing);

    expect(prose).toBe('Hello world.');
    expect(missing.size).toBe(0);
  });

  it('warns only once per scene id even if read repeatedly within the same export run', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = new Set<string>();

    readSceneProseTracked(tmpDir, { id: 'scene-4', path: 'scenes/scene-4.md' }, missing);
    readSceneProseTracked(tmpDir, { id: 'scene-4', path: 'scenes/scene-4.md' }, missing);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(missing.size).toBe(1);
    warnSpy.mockRestore();
  });
});
