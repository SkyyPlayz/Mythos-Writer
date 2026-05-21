import { useState } from 'react';
import './App.css';

function App() {
  const [prompt, setPrompt] = useState('');
  const [story, setStory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    setStory('');

    try {
      const res = await fetch('/api/story/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      const data = (await res.json()) as { story: string };
      setStory(data.story);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Mythos Writer</h1>
        <p>AI-powered creative writing and story generation</p>
      </header>

      <main>
        <section className="input-section">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your story idea, character, or scene..."
            rows={5}
          />
          <button onClick={handleGenerate} disabled={loading || !prompt.trim()}>
            {loading ? 'Generating...' : 'Generate Story'}
          </button>
        </section>

        {error && <p className="error">{error}</p>}

        {story && (
          <section className="output-section">
            <h2>Generated Story</h2>
            <div className="story-content">{story}</div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
