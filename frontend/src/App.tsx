import { useState, useRef } from 'react';
import './App.css';

declare global {
  interface Window {
    mythosIPC: {
      generateStory: (payload: { prompt: string; genre?: string; length?: string }) => Promise<unknown>;
      abortStory: () => Promise<unknown>;
      getStoryStatus: () => Promise<unknown>;
      readVaultFile: (path: string) => Promise<unknown>;
      writeVaultFile: (path: string, content: string) => Promise<unknown>;
      listVaultFiles: (root?: string) => Promise<unknown>;
      deleteVaultFile: (path: string) => Promise<unknown>;
      readManifest: () => Promise<unknown>;
      writeManifest: (manifest: unknown) => Promise<unknown>;
      getAppInfo: () => Promise<unknown>;
      getSystemInfo: () => Promise<unknown>;
    };
  }
}

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
      const result = await window.mythosIPC.generateStory({
        prompt: prompt.trim(),
        genre: genre || undefined,
        length,
      });

      // Handle streaming response from IPC
      if (result && typeof result === 'object') {
        // The IPC handler returns an AsyncGenerator — iterate through chunks
        for await (const chunk of result as AsyncGenerator<{ chunk?: string; done?: boolean; error?: string }>) {
          if (controller.signal.aborted) break;
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.chunk) setStory((prev) => prev + chunk.chunk);
          if (chunk.done) {
            setUiState('done');
            return;
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
    window.mythosIPC.abortStory();
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
