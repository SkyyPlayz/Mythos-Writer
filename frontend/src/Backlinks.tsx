// M16 (Beta 3 Liquid Neon): backlinks panel for the notes right sidebar.
// Prototype: right-panel Backlinks card (HTML 2441–2455) — count badge, rows
// with snippet, and a gold STORY chip on backlinks that come from manuscript
// scenes. Notes-vault backlinks come from the SKY-203 `noteBacklinks` IPC;
// story-side backlinks are computed client-side from the in-memory scene
// blocks so a [[link]] typed a moment ago shows up immediately.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Chapter, Scene, Story } from './types';
import { basenameNoExt, normalize, wikiLinkTargetStem } from './crossTabLinkResolver';
import './Backlinks.css';

export interface StoryBacklink {
  scene: Scene;
  chapter: Chapter;
  story: Story;
  snippet: string;
}

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

function snippetAround(text: string, index: number, matchLen: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLen + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

/**
 * Scan the loaded stories' scene blocks for [[links]] whose stem matches the
 * given note (by title stem or file stem). Exported for unit tests.
 */
export function findStoryBacklinks(stories: Story[], notePath: string): StoryBacklink[] {
  const stem = basenameNoExt(notePath);
  if (!stem) return [];
  const results: StoryBacklink[] = [];
  for (const story of stories) {
    for (const chapter of story.chapters) {
      for (const scene of chapter.scenes) {
        let found: string | null = null;
        for (const block of scene.blocks) {
          const content = block.content ?? '';
          WIKI_LINK_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = WIKI_LINK_RE.exec(content)) !== null) {
            const linkStem = normalize(wikiLinkTargetStem(m[1]));
            if (linkStem === stem) {
              found = snippetAround(content, m.index, m[0].length);
              break;
            }
          }
          if (found) break;
        }
        if (found) results.push({ scene, chapter, story, snippet: found });
      }
    }
  }
  return results;
}

interface NoteBacklinkEntry {
  path: string;
  name: string;
  snippet: string;
}

interface Props {
  /** Notes-Vault-relative path of the active note. */
  notePath: string;
  stories: Story[];
  onOpenNote: (path: string) => void;
  onOpenScene: (scene: Scene, chapter: Chapter, story: Story) => void;
}

export default function Backlinks({ notePath, stories, onOpenNote, onOpenScene }: Props) {
  const [noteLinks, setNoteLinks] = useState<NoteBacklinkEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await window.api.noteBacklinks(notePath);
      setNoteLinks(res.backlinks ?? []);
    } catch {
      setNoteLinks([]);
    } finally {
      setLoading(false);
    }
  }, [notePath]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Live list: rescan whenever any vault file changes (autosaves included).
  // Debounced 500 ms trailing (audit P4) — noteBacklinks is a full-vault scan,
  // and autosaves fire vault:file-changed about once per second while typing.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.api.onVaultFileChanged?.(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void load();
      }, 500);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off?.();
    };
  }, [load]);

  const storyLinks = useMemo(() => findStoryBacklinks(stories, notePath), [stories, notePath]);
  const total = noteLinks.length + storyLinks.length;

  return (
    <section className="bl-card" aria-label="Backlinks" data-testid="note-backlinks-panel">
      <div className="bl-head">
        <span className="bl-title">Backlinks</span>
        <span className="bl-count" data-testid="note-backlinks-count">{total}</span>
      </div>
      {loading && noteLinks.length === 0 ? (
        <div className="bl-status" aria-live="polite">Scanning…</div>
      ) : total === 0 ? (
        <div className="bl-empty" data-testid="note-backlinks-empty">Nothing links here yet.</div>
      ) : (
        <ul className="bl-list" role="list">
          {noteLinks.map((bl) => (
            <li key={`note:${bl.path}`}>
              <button
                type="button"
                className="bl-item"
                data-testid={`note-backlink-${bl.path}`}
                title={bl.path}
                onClick={() => onOpenNote(bl.path)}
              >
                <span className="bl-item-head">
                  <span className="bl-item-name">{bl.name}</span>
                </span>
                <span className="bl-item-snippet">{bl.snippet}</span>
              </button>
            </li>
          ))}
          {storyLinks.map((bl) => (
            <li key={`scene:${bl.scene.id}`}>
              <button
                type="button"
                className="bl-item"
                data-testid={`story-backlink-${bl.scene.id}`}
                title={`${bl.story.title} › ${bl.chapter.title} › ${bl.scene.title}`}
                onClick={() => onOpenScene(bl.scene, bl.chapter, bl.story)}
              >
                <span className="bl-item-head">
                  <span className="bl-item-name">{bl.scene.title}</span>
                  <span className="bl-story-chip">STORY</span>
                </span>
                <span className="bl-item-snippet">{bl.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
