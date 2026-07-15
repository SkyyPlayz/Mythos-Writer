// Beta 4 M5 — MythosVault format codec tests.
// Real tmpdirs, no mocks — these drive the exact code paths the app uses.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MYTHOS_FORMAT_VERSION,
  MythosFileError,
  MythosFormatVersionError,
  _clearDetectionCache,
  createMythosFile,
  isMythosV2Root,
  manifestCachePathFor,
  mythosRootForStoryVault,
  parseMythosFile,
  readMythosFile,
  recordSeedInMythosFile,
  resolveManifestPath,
  serializeMythosFile,
  storyVaultRootFor,
  tryReadMythosFile,
  writeMythosFile,
} from './mythosJson.js';
import {
  chapterDirName,
  draftStateToStatus,
  isChapterDirName,
  isPartDirName,
  isSceneFileName,
  parseOrdinal,
  parseV2SceneFile,
  partDirName,
  sceneFileName,
  serializeV2SceneFile,
  statusToDraftState,
  storyFolderName,
} from './sceneFiles.js';
import { parseBookFile, serializeBookFile, type BookFile } from './bookFile.js';
import {
  draftsDirForChapter,
  listDraftsForScene,
  parseDraftFile,
  parseDraftTs,
  saveDraftForScene,
  serializeDraftFile,
} from './draftFiles.js';
import {
  appendTurns,
  createSession,
  listSessions,
  parseSessionFile,
  readSession,
  serializeSessionFile,
} from './agentSessions.js';
import {
  defaultVaultSettingsFile,
  readVaultSettingsFile,
  writeVaultSettingsFile,
} from './vaultSettingsFile.js';
import {
  defaultTimelinesFile,
  readTimelinesFile,
  writeTimelinesFile,
} from './timelinesFile.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-format-'));
  _clearDetectionCache();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── mythos.json codec ───────────────────────────────────────────────────────

