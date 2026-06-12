import { useState, useEffect, useRef } from 'react';

interface ScenePickerItem {
  id: string;
  title: string;
  storyTitle: string;
  chapterTitle: string;
}

interface ManifestLike {
  stories: Array<{
    title: string;
    chapters: Array<{
      title: string;
      scenes: Array<{ id: string; title: string }>;
    }>;
  }>;
}

export interface ScenePickerProps {
  onSelect: (sceneId: string, sceneTitle: string) => void;
  onClose: () => void;
}

export function ScenePicker({ onSelect, onClose }: ScenePickerProps) {
  const [query, setQuery] = useState('');
  const [scenes, setScenes] = useState<ScenePickerItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const manifest = (await window.api.readManifest()) as ManifestLike;
        const all: ScenePickerItem[] = [];
        for (const story of manifest.stories ?? []) {
          for (const chapter of story.chapters ?? []) {
            for (const scene of chapter.scenes ?? []) {
              all.push({
                id: scene.id,
                title: scene.title,
                storyTitle: story.title,
                chapterTitle: chapter.title,
              });
            }
          }
        }
        setScenes(all);
      } catch { /* non-critical */ }
    })();
  }, []);

  const filtered = query.trim()
    ? scenes.filter(
        (s) =>
          s.title.toLowerCase().includes(query.toLowerCase()) ||
          s.storyTitle.toLowerCase().includes(query.toLowerCase()),
      )
    : scenes;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="idd-entity-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Scene picker"
      onKeyDown={handleKey}
      data-testid="scene-picker"
    >
      <div className="idd-entity-picker">
        <input
          ref={inputRef}
          className="idd-entity-picker-input"
          type="text"
          placeholder="Search scenes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search scenes"
        />
        <ul
          className="idd-entity-picker-list"
          role="listbox"
          aria-label="Scenes"
        >
          {filtered.length === 0 && (
            <li className="idd-entity-picker-empty">No scenes found</li>
          )}
          {filtered.map((s) => (
            <li
              key={s.id}
              className="idd-entity-picker-item scene-picker-item"
              role="option"
              aria-selected={false}
              data-testid={`scene-picker-item-${s.id}`}
              onClick={() => onSelect(s.id, s.title)}
            >
              <span className="idd-entity-picker-name">{s.title}</span>
              <span className="scene-picker-meta">
                {s.storyTitle} / {s.chapterTitle}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
