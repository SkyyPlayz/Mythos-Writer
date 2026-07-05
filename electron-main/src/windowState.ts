import fs from 'fs';
import path from 'path';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WINDOW_STATE_FILE = 'window-state.json';
const APP_SETTINGS_FILE = 'app-settings.json';

/**
 * Beta 3 M3 (Liquid Neon): whether the main window should be created
 * transparent — the user picked the `No background` wallpaper (wp:'none').
 * Read synchronously at window creation because BrowserWindow transparency
 * cannot be toggled after the window exists; changing the setting shows a
 * restart-to-apply affordance in Appearance settings.
 */
export function readTransparentWindowPreference(userDataDir: string): boolean {
  const filePath = path.join(userDataDir, APP_SETTINGS_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (typeof raw !== 'object' || raw === null) return false;
    const liquidNeonV2 = (raw as Record<string, unknown>).liquidNeonV2;
    if (typeof liquidNeonV2 !== 'object' || liquidNeonV2 === null) return false;
    return (liquidNeonV2 as Record<string, unknown>).wp === 'none';
  } catch {
    // File missing or corrupt — default to an opaque window
    return false;
  }
}

export function loadWindowState(userDataDir: string): WindowBounds | null {
  const filePath = path.join(userDataDir, WINDOW_STATE_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (isWindowBounds(raw)) return raw;
  } catch {
    // File missing or corrupt — return null to use defaults
  }
  return null;
}

export function saveWindowState(userDataDir: string, bounds: WindowBounds): void {
  const filePath = path.join(userDataDir, WINDOW_STATE_FILE);
  fs.writeFileSync(filePath, JSON.stringify(bounds, null, 2), 'utf-8');
}

/**
 * Returns true if the window's center point falls within at least one display.
 * Guards against the display-disconnected scenario (external monitor removed).
 */
export function isBoundsOnScreen(bounds: WindowBounds, displays: DisplayRect[]): boolean {
  if (displays.length === 0) return false;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return displays.some(
    (d) =>
      centerX >= d.x &&
      centerX <= d.x + d.width &&
      centerY >= d.y &&
      centerY <= d.y + d.height,
  );
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.width === 'number' &&
    typeof v.height === 'number' &&
    typeof v.isMaximized === 'boolean'
  );
}