describe('mythos.json codec', () => {
  it('round-trips a full file', () => {
    const file = createMythosFile('My Vault', {
      defaultTheme: 'aurora',
      stories: [
        {
          id: 's1',
          title: 'The Last City of Veynn',
          folder: 'The Last City of Veynn',
          synopsis: 'A drowned city.',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      seed: { layout: 'veynn-demo@M5', mode: 'default', seededAt: '2026-01-01T00:00:00.000Z' },
    });
    const parsed = parseMythosFile(serializeMythosFile(file));
    expect(parsed).toEqual(file);
  });

  it('write + read on disk', () => {
    const file = createMythosFile('Disk Vault');
    writeMythosFile(tmp, file);
    expect(readMythosFile(tmp)).toEqual(file);
  });

  it('rejects a formatVersion newer than this build (never fall back to v0.4)', () => {
    fs.writeFileSync(
      path.join(tmp, 'mythos.json'),
      JSON.stringify({ formatVersion: MYTHOS_FORMAT_VERSION + 1, id: 'x', name: 'future' }),
    );
    expect(() => readMythosFile(tmp)).toThrow(MythosFormatVersionError);
    // tryRead must PROPAGATE too — silently treating a newer vault as v0.4
    // would route legacy writes into it.
    expect(() => tryReadMythosFile(tmp)).toThrow(MythosFormatVersionError);
    expect(() => isMythosV2Root(tmp)).toThrow(MythosFormatVersionError);
  });

  it('rejects corrupt and non-v2 payloads', () => {
    expect(() => parseMythosFile('not json')).toThrow(MythosFileError);
    expect(() => parseMythosFile('[]')).toThrow(MythosFileError);
    expect(() => parseMythosFile(JSON.stringify({ formatVersion: 1 }))).toThrow(MythosFileError);
  });

  it('drops story refs whose folder could escape the Story Vault', () => {
    const parsed = parseMythosFile(
      JSON.stringify({
        formatVersion: 2,
        id: 'v',
        name: 'n',
        createdAt: 'now',
        stories: [
          { id: 'ok', folder: 'Fine Story', title: 'Fine' },
          { id: 'bad1', folder: '../escape', title: 'Nope' },
          { id: 'bad2', folder: 'a/b', title: 'Nope' },
          { id: 'bad3', folder: '..', title: 'Nope' },
        ],
        seed: null,
      }),
    );
    expect(parsed.stories.map((s) => s.id)).toEqual(['ok']);
  });

  it('recordSeedInMythosFile is write-once', () => {
    writeMythosFile(tmp, createMythosFile('V'));
    recordSeedInMythosFile(tmp, { layout: 'first', mode: 'default' });
    recordSeedInMythosFile(tmp, { layout: 'second', mode: 'blank' });
    expect(readMythosFile(tmp).seed?.layout).toBe('first');
  });
});

// ─── Version gate (resolveManifestPath / detection) ──────────────────────────

describe('version gate', () => {
  it('v0.4 roots keep manifest.json at the vault root', () => {
    const storyRoot = path.join(tmp, 'Story Vault');
    fs.mkdirSync(storyRoot, { recursive: true });
    expect(mythosRootForStoryVault(storyRoot)).toBeNull();
    expect(resolveManifestPath(storyRoot)).toBe(path.join(storyRoot, 'manifest.json'));
  });

  it('v2 roots route the legacy manifest to the .mythos cache', () => {
    writeMythosFile(tmp, createMythosFile('V2'));
    const storyRoot = storyVaultRootFor(tmp);
    fs.mkdirSync(storyRoot, { recursive: true });
    expect(mythosRootForStoryVault(storyRoot)).toBe(tmp);
    expect(resolveManifestPath(storyRoot)).toBe(manifestCachePathFor(storyRoot));
  });

  it('a story root NOT named "Story Vault" never gates, even beside mythos.json', () => {
    writeMythosFile(tmp, createMythosFile('V2'));
    const other = path.join(tmp, 'SomethingElse');
    fs.mkdirSync(other, { recursive: true });
    expect(mythosRootForStoryVault(other)).toBeNull();
  });

  it('detection cache invalidates when mythos.json changes', () => {
    const storyRoot = storyVaultRootFor(tmp);
    fs.mkdirSync(storyRoot, { recursive: true });
    expect(isMythosV2Root(tmp)).toBe(false);
    writeMythosFile(tmp, createMythosFile('V2'));
    expect(isMythosV2Root(tmp)).toBe(true);
    fs.rmSync(path.join(tmp, 'mythos.json'));
    expect(isMythosV2Root(tmp)).toBe(false);
  });
});

// ─── Scene files ─────────────────────────────────────────────────────────────

describe('v2 scene files', () => {
  it('canonical names + ordinal parsing', () => {
    expect(partDirName(1)).toBe('Part 1');
    expect(chapterDirName(7)).toBe('Chapter 07');
    expect(sceneFileName(12)).toBe('Scene 12.md');
    expect(isPartDirName('Part 3')).toBe(true);
    expect(isChapterDirName('Chapter 10')).toBe(true);
    expect(isSceneFileName('Scene 01.md')).toBe(true);
    expect(isSceneFileName('book.md')).toBe(false);
    expect(parseOrdinal('Chapter 07')).toBe(7);
    expect(parseOrdinal('Scene 12.md')).toBe(12);
    expect(parseOrdinal('Part 100')).toBe(100);
    expect(parseOrdinal('no number')).toBeNull();
  });

  it('frontmatter {title,status,pov,when} round-trips with unknown keys preserved', () => {
    const serialized = serializeV2SceneFile({
      id: 'scene-1',
      title: "The Watcher's Call",
      status: 'done',
      pov: 'Mira Veynn',
      when: 8710.5,
      updatedAt: '2026-01-01T00:00:00.000Z',
      extraFrontmatter: { mood: 'ominous', chronologicalDate: 'Y871', tags: ['bells', 'dusk'] },
      prose: 'Nine bells at dusk.\n\nSlow and uneven.',
    });
    const parsed = parseV2SceneFile(serialized, 'Scene 01.md');
    expect(parsed.id).toBe('scene-1');
    expect(parsed.title).toBe("The Watcher's Call");
    expect(parsed.status).toBe('done');
    expect(parsed.pov).toBe('Mira Veynn');
    expect(parsed.when).toBe(8710.5);
    expect(parsed.prose).toBe('Nine bells at dusk.\n\nSlow and uneven.');
    expect(parsed.extraFrontmatter?.mood).toBe('ominous');
    expect(parsed.extraFrontmatter?.chronologicalDate).toBe('Y871');
    expect(parsed.extraFrontmatter?.tags).toEqual(['bells', 'dusk']);
  });

  it('derives a sane status when frontmatter has none', () => {
    expect(parseV2SceneFile('---\nid: x\ntitle: T\n---\nprose here').status).toBe('draft');
    expect(parseV2SceneFile('---\nid: x\ntitle: T\n---\n').status).toBe('todo');
    expect(parseV2SceneFile('---\nid: x\ntitle: T\nstatus: bogus\n---\ntext').status).toBe('draft');
  });

  it('draftState ↔ status mapping is deterministic', () => {
    expect(draftStateToStatus('final', true)).toBe('done');
    expect(draftStateToStatus('in-progress', true)).toBe('draft');
    expect(draftStateToStatus('review', true)).toBe('draft');
    expect(draftStateToStatus(undefined, true)).toBe('draft');
    expect(draftStateToStatus(undefined, false)).toBe('todo');
    expect(statusToDraftState('done')).toBe('final');
    expect(statusToDraftState('draft')).toBe('in-progress');
    expect(statusToDraftState('todo')).toBeUndefined();
  });

  it('storyFolderName strips path separators and Windows-illegal characters', () => {
    expect(storyFolderName('The Last City of Veynn')).toBe('The Last City of Veynn');
    expect(storyFolderName('a/b\\c: "d" <e>|f?*')).toBe('abc d ef');
    expect(storyFolderName('Trailing dots...')).toBe('Trailing dots');
    expect(storyFolderName('///')).toBe('Untitled Story');
  });
});

// ─── book.md ─────────────────────────────────────────────────────────────────

describe('book.md codec', () => {
  const book: BookFile = {
    id: 'story-1',
    title: 'The Last City of Veynn',
    synopsis: 'A drowned city remembers.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    spine: [
      {
        dir: 'Part 1',
        label: 'Ash and Oath',
        intro: ['They say the city drowned twice.'],
        chapters: [
          { dir: 'Chapter 01', id: 'ch-1', title: 'The Quiet Before', intro: ['Journal entry.'] },
          { dir: 'Chapter 02', id: 'ch-2', title: 'Fractures' },
        ],
      },
      { dir: 'Part 2', label: 'Embers Rising', chapters: [{ dir: 'Chapter 03', id: 'ch-3', title: 'Whispers of Rebellion' }] },
    ],
  };

  it('round-trips metadata + spine', () => {
    expect(parseBookFile(serializeBookFile(book))).toEqual(book);
  });

  it('survives a chapter title containing the comment-close sequence', () => {
    const tricky: BookFile = {
      ...book,
      spine: [
        {
          dir: 'Part 1',
          chapters: [{ dir: 'Chapter 01', id: 'c', title: 'A --> B' }],
        },
      ],
    };
    const parsed = parseBookFile(serializeBookFile(tricky));
    expect(parsed.spine[0].chapters[0].title).toBe('A --> B');
  });

  it('degrades to an empty spine on corrupt payloads', () => {
    const parsed = parseBookFile('---\nid: s\ntitle: T\n---\n<!-- mythos:spine\nnot json\n-->\n');
    expect(parsed.spine).toEqual([]);
    expect(parsed.id).toBe('s');
  });
});

// ─── drafts ──────────────────────────────────────────────────────────────────

describe('draft files', () => {
  const chapterRel = 'The City/Part 1/Chapter 01';

  function scaffoldScene(vaultRoot: string): void {
    const chapterAbs = path.join(vaultRoot, ...chapterRel.split('/'));
    fs.mkdirSync(chapterAbs, { recursive: true });
    fs.writeFileSync(
      path.join(chapterAbs, 'Scene 01.md'),
      serializeV2SceneFile({ id: 'scene-1', title: 'S', status: 'draft', prose: 'v1' }),
    );
  }

  it('drafts dir mirrors the chapter path under <Story>/drafts', () => {
    expect(draftsDirForChapter('The City/Part 1/Chapter 01')).toBe(
      'The City/drafts/Part 1/Chapter 01',
    );
  });

  it('numbers drafts sequentially and lists them in order', () => {
    scaffoldScene(tmp);
    const d1 = saveDraftForScene(tmp, { sceneId: 'scene-1', chapterRelPath: chapterRel, content: 'one' });
    const d2 = saveDraftForScene(tmp, { sceneId: 'scene-1', chapterRelPath: chapterRel, content: 'two' });
    expect(d1.draft).toBe(1);
    expect(d2.draft).toBe(2);
    expect(path.basename(d2.filePath)).toBe('Scene 01.draft-2.md');
    const listed = listDraftsForScene(tmp, chapterRel, 'scene-1');
    expect(listed.map((d) => d.content)).toEqual(['one', 'two']);
  });

  it('dedupes byte-identical auto saves', () => {
    scaffoldScene(tmp);
    saveDraftForScene(tmp, { sceneId: 'scene-1', chapterRelPath: chapterRel, content: 'same', intent: 'auto' });
    const again = saveDraftForScene(tmp, { sceneId: 'scene-1', chapterRelPath: chapterRel, content: 'same', intent: 'auto' });
    expect(again.draft).toBe(1);
    expect(listDraftsForScene(tmp, chapterRel, 'scene-1')).toHaveLength(1);
  });

  it('prunes by retention', () => {
    scaffoldScene(tmp);
    for (let i = 0; i < 5; i++) {
      saveDraftForScene(tmp, {
        sceneId: 'scene-1',
        chapterRelPath: chapterRel,
        content: `v${i}`,
        retention: { maxPerScene: 3, maxAgeDays: 0 },
      });
    }
    const listed = listDraftsForScene(tmp, chapterRel, 'scene-1');
    expect(listed).toHaveLength(3);
    expect(listed.map((d) => d.content)).toEqual(['v2', 'v3', 'v4']);
  });

  it('draft header round-trips and never mistakes a scene file for a draft', () => {
    const header = {
      sceneId: 's', draft: 6, savedAt: '2026-01-01T00:00:00.000Z',
      intent: 'save' as const, contentHash: 'abc', label: 'Before rewrite',
    };
    const sceneContent = '---\nid: s\ntitle: T\nstatus: draft\n---\nfull scene body';
    const parsed = parseDraftFile(serializeDraftFile(header, sceneContent));
    expect(parsed?.header).toEqual({ ...header, draft: 6 });
    expect(parsed?.content).toBe(sceneContent);
    expect(parseDraftFile(sceneContent)).toBeNull();
  });

  it('parses only well-formed draft ts tokens', () => {
    expect(parseDraftTs('draft-6')).toBe(6);
    expect(parseDraftTs('draft-0')).toBeNull();
    expect(parseDraftTs('2026-01-01T00-00-00-000Z_00000001-abcd1234')).toBeNull();
  });

  it('rejects chapter paths that escape the vault', () => {
    expect(() =>
      saveDraftForScene(tmp, { sceneId: 's', chapterRelPath: '../outside/ch', content: 'x' }),
    ).toThrow(/escapes vault root/);
  });
});

// ─── sessions ────────────────────────────────────────────────────────────────

describe('agent session files', () => {
  it('creates, reads back, and lists sessions', () => {
    const { session, relPath } = createSession(tmp, {
      agent: 'brainstorm',
      title: 'Worldbuilding kickoff',
      turns: [
        { role: 'agent', at: '2026-01-01T00:00:00.000Z', text: 'Tell me about your story.' },
        { role: 'user', at: '2026-01-01T00:01:00.000Z', text: 'A city that\ndrowned twice.' },
      ],
    });
    expect(relPath.startsWith('Sessions/')).toBe(true);
    const read = readSession(tmp, session.id);
    expect(read?.turns).toHaveLength(2);
    expect(read?.turns[1].text).toBe('A city that\ndrowned twice.');
    const listed = listSessions(tmp);
    expect(listed).toHaveLength(1);
    expect(listed[0].turnCount).toBe(2);
    expect(listed[0].agent).toBe('brainstorm');
  });

  it('appends turns durably', () => {
    const { session } = createSession(tmp, { agent: 'coach' });
    appendTurns(tmp, session.id, [
      { role: 'user', at: '2026-01-01T00:00:00.000Z', text: 'Help with pacing?' },
    ]);
    expect(readSession(tmp, session.id)?.turns).toHaveLength(1);
  });

  it('round-trips through serialize/parse including multi-line turns', () => {
    const session = {
      id: 'sess-1',
      agent: 'brainstorm',
      title: 'T',
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:05:00.000Z',
      turns: [
        { role: 'user' as const, at: '2026-01-01T00:00:00.000Z', text: 'line one\n\nline three' },
      ],
    };
    const parsed = parseSessionFile(serializeSessionFile(session));
    expect(parsed?.turns[0].text).toBe('line one\n\nline three');
    expect(parsed?.id).toBe('sess-1');
  });

  it('ignores ordinary notes (a note is never a session)', () => {
    fs.mkdirSync(path.join(tmp, 'Sessions'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Sessions', 'note.md'), '---\ntitle: Note\n---\nJust a note');
    expect(listSessions(tmp)).toHaveLength(0);
  });

  // M12: the Coach encodes lesson/analysis cards as an HTML-comment marker
  // line + JSON payload inside an agent turn. The marker must survive the
  // session-file round-trip byte-exact (it is not a turn fence).
  it('M12: coach card marker turns round-trip losslessly', () => {
    const cardText = '<!-- mythos:coach-card v1 -->\n{"kind":"lesson","title":"Lesson — grounding","text":"Anchor place fast.","points":["one","two"],"drill":"Drill: 5 minutes."}';
    const { session } = createSession(tmp, {
      agent: 'coach',
      turns: [{ role: 'agent', at: '2026-01-01T00:00:00.000Z', text: cardText }],
    });
    const read = readSession(tmp, session.id);
    expect(read?.turns).toHaveLength(1);
    expect(read?.turns[0].text).toBe(cardText);
  });
});

// ─── settings.json + timelines.json ─────────────────────────────────────────

describe('settings.json + timelines.json codecs', () => {
  it('settings round-trip and preserve unknown keys', () => {
    writeVaultSettingsFile(tmp, {
      ...defaultVaultSettingsFile({ defaultTheme: 'aurora', layoutMode: 'default' }),
      futureKey: { nested: true },
    });
    const read = readVaultSettingsFile(tmp);
    expect(read.defaultTheme).toBe('aurora');
    expect(read.futureKey).toEqual({ nested: true });
  });

  it('settings degrade to defaults when missing or corrupt', () => {
    expect(readVaultSettingsFile(tmp).version).toBe(1);
    fs.writeFileSync(path.join(tmp, 'settings.json'), '{broken');
    expect(readVaultSettingsFile(tmp).version).toBe(1);
  });

  it('timelines round-trip events + arcs + preserve unknown keys', () => {
    const file = defaultTimelinesFile();
    file.events = [{ id: 'e1', title: 'The Sunken Gate', when: 8730, chapter: 'Ch. 4' }];
    (file as Record<string, unknown>).calendars = [{ months: 13 }];
    writeTimelinesFile(tmp, file);
    const read = readTimelinesFile(tmp);
    expect(read.events).toHaveLength(1);
    expect(read.events[0].when).toBe(8730);
    expect((read as Record<string, unknown>).calendars).toEqual([{ months: 13 }]);
  });

  it('timelines degrade to an empty envelope when corrupt', () => {
    fs.writeFileSync(path.join(tmp, 'timelines.json'), 'nope');
    expect(readTimelinesFile(tmp)).toEqual(defaultTimelinesFile());
  });
});
