import { useState, useCallback } from 'react';
import type { Scene } from './types';

interface Props {
  scene: Scene | null;
}

export default function BrainstormerPanel({ scene }: Props) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brainstorm = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const context = scene
        ? `Scene: "${scene.title}"\n\n${scene.blocks.map((b) => b.content).join('\n\n')}`
        : undefined;
      const response = await window.api.agentBrainstorm(trimmed, context);
      setResult(response.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'AI unavailable — check your API key in settings.');
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, scene]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      brainstorm();
    }
  };

  return (
    <div className="brainstormer-panel">
      <div className="brainstormer-header">
        <p className="brainstormer-hint">
          {scene
            ? <>Brainstorming with context: <em>{scene.title}</em></>
            : 'No scene selected — brainstorming freely.'}
        </p>
      </div>

      <div className="brainstormer-input-area">
        <textarea
          className="brainstormer-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKey}
          placeholder="a fantasy heist set on a sky-ship…"
          rows={4}
          disabled={loading}
          aria-label="Brainstorm prompt"
        />
        <button
          className="brainstormer-btn"
          onClick={brainstorm}
          disabled={!prompt.trim() || loading}
        >
          {loading ? 'Thinking…' : 'Brainstorm'}
        </button>
      </div>

      {error && (
        <div className="brainstormer-error" role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className="brainstormer-output-area">
          <div className="brainstormer-output-label">Ideas</div>
          <textarea
            className="brainstormer-output"
            value={result}
            readOnly
            aria-label="Brainstorm result"
          />
        </div>
      )}

      {!result && !error && !loading && (
        <div className="brainstormer-empty">
          Type an idea above and hit <kbd>Brainstorm</kbd> — Claude will generate suggestions here.
        </div>
      )}
    </div>
  );
}
