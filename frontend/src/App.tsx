import { useState, useRef } from 'react';
import './App.css';

const GENRES = [
  { value: '', label: 'No specific genre' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'sci-fi', label: 'Science Fiction' },
  { value: 'romance', label: 'Romance' },
  { value: 'mystery', label: 'Mystery' },
  { value: 'horror', label: 'Horror' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'thriller', label: 'Thriller' },
  { value: 'literary', label: 'Literary Fiction' },
];

const LENGTHS = [
  { value: 'short', label: 'Short (~500 words)' },
  { value: 'medium', label: 'Medium (~1000 words)' },
  { value: 'long', label: 'Long (~2000 words)' },
];

type UIState = 'idle' | 'streaming' | 'done' | 'error';

function App() {
  const [prompt, setPrompt] = useState('');
  const [genre, setGenre] = useState('');
  const [length, setLength] = useState('medium');
  const [story, setStory] = useState('');
  const [uiState, setUiState] = useState<UIState>('idle');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setUiState('streaming');
    setError('');
    setStory('');

    try {
      const res = await fetch('/api/stories/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          genre: genre || undefined,
          length,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res
          .json()
          .catch(() => ({ error: `Server error: ${res.status}` }));
        throw new Error(
          (errData as { error?: string }).error ?? `Server error: ${res.status}`
        );
      }

      if (!res.body) {
        throw new Error(
          'Streaming story responses are not supported by this browser. Please try again in a modern browser.'
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') {
            setUiState('done');
            return;
          }
          try {
            const parsed = JSON.parse(payload) as {
              chunk?: string;
              error?: string;
            };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.chunk) setStory((prev) => prev + parsed.chunk);
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      setUiState('done');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unknown error');
      setUiState('error');
    }
  };

  const handleCopy = async () => {
    if (!story) return;
    await navigator.clipboard.writeText(story);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartOver = () => {
    abortRef.current?.abort();
    setPrompt('');
    setGenre('');
    setLength('medium');
    setStory('');
    setUiState('idle');
    setError('');
    setCopied(false);
  };

  const isStreaming = uiState === 'streaming';
  const hasStory = story.length > 0;
  const showInput = uiState === 'idle' || uiState === 'error';

  return (
    <div className="app">
      <header>
        <h1>Mythos Writer</h1>
        <p>AI-powered creative writing and story generation</p>
      </header>

      <main>
        {showInput && (
          <section className="input-section">
            <label className="field-label" htmlFor="prompt">
              Story prompt
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your story idea, character, or scene..."
              rows={5}
              maxLength={2000}
            />
            <div className="selectors">
              <div className="selector-group">
                <label htmlFor="genre">Genre</label>
                <select
                  id="genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                >
                  {GENRES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="selector-group">
                <label htmlFor="length">Length</label>
                <select
                  id="length"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                >
                  {LENGTHS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && <p className="error">{error}</p>}

            <button
              className="btn-primary"
              onClick={handleGenerate}
              disabled={!prompt.trim()}
            >
              Generate Story
            </button>
          </section>
        )}

        {(isStreaming || hasStory) && (
          <section className="output-section">
            <div className="output-header">
              <h2>Generated Story</h2>
              <div className="output-actions">
                {hasStory && (
                  <button className="btn-secondary" onClick={handleCopy}>
                    {copied ? 'Copied!' : 'Copy to clipboard'}
                  </button>
                )}
                <button className="btn-secondary" onClick={handleStartOver}>
                  Start over
                </button>
              </div>
            </div>
            <div className={`story-content${isStreaming ? ' streaming' : ''}`}>
              {story}
              {isStreaming && <span className="cursor" aria-hidden="true" />}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
