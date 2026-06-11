import { useState, useEffect, useCallback, useRef } from 'react';
import type { Story, Chapter, Scene, Block, Manifest, DraftState } from './types';
import BlockEditor from './BlockEditor';
import StoryNavigator from './StoryNavigator';
import './WritingApp.css';

function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function blocksToMarkdown(scene: Scene): string {
  const lines: string[] = [
    `---`,
    `id: ${scene.id}`,
    `title: "${scene.title.replace(/"/g, '\\"')}"`,
    `draftState: ${scene.draftState ?? 'in-progress'}`,
    `updatedAt: ${now()}`,
    `---`,
    '',
  ];
  for (const block of [...scene.blocks].sort((a, b) => a.order - b.order)) {
    switch (block.type) {
      case 'heading':
        lines.push(`# ${block.content}`);
        break;
      case 'dialogue':
        lines.push(`> ${block.content}`);
        break;
      case 'action':
        lines.push(`**${block.content}**`);
        break;
      case 'description':
        lines.push(`*${block.content}*`);
        break;
      case 'note':
        lines.push(`<!-- ${block.content} -->`);
        break;
      default:
        lines.push(block.content);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export default function WritingApp() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load manifest on mount
  useEffect(() => {
    (async () => {
      try {
        const m = await window.api.readManifest() as Manifest;
        setManifest(m);
        setStories(m.stories ?? []);
      } catch (e) {
        setError('Failed to load manifest: ' + String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persistManifest = useCallback(async (m: Manifest) => {
    try {
      await window.api.writeManifest(m);
    } catch (e) {
      console.error('Failed to persist manifest:', e);
    }
  }, []);

  const scheduleManifestSave = useCallback((m: Manifest) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistManifest(m), 900);
  }, [persistManifest]);

  const updateManifest = useCallback((updatedStories: Story[]) => {
    setStories(updatedStories);
    if (!manifest) return;
    const updated: Manifest = { ...manifest, stories: updatedStories };
    setManifest(updated);
    scheduleManifestSave(updated);
  }, [manifest, scheduleManifestSave]);

  const persistSceneMarkdown = useCallback(async (scene: Scene) => {
    try {
      await window.api.writeVault(scene.path, blocksToMarkdown(scene));
    } catch (e) {
      console.error('Failed to write scene markdown:', e);
    }
  }, []);

  // Called by BlockEditor when blocks change (already debounced by editor)
  const handleBlocksChange = useCallback((blocks: Block[]) => {
    if (!selectedScene || !selectedChapter || !selectedStory) return;

    const updatedScene: Scene = { ...selectedScene, blocks, updatedAt: now() };
    setSelectedScene(updatedScene);

    const updatedStories = stories.map((story) =>
      story.id !== selectedStory.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== selectedChapter.id ? ch : {
            ...ch,
            scenes: ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
    persistSceneMarkdown(updatedScene);

    // Snapshot save
    const content = blocks.map((b) => b.content).join('\n\n');
    window.api.snapshotSave(selectedScene.id, content).catch(() => {});
  }, [selectedScene, selectedChapter, selectedStory, stories, updateManifest, persistSceneMarkdown]);

  const handleDraftStateChange = useCallback((state: DraftState) => {
    if (!selectedScene || !selectedChapter || !selectedStory) return;
    const updatedScene: Scene = { ...selectedScene, draftState: state, updatedAt: now() };
    setSelectedScene(updatedScene);

    const updatedStories = stories.map((story) =>
      story.id !== selectedStory.id ? story : {
        ...story,
        chapters: story.chapters.map((ch) =>
          ch.id !== selectedChapter.id ? ch : {
            ...ch,
            scenes: ch.scenes.map((sc) => sc.id !== updatedScene.id ? sc : updatedScene),
          }
        ),
      }
    );
    updateManifest(updatedStories);
  }, [selectedScene, selectedChapter, selectedStory, stories, updateManifest]);

  // ─── Create helpers ───

  const createStory = useCallback(() => {
    const title = prompt('Story title:');
    if (!title?.trim()) return;
    const id = generateId();
    const story: Story = {
      id,
      title: title.trim(),
      path: `stories/${id}`,
      chapters: [],
      createdAt: now(),
      updatedAt: now(),
    };
    const updatedStories = [...stories, story];
    updateManifest(updatedStories);
  }, [stories, updateManifest]);

  const createChapter = useCallback(async (storyId: string) => {
    const title = prompt('Chapter title:');
    if (!title?.trim()) return;
    try {
      const chapter = await window.api.chapterCreate({ storyId, title: title.trim() });
      const updatedStories = stories.map((s) =>
        s.id !== storyId ? s : { ...s, chapters: [...s.chapters, chapter] }
      );
      updateManifest(updatedStories);
    } catch (e) {
      console.error('Failed to create chapter:', e);
    }
  }, [stories, updateManifest]);

  const createScene = useCallback(async (storyId: string, chapterId: string) => {
    const title = prompt('Scene title:');
    if (!title?.trim()) return;
    try {
      const scene = await window.api.sceneCreate({ storyId, chapterId, title: title.trim() });
      const updatedStories = stories.map((s) =>
        s.id !== storyId ? s : {
          ...s,
          chapters: s.chapters.map((ch) =>
            ch.id !== chapterId ? ch : { ...ch, scenes: [...ch.scenes, scene] }
          ),
        }
      );
      updateManifest(updatedStories);
    } catch (e) {
      console.error('Failed to create scene:', e);
    }
  }, [stories, updateManifest]);

  const handleSelectScene = (scene: Scene, chapter: Chapter, story: Story) => {
    setSelectedScene(scene);
    setSelectedChapter(chapter);
    setSelectedStory(story);
  };

  if (loading) return <div className="writing-loading" role="status">Loading vault…</div>;
  if (error) return <div className="writing-error" role="alert">{error}</div>;

  return (
    <div className="writing-app">
      <StoryNavigator
        stories={stories}
        selectedSceneId={selectedScene?.id ?? null}
        onSelectScene={handleSelectScene}
        onCreateStory={createStory}
        onCreateChapter={createChapter}
        onCreateScene={createScene}
      />

      <div className="writing-main">
        {selectedScene ? (
          <BlockEditor
            key={selectedScene.id}
            scene={selectedScene}
            onBlocksChange={handleBlocksChange}
            onDraftStateChange={handleDraftStateChange}
          />
        ) : (
          <div className="writing-empty">
            <p>Select a scene to start writing, or create a new story.</p>
          </div>
        )}
      </div>
    </div>
  );
}
