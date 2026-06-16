import { useState, useEffect, useRef, useCallback } from 'react';
import type { Scene } from '../types';

export type WritingTipCategory = 'grammar' | 'pacing' | 'clarity' | 'style' | 'tone';

export interface WritingAssistantTip {
  id: string;
  text: string;
  category: WritingTipCategory;
  sceneAnchor?: string;
  sceneId?: string;
  scenePath?: string;
  sceneUpdatedAt?: string;
}

export type WritingAssistantTipInput = string | Partial<WritingAssistantTip> & { text: string };

export interface ScheduledScanResult {
  tips: WritingAssistantTipInput[];
  scannedAt: string;
}

/**
 * Periodically calls the WRITING_SCAN IPC for the active scene.
 *
 * Pauses when `enabled` is false or `isActive` is false (writing page not focused).
 * Restarts the interval immediately when `scanIntervalSeconds` changes.
 */
export function useWritingScheduler({
  scene,
  enabled,
  scanIntervalSeconds,
  isActive,
}: {
  scene: Scene | null;
  enabled: boolean;
  scanIntervalSeconds: number;
  isActive: boolean;
}): { result: ScheduledScanResult | null; scanning: boolean; runScan: (useScanNowChannel?: boolean) => Promise<void> } {
  const [result, setResult] = useState<ScheduledScanResult | null>(null);
  const [scanning, setScanning] = useState(false);

  // Refs so the interval callback always sees the latest scene without restarting the timer.
  const sceneRef = useRef(scene);
  const scanningRef = useRef(false);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  const runScan = useCallback(async (useScanNowChannel = false) => {
    const currentScene = sceneRef.current;
    if (!currentScene || scanningRef.current) return;

    const prose = currentScene.blocks.map((b) => b.content).join('\n\n').trim();
    if (!prose) return;

    scanningRef.current = true;
    setScanning(true);
    try {
      const response = useScanNowChannel
        ? await window.api.writingAssistantScanNow({
          sceneId: currentScene.id,
          prose,
          scenePath: currentScene.path,
        })
        : await window.api.writingScan(currentScene.id, prose, currentScene.path);
      setResult({ tips: response.tips, scannedAt: response.scannedAt });
    } catch {
      // Non-fatal — scheduler continues on next tick.
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !isActive) return;

    const ms = Math.max(5, scanIntervalSeconds) * 1000;
    const id = setInterval(runScan, ms);
    return () => clearInterval(id);
  }, [enabled, isActive, scanIntervalSeconds, runScan]);

  return { result, scanning, runScan };
}
