import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Scene } from './types';
import { useLiveAnnounce } from './hooks/useLiveAnnounce';
import { useWritingScheduler } from './hooks/useWritingScheduler';
import { useTtsPlayer } from './hooks/useTtsPlayer';
import PresetSelector from './components/PresetSelector';
import PresetEditor from './components/PresetEditor';
import PresetBrowser from './components/PresetBrowser';
import RefinementChips from './components/RefinementChips';
import QualityRubric from './components/QualityRubric';
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

interface WritingAssistantSuggestion {
  id: string;
  source_agent: 'writing-assistant';
  text: string;
  confidence: number;
  rationale: string;
  timestamp: string;
  status: 'proposed' | 'accepted' | 'rejected';
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
  isActive?: boolean;
  isPageFocused?: boolean;
  onJumpToText?: (text: string) => void;
}

export default function WritingAssistantPanel({
  scene,
  enabled = true,
  scanIntervalSeconds = 60,
  isActive = true,
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

  const { result: scheduledResult } = useWritingScheduler({
    scene,
    enabled,
    scanIntervalSeconds,
    isActive,
  });

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

  const ask = useCallback(async (overridePrompt?: string) => {
    const trimmed = (overridePrompt ?? prompt).trim();
    if (!trimmed || loading) return;

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    lastPromptRef.current = trimmed;

    setLoading(true);
    setStalled(false);
    setError(null);
    setActiveRefinementId(null);
    if (!overridePrompt) setPrompt('');
    announce('Generating response…');

    const userMsg: Message = { role: 'user', text: trimmed };
    const assistantMsg: Message = { role: 'assistant', text: '', streaming: true };

    setMessages((prev) => {
      const base = overridePrompt ? removePendingAssistantBubble(prev) : prev;
      return [...base, userMsg, assistantMsg];
    });

    const styleGuide = buildPresetContext(effectiveAxes);
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
  }, [announce, clearStreamResources, effectiveAxes, loading, prompt, scene, scheduleStallTimers]);

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
    setPresetOverrides(newOverrides);
    saveSessionPreset(presetId, newOverrides);
    setActiveRefinementId(chip.id);
    const lastUserMsg = lastPromptRef.current;
    if (lastUserMsg) {
      ask(lastUserMsg);
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
    setMessages((prev) =>
      prev.map((m) =>
        m.suggestion?.id === id
          ? { ...m, suggestion: { ...m.suggestion, status } }
          : m,
      ),
    );
  };

  if (!enabled) {
    return (
      <div className="writing-assistant-panel writing-assistant-disabled">
        <p className="writing-assistant-disabled-msg">Writing Assistant is disabled. Enable it in Settings.</p>
      </div>
    );
  }

  return (
    <div className="writing-assistant-panel">
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveText}
      </span>

      <div className="writing-assistant-header">
        <p className="writing-assistant-hint">
          {scene
            ? <><strong>Writing Assistant</strong> — context: <em>{scene.title}</em></>
            : <><strong>Writing Assistant</strong> — no scene selected, asking freely.</>}
        </p>
        {/* AC-V-06: session mute toggle */}
        <button
          className={`wa-mute-btn${tts.sessionMuted ? ' wa-mute-btn--muted' : ''}`}
          onClick={() => tts.toggleMute(announce)}
          aria-label={tts.sessionMuted ? 'Unmute voice playback' : 'Mute voice playback'}
          aria-pressed={tts.sessionMuted}
        >
          {tts.sessionMuted ? 'Unmute' : 'Mute'}
        </button>
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

      {scheduledResult && scheduledResult.tips.length > 0 && (
        <div className="wa-scheduled-tips" aria-label="Writing tips">
          <p className="wa-tips-heading">Writing tips</p>
          <ul className="wa-tips-list">
            {scheduledResult.tips.map((tip, i) => (
              <li key={i} className="wa-tip-item">{tip}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="writing-assistant-messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`wa-message wa-message-${msg.role}`}
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
                {!msg.streaming && msg.suggestion && msg.suggestion.status === 'proposed' && (
                  <>
                    <div className="wa-suggestion-actions">
                      <button
                        className="wa-btn wa-btn-accept"
                        onClick={() => applySuggestionStatus(msg.suggestion!.id, 'accepted')}
                        aria-label="Accept suggestion"
                      >
                        Accept
                      </button>
                      <button
                        className="wa-btn wa-btn-reject"
                        onClick={() => applySuggestionStatus(msg.suggestion!.id, 'rejected')}
                        aria-label="Reject suggestion"
                      >
                        Dismiss
                      </button>
                      {/* AC-V-07: per-card TTS button; one card plays at a time */}
                      {(() => {
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
                    </div>
                    <RefinementChips
                      effectiveAxes={effectiveAxes}
                      onRefine={handleRefine}
                      disabled={loading}
                      activeChipId={activeRefinementId}
                    />
                  </>
                )}
                {!msg.streaming && msg.suggestion && msg.suggestion.status !== 'proposed' && (
                  <div className={`wa-suggestion-status wa-status-${msg.suggestion.status}`}>
                    {msg.suggestion.status === 'accepted' ? 'Accepted' : 'Dismissed'}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

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
      </div>

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
  );
}
