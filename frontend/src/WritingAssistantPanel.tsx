import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAgentActivity } from './agents/agentActivity';
import './WritingAssistantPanel.css';
import { PanelHeader } from './components/ui/PanelChrome';
import type { Scene } from './types';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import { useWritingScheduler } from './hooks/useWritingScheduler';
import type { WritingAssistantTip, WritingAssistantTipInput, WritingTipCategory } from './hooks/useWritingScheduler';
import { TipCard } from './TipCard';
import { useTtsPlayer, type TtsEngineSettings } from './hooks/useTtsPlayer';
import PresetSelector from './components/PresetSelector';
import PresetEditor from './components/PresetEditor';
import PresetBrowser from './components/PresetBrowser';
import QualityRubric from './components/QualityRubric';
import {
  loadSessionPreset,
  saveSessionPreset,
} from './presets';
import type { PresetAxes } from './presets';
import { useAiEnabled } from './hooks/useAiEnabled';

/** Retained for e2e / MiniAgentChat parity callers that still import from this module. */
export const STALL_WARNING_MS = 20_000;
export const HARD_TIMEOUT_MS = 90_000;

const SUGGESTION_CATEGORY_ORDER: SuggestionCategory[] = [
  'punctuation', 'spelling', 'grammar', 'sentence-structure', 'style-tone', 'other',
];

const SUGGESTION_CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  punctuation: 'Punctuation',
  spelling: 'Spelling',
  grammar: 'Grammar',
  'sentence-structure': 'Sentence structure',
  'style-tone': 'Style / tone',
  other: 'Other',
};

function isCategoryEnabled(
  cats: Partial<Record<SuggestionCategory, boolean>> | undefined,
  cat: SuggestionCategory,
): boolean {
  if (!cats) return true;
  return cats[cat] !== false;
}

