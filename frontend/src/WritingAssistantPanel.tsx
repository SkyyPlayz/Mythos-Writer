import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { SuggestionCard } from './SuggestionCard';
import type { Scene } from './types';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import { useWritingScheduler } from './hooks/useWritingScheduler';
import type { WritingAssistantTip, WritingAssistantTipInput, WritingTipCategory } from './hooks/useWritingScheduler';
import { TipCard } from './TipCard';
import { useTtsPlayer } from './hooks/useTtsPlayer';
import PresetSelector from './components/PresetSelector';
import PresetEditor from './components/PresetEditor';
import PresetBrowser from './components/PresetBrowser';
import RefinementChips from './components/RefinementChips';
import QualityRubric from './components/QualityRubric';
import BetaReadPanel from './components/BetaReadPanel';
import {
  getEffectiveAxes,
  buildPresetContext,
  loadSessionPreset,
  saveSessionPreset,
  DEFAULT_PRESET_ID,
} from './presets';
import type { PresetAxes, RefinementChip } from './presets';

export const STALL_WARNING_MS = 20_000;
export const HARD_TIMEOUT_MS = 90_000;

type WaVoiceState = 'idle' | 'listening' | 'processing' | 'error';

const WA_MIC_ARIA_LABELS: Record<WaVoiceState, string> = {
  idle: 'Start voice input',
  listening: 'Stop voice input',
  processing: 'Processing speech…',
  error: 'Voice error — click to retry',
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface WritingAssistantSuggestion {
  id: string;
  source_agent: 'writing-assistant';
  text: string;
  confidence: number;
  rationale: string;
  timestamp: string;
  status: 'proposed' | 'accepted' | 'rejected';
  decidedAt?: string;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  suggestion?: WritingAssistantSuggestion;
}

interface Props {
  scene: Scene | null;
  enabled?: boolean;
  scanIntervalSeconds?: number;
  waScanInterval?: number | 'on-save' | 'manual';
  isActive?: boolean;
  isPageFocused?: boolean;
  onJumpToText?: (text: string) => void;
  /** AC-WA-25: show STT microphone button in input area only when true. Off by default. */
  voiceEnabled?: boolean;
  cadenceTrigger?: 'on_save' | 'idle_heartbeat';
  idleHeartbeatConstantInterval?: boolean;
  idleDebounceSeconds?: number;
}

function isBetaReadRequest(prompt: string) {
  return /\b(beta[-\s]?read|beta reader|deep review)\b/i.test(prompt);
}

function getSceneProse(scene: Scene) {
  return scene.blocks.map((block) => block.content).join('\n\n');
}

const CADENCE_OPTIONS = [
  { value: '30', label: '30 s' },
  { value: '60', label: '1 min' },
  { value: '300', label: '5 min' },
  { value: 'on-save', label: 'On save' },
  { value: 'manual', label: 'Manual only' },
] as const;

type CadenceValue = typeof CADENCE_OPTIONS[number]['value'];

function toCadenceValue(interval: number | 'on-save' | 'manual'): CadenceValue {
  if (interval === 'on-save' || interval === 'manual') return interval;
  return interval === 30 || interval === 300 ? String(interval) as CadenceValue : '60';
}

function isTipCategory(value: unknown): value is WritingTipCategory {
  return value === 'grammar' || value === 'pacing' || value === 'clarity' || value === 'style' || value === 'tone';
}

function normalizeTip(input: WritingAssistantTipInput, index: number, scene: Scene | null): WritingAssistantTip {
  if (typeof input === 'string') {
    return {
      id: `scan-tip-${index}-${input}`,
      text: input,
      category: 'clarity',
      sceneAnchor: scene?.title,
      sceneId: scene?.id,
      scenePath: scene?.path,
      sceneUpdatedAt: scene?.updatedAt,
    };
  }

  return {
    id: input.id ?? `scan-tip-${index}-${input.text}`,
    text: input.text,
    category: isTipCategory(input.category) ? input.category : 'clarity',
    sceneAnchor: input.sceneAnchor ?? scene?.title,
    sceneId: input.sceneId ?? scene?.id,
    scenePath: input.scenePath ?? scene?.path,
    sceneUpdatedAt: input.sceneUpdatedAt ?? scene?.updatedAt,
  };
}

function tipSuppressKey(tip: WritingAssistantTip, scene: Scene | null) {
  return `${tip.id}:${tip.sceneUpdatedAt ?? scene?.updatedAt ?? 'unknown-scene-version'}`;
}

export default function WritingAssistantPanel({
  scene,
  enabled = true,
  scanIntervalSeconds = 60,
  waScanInterval,
  isActive = true,
  onJumpToText,
  voiceEnabled = false,
  cadenceTrigger,
  idleHeartbeatConstantInterval,
  idleDebounceSeconds,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRubric, setShowRubric] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [activeRefinementId, setActiveRefinementId] = useState<string | null>(null);
  const [betaReadComments, setBetaReadComments] = useState<BetaReadComment[]>([]);
  const [betaReadLoading, setBetaReadLoading] = useState(false);
  const [betaReadError, setBetaReadError] = useState<string | null>(null);
  const [betaReadLastScannedAt, setBetaReadLastScannedAt] = useState<string | null>(null);
  const [cadence, setCadence] = useState<CadenceValue>(() => toCadenceValue(waScanInterval ?? scanIntervalSeconds));
  const [cadenceTouched, setCadenceTouched] = useState(false);
  const [suppressedTipKeys, setSuppressedTipKeys] = useState<Set<string>>(() => new Set());
  const [reportConfirmTipId, setReportConfirmTipId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const panelRootRef = useRef<HTMLDivElement>(null);

  // Preset state — persisted per session via sessionStorage
  const [presetId, setPresetId] = useState<string>(() => loadSessionPreset().presetId);
  const [presetOverrides, setPresetOverrides] = useState<Partial<PresetAxes>>(
    () => loadSessionPreset().overrides,
  );

  const effectiveAxes = useMemo(
    () => getEffectiveAxes(presetId, presetOverrides),
    [presetId, presetOverrides],
  );

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const lastPromptRef = useRef('');
  const { announce, liveText } = useLiveAnnounce();

  const tts = useTtsPlayer();

  const initialScanIntervalSeconds = typeof waScanInterval === 'number' ? waScanInterval : scanIntervalSeconds;
  const effectiveScanIntervalSeconds = !cadenceTouched || cadence === 'on-save' || cadence === 'manual'
    ? initialScanIntervalSeconds
    : Number(cadence);
  const schedulerEnabled = enabled && cadence !== 'manual' && cadence !== 'on-save';

  const { result: scheduledResult, scanning, scanError: scheduledScanError, runScan } = useWritingScheduler({
    scene,
    enabled: schedulerEnabled,
    scanIntervalSeconds: effectiveScanIntervalSeconds,
    isActive,
    cadenceTrigger,
    idleHeartbeatConstantInterval,
    idleDebounceSeconds,
  });

  useEffect(() => {
    window.api.writingAssistantSetActiveScene?.({
      sceneId: scene?.id ?? null,
      scenePath: scene?.path ?? null,
    })?.catch(() => {
      // Backend support may land separately; failing to record the active scene
      // should not break the panel UI.
    });
  }, [scene?.id, scene?.path]);

  const visibleTips = useMemo(() => {
    const normalized = scheduledResult?.tips.map((tip, index) => normalizeTip(tip, index, scene)) ?? [];
    return normalized.filter((tip) => !suppressedTipKeys.has(tipSuppressKey(tip, scene)));
  }, [scheduledResult, scene, suppressedTipKeys]);

  const clearStreamResources = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (hardTimerRef.current) {
      clearTimeout(hardTimerRef.current);
      hardTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearStreamResources();
    };
  }, [clearStreamResources]);

  // Collapse when panel root width < 280px (AC-WA-20)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const el = panelRootRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.offsetWidth;
      setCollapsed(width < 280);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Escape key closes overlay (AC-WA-22)
  useEffect(() => {
    if (!overlayOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlayOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [overlayOpen]);

  const removePendingAssistantBubble = (prev: Message[]) => {
    const updated = [...prev];
    const last = updated[updated.length - 1];
    if (last?.role === 'assistant' && last.streaming) {
      updated.pop();
    }
    return updated;
  };

  const scheduleStallTimers = useCallback((requestId: number) => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    if (hardTimerRef.current) clearTimeout(hardTimerRef.current);

    stallTimerRef.current = setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      setStalled(true);
      announce('Generation is taking longer than expected. You can retry or cancel.');
    }, STALL_WARNING_MS);

    hardTimerRef.current = setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      requestIdRef.current += 1;
      clearStreamResources();
      setMessages((prev) => removePendingAssistantBubble(prev));
      setLoading(false);
      setStalled(false);
      const timeoutMessage = 'Generation timed out. The network or provider may be slow — please retry.';
      setError(timeoutMessage);
      announce(timeoutMessage);
    }, HARD_TIMEOUT_MS);
  }, [announce, clearStreamResources]);

  const runBetaReadScan = useCallback(async () => {
    if (!scene) {
      const msg = 'Select a scene before starting Beta-Read mode.';
      setBetaReadError(msg);
      announce(msg);
      return;
    }

    const prose = getSceneProse(scene);
    if (!prose.trim()) {
      const msg = 'This scene is empty — add prose before starting Beta-Read mode.';
      setBetaReadError(msg);
      announce(msg);
      return;
    }

    setBetaReadLoading(true);
    setBetaReadError(null);
    setError(null);
    try {
      const result = await window.api.betaReadScan(scene.id, prose, scene.path);
      setBetaReadComments(result.comments);
      setBetaReadLastScannedAt(result.scannedAt);
      announce(`Beta-Read complete with ${result.comments.length} ${result.comments.length === 1 ? 'comment' : 'comments'}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorMsg = msg || 'Beta-Read unavailable — check your provider settings.';
      setBetaReadError(errorMsg);
      announce(`Error: ${errorMsg}`);
    } finally {
      setBetaReadLoading(false);
    }
  }, [announce, scene]);

  const dismissBetaReadComment = useCallback(async (id: string) => {
    setBetaReadComments((prev) => prev.filter((comment) => comment.id !== id));
    try {
      await window.api.betaReadDismiss(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorMsg = msg || 'Could not dismiss Beta-Read comment.';
      setBetaReadError(errorMsg);
      announce(`Error: ${errorMsg}`);
    }
  }, [announce]);

  const cancelGeneration = useCallback(() => {
    if (!loading) return;
    requestIdRef.current += 1;
    clearStreamResources();
    setMessages((prev) => removePendingAssistantBubble(prev));
    setLoading(false);
    setStalled(false);
    const msg = 'Generation cancelled. You can retry now.';
    setError(msg);
    announce(msg);
  }, [announce, clearStreamResources, loading]);

  const ask = useCallback(async (overridePrompt?: string, overrideAxes?: PresetAxes) => {
    const trimmed = (overridePrompt ?? prompt).trim();
    if (!trimmed || loading) return;

    if (isBetaReadRequest(trimmed)) {
      lastPromptRef.current = trimmed;
      if (!overridePrompt) setPrompt('');
      await runBetaReadScan();
      return;
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    lastPromptRef.current = trimmed;

    setLoading(true);
    setStalled(false);
    setError(null);
    // Don't clear the active refinement chip for refinement re-asks — keep it highlighted during streaming
    if (!overridePrompt) setActiveRefinementId(null);
    if (!overridePrompt) setPrompt('');
    announce('Generating response…');

    const userMsg: Message = { role: 'user', text: trimmed };
    const assistantMsg: Message = { role: 'assistant', text: '', streaming: true };

    setMessages((prev) => {
      const base = overridePrompt ? removePendingAssistantBubble(prev) : prev;
      return [...base, userMsg, assistantMsg];
    });

    const styleGuide = buildPresetContext(overrideAxes ?? effectiveAxes);
    const sceneText = scene
      ? `Scene: "${scene.title}"\n\n${scene.blocks.map((b) => b.content).join('\n\n')}`
      : undefined;
    const context = [styleGuide, sceneText].filter(Boolean).join('\n\n') || undefined;

    // Subscribe to streaming chunks before invoking
    clearStreamResources();
    unsubscribeRef.current = window.api.onWritingAssistantChunk((chunk) => {
      if (requestIdRef.current !== requestId) return;
      // Reset stall timers on each received token
      setStalled(false);
      scheduleStallTimers(requestId);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          updated[updated.length - 1] = { ...last, text: last.text + chunk };
        }
        return updated;
      });
    });
    scheduleStallTimers(requestId);

    try {
      const response = await window.api.agentWritingAssistant(trimmed, context);
      if (requestIdRef.current !== requestId) return;

      const suggestion: WritingAssistantSuggestion = {
        id: `wa-${Date.now()}`,
        source_agent: 'writing-assistant',
        text: response.text,
        confidence: 0.85,
        rationale: 'User-requested writing advice',
        timestamp: new Date().toISOString(),
        status: 'proposed',
      };

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, text: response.text, streaming: false, suggestion };
        }
        return updated;
      });
      announce('Response ready.');
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => prev.slice(0, -1)); // remove the empty assistant bubble
      const errorMsg = msg || 'AI unavailable — check your API key in settings.';
      setError(errorMsg);
      announce(`Error: ${errorMsg}`);
    } finally {
      if (requestIdRef.current === requestId) {
        clearStreamResources();
        setLoading(false);
        setStalled(false);
      }
    }
  }, [announce, clearStreamResources, effectiveAxes, loading, prompt, runBetaReadScan, scene, scheduleStallTimers]);

  const retryGeneration = useCallback(() => {
    const retryPrompt = lastPromptRef.current;
    if (!retryPrompt) return;
    requestIdRef.current += 1;
    clearStreamResources();
    setStalled(false);
    setLoading(false);
    ask(retryPrompt);
  }, [ask, clearStreamResources]);

  const handleRefine = useCallback((chip: RefinementChip) => {
    const adjusted = chip.adjustAxes(effectiveAxes);
    const newOverrides = { ...presetOverrides, ...adjusted };
    const newAxes = getEffectiveAxes(presetId, newOverrides);
    setPresetOverrides(newOverrides);
    saveSessionPreset(presetId, newOverrides);
    setActiveRefinementId(chip.id);
    const lastUserMsg = lastPromptRef.current;
    if (lastUserMsg) {
      // Pass freshly computed axes directly — state update is async so ask's
      // closure would otherwise see the stale effectiveAxes value
      ask(lastUserMsg, newAxes);
    }
  }, [ask, effectiveAxes, presetId, presetOverrides]);

  const handlePresetSelect = useCallback((id: string) => {
    setPresetId(id);
    setPresetOverrides({});
    saveSessionPreset(id, {});
  }, []);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  const applySuggestionStatus = (id: string, status: 'accepted' | 'rejected') => {
    const decidedAt = new Date().toISOString();
    setMessages((prev) =>
      prev.map((m) =>
        m.suggestion?.id === id
          ? { ...m, suggestion: { ...m.suggestion, status, decidedAt } }
          : m,
      ),
    );
  };

  const handleCadenceChange = useCallback(async (value: CadenceValue) => {
    setCadence(value);
    setCadenceTouched(true);
    const waScanInterval = value === 'on-save' || value === 'manual' ? value : Number(value);
    try {
      await window.api.writingAssistantCadenceChange({ waScanInterval });
      announce('Writing Assistant cadence updated.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Could not update Writing Assistant cadence.');
    }
  }, [announce]);

  const handleScanNow = useCallback(async () => {
    setError(null);
    await runScan(true);
  }, [runScan]);

  const applyTipDecision = useCallback(async (
    tipId: string,
    decision: 'noted' | 'ignored' | 'reported',
  ) => {
    const tip = visibleTips.find((item) => item.id === tipId);
    if (!tip) return;
    if (decision === 'ignored' || decision === 'noted') {
      const key = tipSuppressKey(tip, scene);
      setSuppressedTipKeys((prev) => new Set(prev).add(key));
    }
    if (decision === 'reported') {
      setReportConfirmTipId(null);
    }
    try {
      await window.api.writingAssistantTipDecision({
        tipId,
        decision,
        sceneId: tip.sceneId ?? scene?.id,
        scenePath: tip.scenePath ?? scene?.path,
        sceneUpdatedAt: tip.sceneUpdatedAt ?? scene?.updatedAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Could not save tip decision.');
    }
  }, [scene, visibleTips]);

  const dismissAllTips = useCallback(() => {
    setSuppressedTipKeys((prev) => {
      const next = new Set(prev);
      visibleTips.forEach((tip) => next.add(tipSuppressKey(tip, scene)));
      return next;
    });
  }, [scene, visibleTips]);

  // ── AC-WA-25: STT voice input ──────────────────────────────────────────────
  const [waVoiceState, _setWaVoiceStateRaw] = useState<WaVoiceState>('idle');
  const waVoiceStateRef = useRef<WaVoiceState>('idle');
  const waRecognitionRef = useRef<SpeechRecognition | null>(null);
  const waConfirmedTextRef = useRef('');
  const waSilenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waSilenceStartRef = useRef<number>(0);

  const setWaVoiceState = useCallback((s: WaVoiceState) => {
    waVoiceStateRef.current = s;
    _setWaVoiceStateRaw(s);
  }, []);

  const waClearSilenceTimer = useCallback(() => {
    if (waSilenceTimerRef.current) {
      clearInterval(waSilenceTimerRef.current);
      waSilenceTimerRef.current = null;
    }
  }, []);

  const waCommitTranscript = useCallback(() => {
    const text = waConfirmedTextRef.current.trim();
    if (text) {
      setPrompt((prev) => (prev ? `${prev} ${text}` : text));
      announce(`Transcribed: ${text}`);
    }
    waConfirmedTextRef.current = '';
  }, [announce]);

  const waStopRecognition = useCallback((mode: 'cancel' | 'commit') => {
    waClearSilenceTimer();
    const rec = waRecognitionRef.current;
    waRecognitionRef.current = null;
    if (rec) try { rec.abort(); } catch { /* non-fatal */ }
    if (mode === 'cancel') waConfirmedTextRef.current = '';
  }, [waClearSilenceTimer]);

  const startWaVoice = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      window.api.sttStart?.();
      setWaVoiceState('listening');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new Ctor() as any;
    waRecognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => {
      setWaVoiceState('listening');
      waSilenceStartRef.current = Date.now();
      waSilenceTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - waSilenceStartRef.current) / 1000;
        if (elapsed >= 3) {
          waClearSilenceTimer();
          const r = waRecognitionRef.current;
          waRecognitionRef.current = null;
          if (r) try { r.abort(); } catch { /* non-fatal */ }
          setWaVoiceState('processing');
          setTimeout(() => {
            waCommitTranscript();
            setWaVoiceState('idle');
          }, 400);
        }
      }, 100);
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      waSilenceStartRef.current = Date.now();
      let confirmed = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) confirmed += r[0]?.transcript ?? '';
      }
      if (confirmed) waConfirmedTextRef.current += confirmed;
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      waClearSilenceTimer();
      waRecognitionRef.current = null;
      setWaVoiceState('error');
      announce(`Voice error: ${event.error}`);
    };

    rec.onend = () => {
      if (waVoiceStateRef.current === 'listening') {
        waClearSilenceTimer();
        waRecognitionRef.current = null;
        setWaVoiceState('idle');
      }
    };

    try { rec.start(); } catch { setWaVoiceState('error'); }
  }, [announce, waClearSilenceTimer, waCommitTranscript, setWaVoiceState]);

  const cancelWaVoice = useCallback(() => {
    waStopRecognition('cancel');
    window.api.sttStop?.();
    setWaVoiceState('idle');
    announce('Voice input cancelled.');
  }, [announce, waStopRecognition, setWaVoiceState]);

  const handleWaMicToggle = useCallback(() => {
    const state = waVoiceStateRef.current;
    if (state === 'idle') startWaVoice();
    else if (state === 'listening') cancelWaVoice();
    else if (state === 'error') setWaVoiceState('idle');
    // processing: ignore clicks
  }, [startWaVoice, cancelWaVoice, setWaVoiceState]);

  useEffect(() => {
    return () => {
      waClearSilenceTimer();
      const rec = waRecognitionRef.current;
      if (rec) try { rec.abort(); } catch { /* non-fatal */ }
      waRecognitionRef.current = null;
    };
  }, [waClearSilenceTimer]);
  // ──────────────────────────────────────────────────────────────────────────

  const messagesRef = useRef<HTMLDivElement>(null);

  if (!enabled) {
    return (
      <div className="writing-assistant-panel writing-assistant-disabled">
        <p className="writing-assistant-disabled-msg">Writing Assistant is disabled. Enable it in Settings.</p>
      </div>
    );
  }

  const handleMessagesKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const container = messagesRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.wa-suggestion-card'));
    if (cards.length === 0) return;
    const focused = document.activeElement as HTMLElement;
    const idx = cards.indexOf(focused);
    if (idx === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? cards[idx + 1] : cards[idx - 1];
    next?.focus();
  };

  const pendingCount = visibleTips.length;

  if (collapsed && !overlayOpen) {
    return (
      <div className="wa-panel-root" ref={panelRootRef}>
        <div className="wa-icon-bar">
          <button
            type="button"
            className="wa-collapsed-btn"
            onClick={() => setOverlayOpen(true)}
            aria-label={`Open Writing Assistant${pendingCount > 0 ? `, ${pendingCount} pending suggestions` : ''}`}
          >
            <span aria-hidden="true">✨</span>
            {pendingCount > 0 && (
              <span className="wa-collapsed-badge" aria-hidden="true">{pendingCount}</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wa-panel-root" ref={panelRootRef}>
      {overlayOpen && (
        <div
          className="wa-overlay-backdrop"
          onClick={() => setOverlayOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className={`writing-assistant-panel${overlayOpen ? ' writing-assistant-panel--overlay' : ''}`} role="complementary" aria-label="Writing Assistant">
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveText}
      </span>

      {/* AC-WA-1/2/3: Liquid Neon panel header */}
      <div className="wa-panel-header">
        <span className="wa-header-left">
          <span className="wa-sparkle-icon" aria-hidden="true">✦</span>
          <span className="wa-header-title">
            Writing Assistant
            {scene && <span className="wa-header-context"> — context: <em>{scene.title}</em></span>}
          </span>
        </span>
        <span className="wa-header-controls" onClick={(e) => e.stopPropagation()}>
          <label className="wa-cadence-label">
            <span className="wa-cadence-text">Cadence</span>
            <span className="wa-cadence-icon" aria-hidden="true">⏱</span>
            <select
              className="wa-cadence-select"
              aria-label="Heartbeat cadence"
              value={cadence}
              onChange={(event) => void handleCadenceChange(event.target.value as CadenceValue)}
            >
              {CADENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {/* AC-V-06: session mute toggle */}
          <button
            className={`wa-mute-btn${tts.sessionMuted ? ' wa-mute-btn--muted' : ''}`}
            onClick={() => tts.toggleMute(announce)}
            aria-label={tts.sessionMuted ? 'Unmute voice playback' : 'Mute voice playback'}
            aria-pressed={tts.sessionMuted}
          >
            {tts.sessionMuted ? 'Unmute' : 'Mute'}
          </button>
        </span>
      </div>

      {/* AC-WA-16/17/18/19: Dedicated heartbeat status bar */}
      <div
        className={`wa-status-bar${scanning ? ' wa-status-bar--scanning' : scheduledScanError ? ' wa-status-bar--error' : ' wa-status-bar--idle'}`}
        aria-label="Heartbeat status"
        aria-live="polite"
      >
        {scanning ? (
          <>
            <span className="wa-status-dot wa-status-dot--scanning" aria-hidden="true" />
            <span className="wa-spinner wa-spinner--sm" aria-hidden="true" />
            <span className="wa-status-text">Scanning…</span>
          </>
        ) : scheduledScanError ? (
          <>
            <span className="wa-status-icon" aria-hidden="true">⚠</span>
            <span className="wa-status-text wa-status-text--error">{scheduledScanError}</span>
          </>
        ) : (
          <>
            <span className="wa-status-icon wa-status-icon--idle" aria-hidden="true">✓</span>
            <span className="wa-status-text wa-status-text--idle">
              {scheduledResult?.scannedAt
                ? `Idle — last scan ${new Date(scheduledResult.scannedAt).toLocaleTimeString()}`
                : 'Idle'}
            </span>
          </>
        )}
      </div>

      <div className="wa-preset-row">
        <PresetSelector
          activePresetId={presetId}
          onSelect={handlePresetSelect}
          onCustomize={() => setShowEditor(true)}
          onBrowse={() => setShowBrowser(true)}
        />
        <button
          className="wa-rubric-help-btn"
          onClick={() => setShowRubric(true)}
          aria-label="Open quality rubric"
          type="button"
          title="Quality standards for AI generations"
        >
          ?
        </button>
      </div>

      <div className="wa-heartbeat-tips" aria-label="Heartbeat panel">
        <div className="wa-heartbeat-header">
          <span className="wa-heartbeat-title">Heartbeat tips</span>
          <button
            type="button"
            className="wa-scan-now"
            onClick={() => void handleScanNow()}
            disabled={!scene || scanning}
            aria-label="Scan now"
          >
            Scan now
          </button>
          {scanning && (
            <span className="wa-heartbeat-scanning">
              <span className="wa-spinner" aria-hidden="true" /> Scanning
            </span>
          )}
          {scheduledResult?.scannedAt && (
            <span className="wa-heartbeat-time">Updated {new Date(scheduledResult.scannedAt).toLocaleTimeString()}</span>
          )}
        </div>
        {scheduledScanError && (
          <div className="wa-scan-error" role="alert">
            <span className="wa-scan-error-icon" aria-hidden="true">⚠</span>
            <div className="wa-scan-error-content">
              <p className="wa-scan-error-heading">Scan failed</p>
              <p className="wa-scan-error-desc">{scheduledScanError}</p>
            </div>
            <button
              type="button"
              className="wa-scan-now"
              onClick={() => void handleScanNow()}
              disabled={scanning}
              aria-label="Retry scan"
            >
              Retry
            </button>
          </div>
        )}
        <div className="wa-heartbeat-list" aria-live="polite" aria-label="Writing tips">
          {visibleTips.length === 0 && !scheduledScanError ? (
            scanning ? (
              <p className="wa-heartbeat-empty">Scanning this scene for quick writing tips…</p>
            ) : (
              <div className="wa-empty-state wa-heartbeat-empty" role="note">
                <span className="wa-empty-icon" aria-hidden="true">✨</span>
                <p className="wa-empty-heading">No suggestions yet</p>
                <p className="wa-empty-subtext">Run a scan to get writing feedback</p>
                <button
                  type="button"
                  className="wa-scan-now wa-scan-now--cta"
                  onClick={() => void handleScanNow()}
                  disabled={!scene}
                  aria-label="Start first scan"
                >
                  Scan Now
                </button>
              </div>
            )
          ) : (
            visibleTips.map((tip) => (
              <div key={tipSuppressKey(tip, scene)} className="wa-heartbeat-tip">
                <TipCard
                  tip={tip}
                  onNote={(tipId) => void applyTipDecision(tipId, 'noted')}
                  onIgnore={(tipId) => void applyTipDecision(tipId, 'ignored')}
                  onReport={setReportConfirmTipId}
                />
                {reportConfirmTipId === tip.id && (
                  <div className="tc-report-confirm" role="alert">
                    <span>Report this tip?</span>
                    <button type="button" onClick={() => void applyTipDecision(tip.id, 'reported')}>Report</button>
                    <button type="button" onClick={() => setReportConfirmTipId(null)}>Cancel</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        {visibleTips.length >= 2 && (
          <button type="button" className="tc-dismiss-all" onClick={dismissAllTips}>
            Dismiss all ({visibleTips.length})
          </button>
        )}
      </div>

      <BetaReadPanel
        scene={scene}
        comments={betaReadComments}
        loading={betaReadLoading}
        error={betaReadError}
        lastScannedAt={betaReadLastScannedAt}
        onRunScan={runBetaReadScan}
        onDismiss={dismissBetaReadComment}
        onJumpToText={onJumpToText}
      />

      <div
        className="writing-assistant-messages"
        role="list"
        ref={messagesRef}
        onKeyDown={handleMessagesKeyDown}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`wa-message wa-message-${msg.role}`}
            role="listitem"
          >
            {msg.role === 'user' ? (
              <div className="wa-user-bubble">{msg.text}</div>
            ) : (
              <div className="wa-assistant-bubble">
                <div
                  className={`wa-assistant-text${msg.streaming ? ' wa-streaming' : ''}`}
                  aria-label="Writing assistant response"
                >
                  {msg.text}
                  {msg.streaming && <span className="wa-cursor" aria-hidden="true">&#x258c;</span>}
                </div>
                {!msg.streaming && msg.suggestion && (
                  <>
                    <SuggestionCard
                      suggestion={msg.suggestion}
                      onApply={(id) => applySuggestionStatus(id, 'accepted')}
                      onReject={(id) => applySuggestionStatus(id, 'rejected')}
                    />
                    {/* AC-V-07: per-card TTS button; one card plays at a time */}
                    {msg.suggestion.status === 'proposed' && (() => {
                      const sid = msg.suggestion!.id;
                      const isPlaying = tts.playingCardId === sid;
                      return (
                        <button
                          className={`wa-hear-btn${isPlaying ? ' wa-hear-btn--playing' : ''}`}
                          onClick={() => {
                            if (isPlaying) {
                              tts.cancelCurrent(announce);
                            } else {
                              tts.speakCard(msg.text, sid, announce);
                            }
                          }}
                          aria-label={isPlaying ? 'Stop voice playback' : 'Hear suggestion aloud'}
                          aria-pressed={isPlaying}
                        >
                          {isPlaying ? '■ Stop' : '▶ Hear'}
                        </button>
                      );
                    })()}
                    {msg.suggestion.status === 'proposed' && (
                      <RefinementChips
                        effectiveAxes={effectiveAxes}
                        onRefine={handleRefine}
                        disabled={loading}
                        activeChipId={activeRefinementId}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}

      </div>

      {messages.length === 0 && !error && presetId === DEFAULT_PRESET_ID && (
        <div className="writing-assistant-empty wa-first-visit-tip" role="note" aria-label="Genre preset tip">
          <span className="wa-tip-icon" aria-hidden="true">💡</span>
          <span className="wa-tip-body">
            <strong>Tip:</strong> Choose a genre preset to shape how suggestions sound.{' '}
            E.g., &ldquo;Epic Fantasy&rdquo; favors morally complex scenarios.{' '}
          </span>
          <button
            className="wa-tip-browse-btn"
            onClick={() => setShowBrowser(true)}
            type="button"
          >
            Show Presets
          </button>
        </div>
      )}
      {messages.length === 0 && !error && presetId !== DEFAULT_PRESET_ID && (
        <div className="writing-assistant-empty">
          Ask for writing advice — pacing, voice, clarity, what to try next.
        </div>
      )}

      {stalled && loading && (
        <div className="wa-stall-panel" role="status" aria-label="Generation stalled">
          <p className="wa-stall-message">
            This is taking longer than expected. The network or AI provider may be slow.
          </p>
          <div className="wa-stall-actions">
            <button
              className="wa-btn wa-btn-retry"
              onClick={retryGeneration}
              aria-label="Retry generation"
            >
              Retry
            </button>
            <button
              className="wa-btn wa-btn-cancel"
              onClick={cancelGeneration}
              aria-label="Cancel generation"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="writing-assistant-error" role="alert">
          {error}
        </div>
      )}

      <div className="writing-assistant-input-area">
        <textarea
          className="writing-assistant-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKey}
          placeholder="How can I make this scene more tense?"
          rows={3}
          disabled={loading}
          aria-label="Writing assistant prompt"
        />
        <div className="wa-input-actions">
          {/* AC-WA-25: microphone button — only shown when voice is enabled in Settings */}
          {voiceEnabled && (
            <button
              type="button"
              className={`wa-mic-btn wa-mic-btn--${waVoiceState}`}
              onClick={handleWaMicToggle}
              aria-label={WA_MIC_ARIA_LABELS[waVoiceState]}
              aria-pressed={waVoiceState !== 'idle'}
              disabled={waVoiceState === 'processing'}
            >
              🎤
            </button>
          )}
          {loading ? (
            <button
              className="writing-assistant-btn wa-btn-cancel-inline"
              onClick={cancelGeneration}
              aria-label="Cancel generation"
            >
              Cancel
            </button>
          ) : (
            <button
              className="writing-assistant-btn"
              onClick={() => ask()}
              disabled={!prompt.trim()}
              aria-label="Ask"
            >
              Ask
            </button>
          )}
        </div>
      </div>

      {showEditor && (
        <PresetEditor
          activePresetId={presetId}
          overrides={presetOverrides}
          onApply={(overrides) => {
            setPresetOverrides(overrides);
            saveSessionPreset(presetId, overrides);
          }}
          onClose={() => setShowEditor(false)}
        />
      )}

      {showBrowser && (
        <PresetBrowser
          activePresetId={presetId}
          onApply={handlePresetSelect}
          onClose={() => setShowBrowser(false)}
        />
      )}

      {showRubric && <QualityRubric onClose={() => setShowRubric(false)} />}
      </div>
    </div>
  );
}
