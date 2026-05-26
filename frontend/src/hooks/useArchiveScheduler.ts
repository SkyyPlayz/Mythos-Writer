import { useState, useEffect, useRef, useCallback } from 'react';
import type { Scene } from '../types';

export interface ArchiveScanResult {
  inconsistenciesFound: number;
  wikiLinksFound: number;
  scannedAt: string;
}

/**
 * Periodically calls the ARCHIVE_SCAN IPC for the active scene.
 *
 * Pauses when `enabled` is false or `isActive` is false (Archive panel not visible).
 * Restarts the interval immediately when `continuityCheckIntervalSeconds` changes.
 * Debounces on-save triggers: if a save fires within `SAVE_DEBOUNCE_MS` of the last
 * scan, the duplicate is suppressed.
 */

const SAVE_DEBOUNCE_MS = 5_000;

export function useArchiveScheduler({
  scene,
  enabled,
  continuityCheckIntervalSeconds,
  isActive,
}: {
  scene: Scene | null;
  enabled: boolean;
  continuityCheckIntervalSeconds: number;
  isActive: boolean;
}): { result: ArchiveScanResult | null; scanning: boolean; triggerScan: () => void } {
  const [result, setResult] = useState<ArchiveScanResult | null>(null);
  const [scanning, setScanning] = useState(false);

  const sceneRef = useRef(scene);
  const scanningRef = useRef(false);
  const lastScanAtRef = useRef<number>(0);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  const runScan = useCallback(async () => {
    const currentScene = sceneRef.current;
    if (!currentScene || scanningRef.current) return;

    const prose = currentScene.blocks.map((b) => b.content).join('\n\n').trim();
    if (!prose) return;

    scanningRef.current = true;
    setScanning(true);
    try {
      const response = await window.api.archiveScan(prose, currentScene.path);
      lastScanAtRef.current = Date.now();
      setResult({
        inconsistenciesFound: response.inconsistenciesFound,
        wikiLinksFound: response.wikiLinksFound,
        scannedAt: new Date().toISOString(),
      });
    } catch {
      // Non-fatal — scheduler continues on next tick.
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  // Periodic scheduler — resets when interval or active state changes.
  useEffect(() => {
    if (!enabled || !isActive) return;

    const ms = Math.max(5, continuityCheckIntervalSeconds) * 1000;
    const id = setInterval(runScan, ms);
    return () => clearInterval(id);
  }, [enabled, isActive, continuityCheckIntervalSeconds, runScan]);

  // On-save trigger exposed to callers; debounced to avoid duplicate scans.
  const triggerScan = useCallback(() => {
    const msSinceLast = Date.now() - lastScanAtRef.current;
    if (msSinceLast < SAVE_DEBOUNCE_MS) return;
    if (enabled && isActive) void runScan();
  }, [enabled, isActive, runScan]);

  return { result, scanning, triggerScan };
}
