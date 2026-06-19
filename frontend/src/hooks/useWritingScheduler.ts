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
 *
 * cadenceTrigger:
 *   - 'idle_heartbeat' (default): uses setInterval (constant) or keydown debounce
 *   - 'on_save': fires once per scene:saved IPC event, no interval
 */
export function useWritingScheduler({
  scene,
  enabled,
  scanIntervalSeconds,
  isActive,
  cadenceTrigger = 'idle_heartbeat',
  idleHeartbeatConstantInterval = true,
  idleDebounceSeconds = 30,
}: {
  scene: Scene | null;
  enabled: boolean;
  scanIntervalSeconds: number;
  isActive: boolean;
  cadenceTrigger?: 'on_save' | 'idle_heartbeat';
  idleHeartbeatConstantInterval?: boolean;
  idleDebounceSeconds?: number;
}): { result: ScheduledScanResult | null; scanning: boolean; scanError: string | null; runScan: (useScanNowChannel?: boolean) => Promise<void> } {
  const [result, setResult] = useState<ScheduledScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

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
      setScanError(null);
      setResult({ tips: response.tips, scannedAt: response.scannedAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setScanError(msg || 'Scan failed. Please retry.');
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  // AC-CAD-02: on_save mode — subscribe to scene:saved push event, no setInterval
  useEffect(() => {
    if (!enabled || !isActive) return;
    if (cadenceTrigger !== 'on_save') return;

    const unsub = window.api.onWritingScanResult?.((data) => {
      // scene:saved is proxied through the writing scan result push channel;
      // we treat any push result for the current scene as a save-triggered event.
      const currentScene = sceneRef.current;
      if (currentScene && data.sceneId === currentScene.id) {
        setResult({ tips: data.tips, scannedAt: data.scannedAt });
      }
    });

    // Also listen on the scene:saved synthetic event dispatched by the renderer
    const handleSaved = () => { void runScan(); };
    window.addEventListener('scene:saved', handleSaved);

    return () => {
      unsub?.();
      window.removeEventListener('scene:saved', handleSaved);
    };
  }, [enabled, isActive, cadenceTrigger, runScan]);

  // AC-CAD-04: idle_heartbeat + debounce mode — fire after idleDebounceSeconds of no keypress
  useEffect(() => {
    if (!enabled || !isActive) return;
    if (cadenceTrigger !== 'idle_heartbeat') return;
    if (idleHeartbeatConstantInterval) return;

    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const ms = Math.max(5, idleDebounceSeconds) * 1000;

    const handleKey = () => {
      if (debounceId !== null) clearTimeout(debounceId);
      debounceId = setTimeout(() => { void runScan(); }, ms);
    };

    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      if (debounceId !== null) clearTimeout(debounceId);
    };
  }, [enabled, isActive, cadenceTrigger, idleHeartbeatConstantInterval, idleDebounceSeconds, runScan]);

  // AC-CAD-10: idle_heartbeat + constant interval — existing setInterval path
  useEffect(() => {
    if (!enabled || !isActive) return;
    if (cadenceTrigger !== 'idle_heartbeat') return;
    if (!idleHeartbeatConstantInterval) return;

    const ms = Math.max(5, scanIntervalSeconds) * 1000;
    const id = setInterval(runScan, ms);
    return () => clearInterval(id);
  }, [enabled, isActive, scanIntervalSeconds, runScan, cadenceTrigger, idleHeartbeatConstantInterval]);

  return { result, scanning, scanError, runScan };
}
