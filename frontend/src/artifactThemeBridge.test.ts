// S3 theme push: drop unsafe values, fire the leading edge, coalesce the trailing edge.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { artifactsEngine } from './featureFlags';
import {
  createThemeScheduler,
  deliverThemeVars,
  notifyArtifactThemeChange,
  sanitizeThemeValue,
  type ThemeFrame,
} from './artifactThemeBridge';

afterEach(() => {
  vi.useRealTimers();
});

describe('artifact theme bridge (S3)', () => {
  it('drops css breakout, url, and expression values', () => {
    expect(sanitizeThemeValue('red;}body{background:url(javascript:alert(1))}')).toBeNull();
    expect(sanitizeThemeValue('url(https://evil.test/x)')).toBeNull();
    expect(sanitizeThemeValue('expression(alert(1))')).toBeNull();
    expect(sanitizeThemeValue('#112233')).toBe('#112233');
    expect(sanitizeThemeValue('16px')).toBe('16px');
    expect(sanitizeThemeValue('1.25rem')).toBe('1.25rem');
    expect(sanitizeThemeValue('Lora')).toBe('Lora');
  });

  it('sends the leading edge immediately and coalesces the trailing edge at 100ms', () => {
    vi.useFakeTimers();
    const sent: Record<string, string>[] = [];
    const scheduler = createThemeScheduler((vars) => {
      sent.push(vars);
    });
    const started = Date.now();
    scheduler.push({ vars: { '--ink': '#111111' }, typing: false, themeChanged: true });
    expect(Date.now() - started).toBeLessThan(50);
    expect(sent).toEqual([{ '--ink': '#111111' }]);
    scheduler.push({ vars: { '--ink': '#222222' }, typing: false, themeChanged: true });
    scheduler.push({ vars: { '--ink': '#333333' }, typing: false, themeChanged: true });
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(99);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([{ '--ink': '#111111' }, { '--ink': '#333333' }]);
  });

  it('does not push while typing unless the theme changed', () => {
    const sent: Record<string, string>[] = [];
    const scheduler = createThemeScheduler((vars) => {
      sent.push(vars);
    });
    scheduler.push({ vars: { '--ink': '#111111' }, typing: true, themeChanged: false });
    expect(sent).toEqual([]);
    scheduler.push({ vars: { '--ink': '#111111' }, typing: true, themeChanged: true });
    expect(sent).toEqual([{ '--ink': '#111111' }]);
  });

  it('delivers ten frames inside the 50ms budget', () => {
    const frames: ThemeFrame[] = Array.from({ length: 10 }, () => ({
      contentWindow: { postMessage: vi.fn() },
    }));
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const started = performance.now();
      deliverThemeVars(frames, { '--ink': '#111111' });
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
    expect(p95).toBeLessThanOrEqual(50);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    for (const frame of frames) {
      expect(frame.contentWindow?.postMessage).toHaveBeenCalled();
    }
  });

  it('does nothing while artifactsEngine is off', () => {
    expect(artifactsEngine).toBe(false);
    const frame = document.createElement('iframe');
    const postMessage = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage } });
    document.body.appendChild(frame);
    document.documentElement.setAttribute('style', '--ink:#112233');
    notifyArtifactThemeChange(true);
    expect(postMessage).not.toHaveBeenCalled();
    frame.remove();
  });
});