interface Props {
  scene: Scene | null;
  enabled?: boolean;
  scanIntervalSeconds?: number;
  waScanInterval?: number | 'on-save' | 'manual';
  isActive?: boolean;
  isPageFocused?: boolean;
  /** @deprecated Composer removed (N4-A); retained so callers compile until cleaned. */
  voiceEnabled?: boolean;
  /** G2: TTS engine config. When absent or unconfigured, OS speechSynthesis is used as default. */
  ttsSettings?: TtsEngineSettings;
  /** Part G: user voice prefs (volume/rate/voiceId/persistentMute + mic/language). */
  voicePrefs?: import('./hooks/useTtsPlayer').TtsVoicePrefs & { micDeviceId?: string; inputLanguage?: string };
  cadenceTrigger?: 'on_save' | 'idle_heartbeat';
  idleHeartbeatConstantInterval?: boolean;
  idleDebounceSeconds?: number;
  autoApply?: boolean;
  autoApplyCategories?: Partial<Record<SuggestionCategory, boolean>>;
  // dead-wiring-ignore: optional parent sync; AgentHub no longer hosts WA chat (F3 unified agent).
  onAutoApplyCategoriesChange?: (categories: Partial<Record<SuggestionCategory, boolean>>) => void;
  /** Beta 3 M22: renameable agent display name (settings.agentNames.writingAssistant). */
  displayName?: string;
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
  ttsSettings,
  voicePrefs,
  cadenceTrigger,
  idleHeartbeatConstantInterval,
  idleDebounceSeconds,
  autoApply = false,
  autoApplyCategories,
  onAutoApplyCategoriesChange,
  displayName = 'Writing Coach',
}: Props) {
  const aiMasterOn = useAiEnabled();
  const [showRubric, setShowRubric] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
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

  const { announce, liveText } = useLiveAnnounce();
  const tts = useTtsPlayer(ttsSettings, voicePrefs);

  const initialScanIntervalSeconds = typeof waScanInterval === 'number' ? waScanInterval : scanIntervalSeconds;
  const effectiveScanIntervalSeconds = !cadenceTouched || cadence === 'on-save' || cadence === 'manual'
    ? initialScanIntervalSeconds
    : Number(cadence);
  const effectiveCadenceTrigger = cadence === 'on-save' ? 'on_save' : cadenceTrigger;
  const schedulerEnabled = enabled && aiMasterOn && cadence !== 'manual';

  const { result: scheduledResult, scanning, scanError: scheduledScanError, runScan } = useWritingScheduler({
    scene,
    enabled: schedulerEnabled,
    scanIntervalSeconds: effectiveScanIntervalSeconds,
    isActive: isActive && aiMasterOn,
    cadenceTrigger: effectiveCadenceTrigger,
    idleHeartbeatConstantInterval,
    idleDebounceSeconds,
  });

  // Beta 3 M22: writing scans light the workspace tab strip's agents chip.
  useAgentActivity(scanning);

  useEffect(() => {
    window.api.writingAssistantSetActiveScene?.({
      sceneId: scene?.id ?? null,
      scenePath: scene?.path ?? null,
    })?.catch(() => {
      // Backend support may land separately; failing to record the active scene
      // should not break the panel UI.
    });
  }, [scene?.id, scene?.path]);

  // When the user selects 'on-save' cadence, the interval scheduler is disabled.
  // Register the scene:saved listener directly so saves still trigger scans.
  useEffect(() => {
    if (cadence !== 'on-save') return;
    const handleSaved = () => { void runScan(); };
    window.addEventListener('scene:saved', handleSaved);
    return () => window.removeEventListener('scene:saved', handleSaved);
  }, [cadence, runScan]);

  const visibleTips = useMemo(() => {
    const normalized = scheduledResult?.tips.map((tip, index) => normalizeTip(tip, index, scene)) ?? [];
    return normalized.filter((tip) => !suppressedTipKeys.has(tipSuppressKey(tip, scene)));
  }, [scheduledResult, scene, suppressedTipKeys]);

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

  const handlePresetSelect = useCallback((id: string) => {
    setPresetId(id);
    setPresetOverrides({});
    saveSessionPreset(id, {});
  }, []);

  const handleCadenceChange = useCallback(async (value: CadenceValue) => {
    setCadence(value);
    setCadenceTouched(true);
    const nextInterval = value === 'on-save' || value === 'manual' ? value : Number(value);
    try {
      await window.api.writingAssistantCadenceChange({ waScanInterval: nextInterval });
      announce('Writing Coach cadence updated.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      announce(msg || 'Could not update Writing Coach cadence.');
    }
  }, [announce]);

  const handleScanNow = useCallback(async () => {
    if (!scene) return;
    await runScan(true);
  }, [runScan, scene]);

  const handleCategoryToggle = useCallback((category: SuggestionCategory) => {
    const existing = autoApplyCategories ?? {};
    const seeded: Partial<Record<SuggestionCategory, boolean>> = {
      punctuation: existing.punctuation !== false,
      spelling: existing.spelling !== false,
      grammar: existing.grammar !== false,
      'sentence-structure': existing['sentence-structure'] !== false,
      'style-tone': existing['style-tone'] !== false,
      other: existing.other !== false,
    };
    seeded[category] = !isCategoryEnabled(existing, category);
    onAutoApplyCategoriesChange?.(seeded);
  }, [autoApplyCategories, onAutoApplyCategoriesChange]);

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
      announce(msg || 'Could not save tip decision.');
    }
  }, [announce, scene, visibleTips]);

  const dismissAllTips = useCallback(() => {
    setSuppressedTipKeys((prev) => {
      const next = new Set(prev);
      visibleTips.forEach((tip) => next.add(tipSuppressKey(tip, scene)));
      return next;
    });
  }, [scene, visibleTips]);

  if (!enabled) {
    return (
      <div className="writing-assistant-panel writing-assistant-disabled">
        <p className="writing-assistant-disabled-msg">Writing Coach is disabled. Enable it in Settings.</p>
      </div>
    );
  }

  const pendingCount = visibleTips.length;

  if (collapsed && !overlayOpen) {
    return (
      <div className="wa-panel-root" ref={panelRootRef}>
        <div className="wa-icon-bar">
          <button
            type="button"
            className="wa-collapsed-btn"
            onClick={() => setOverlayOpen(true)}
            aria-label={`Open Writing Coach${pendingCount > 0 ? `, ${pendingCount} pending suggestions` : ''}`}
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

  if (!aiMasterOn || !enabled) {
    return (
      <div className="wa-panel wa-panel--ai-off" data-testid="wa-panel-ai-off" role="status">
        <p className="wa-panel-ai-off-copy">Writing Coach is off while All AI features is disabled.</p>
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
      <div className={`writing-assistant-panel${overlayOpen ? ' writing-assistant-panel--overlay' : ''}`} role="complementary" aria-label="Writing Coach">
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveText}
      </span>

      {/* AC-WA-1/2/3: Liquid Neon panel header */}
      <PanelHeader
        className="wa-panel-header"
        icon={<span className="wa-sparkle-icon" aria-hidden="true">✦</span>}
        title={
          <>
            {displayName}
            {scene && <span className="wa-header-context"> — context: <em>{scene.title}</em></span>}
          </>
        }
        actions={
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
        }
      />

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

      {autoApply && (
        <div
          className="wa-auto-apply-section"
          role="group"
          aria-label="Auto-apply categories"
          data-testid="wa-auto-apply-categories"
        >
          <span className="wa-auto-apply-label">Auto-apply:</span>
          {SUGGESTION_CATEGORY_ORDER.map((cat) => {
            const on = isCategoryEnabled(autoApplyCategories, cat);
            return (
              <button
                key={cat}
                type="button"
                className={`wa-cat-pill${on ? ' wa-cat-pill--on' : ''}`}
                aria-pressed={on}
                aria-label={`Auto-apply ${SUGGESTION_CATEGORY_LABELS[cat]}`}
                onClick={() => handleCategoryToggle(cat)}
              >
                {SUGGESTION_CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </div>
      )}

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
            data-testid="wa-scan-now"
            onClick={() => void handleScanNow()}
            disabled={!scene || scanning}
            aria-label="Scan now"
          >
            Scan now
          </button>
          {scanning && (
            <span className="wa-heartbeat-scanning">
              <span className="wa-inline-spinner" aria-hidden="true" /> Scanning
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
              disabled={!scene || scanning}
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
            ) : !scene ? (
              <div className="wa-empty-state wa-heartbeat-empty" role="note">
                <span className="wa-empty-icon" aria-hidden="true">✨</span>
                <p className="wa-empty-heading">Open a scene to scan</p>
                <p className="wa-empty-subtext">Heartbeat tips need an active scene.</p>
              </div>
            ) : (
              <div className="wa-empty-state wa-heartbeat-empty" role="note">
                <span className="wa-empty-icon" aria-hidden="true">✨</span>
                <p className="wa-empty-heading">{scheduledResult ? 'No heartbeat tips — no suggestions yet' : 'No suggestions yet'}</p>
                <p className="wa-empty-subtext">
                  {scheduledResult ? 'This scene has no heartbeat tips right now.' : 'Run a scan to get writing feedback'}
                </p>
                <button
                  type="button"
                  className="wa-scan-now-cta wa-scan-now--cta"
                  onClick={() => void handleScanNow()}
                  disabled={!scene}
                  aria-label="Start first scan"
                  data-testid="wa-scan-now-cta"
                >
                  Scan Now
                </button>
              </div>
            )
          ) : (
            visibleTips.map((tip) => {
              const isPlaying = tts.playingCardId === tip.id;
              return (
                <div key={tipSuppressKey(tip, scene)} className="wa-heartbeat-tip">
                  <TipCard
                    tip={tip}
                    onNote={(tipId) => void applyTipDecision(tipId, 'noted')}
                    onIgnore={(tipId) => void applyTipDecision(tipId, 'ignored')}
                    onReport={setReportConfirmTipId}
                  />
                  <button
                    type="button"
                    className={`wa-hear-btn${isPlaying ? ' wa-hear-btn--playing' : ''}`}
                    onClick={() => {
                      if (isPlaying) {
                        tts.cancelCurrent(announce);
                      } else {
                        tts.speakCard(tip.text, tip.id, announce);
                      }
                    }}
                    aria-label={isPlaying ? 'Stop voice playback' : 'Hear suggestion aloud'}
                    aria-pressed={isPlaying}
                  >
                    {isPlaying ? '■ Stop' : '▶ Hear'}
                  </button>
                  {reportConfirmTipId === tip.id && (
                    <div className="tc-report-confirm" role="alert">
                      <span>Report this tip?</span>
                      <button type="button" onClick={() => void applyTipDecision(tip.id, 'reported')}>Report</button>
                      <button type="button" onClick={() => setReportConfirmTipId(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {visibleTips.length >= 2 && (
          <button type="button" className="tc-dismiss-all" onClick={dismissAllTips}>
            Dismiss all ({visibleTips.length})
          </button>
        )}
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
