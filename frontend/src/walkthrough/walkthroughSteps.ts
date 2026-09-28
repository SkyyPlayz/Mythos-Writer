/** Coach-mark walkthrough steps — sourced from design seed mythos-writer-seed.json. */
export type WalkthroughSide = 'auto' | 'top' | 'bottom' | 'left' | 'right';

export interface WalkthroughStep {
  chapter: string;
  target: string;
  alt: string | null;
  text: string;
  advanceOnClick: boolean;
  side: WalkthroughSide;
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    "chapter": "Story",
    "target": "demo-btn",
    "alt": null,
    "text": "Hi! I’m your guide. I point, you tap. Nothing gets locked — wander off any time and tap Demo to hide me.",
    "advanceOnClick": false,
    "side": "bottom"
  },
  {
    "chapter": "Story",
    "target": "rail-editor",
    "alt": null,
    "text": "First stop: the Story Writer. Tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "ssub-editor",
    "alt": null,
    "text": "The Editor — where the words happen. Tap Editor.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "ed-page",
    "alt": null,
    "text": "Type anywhere on the page. Now the trick: type [[ and a name — a search pops up and the name becomes a live link. Try [[Mira]].",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Partner",
    "target": "rtab-Agent",
    "alt": null,
    "text": "Meet Mythos, your writing partner: coach, beta reader and continuity checker in one. Tap the tab.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Partner",
    "target": "wa-input",
    "alt": null,
    "text": "Chat with Mythos about anything — ask questions, get writing advice, talk worldbuilding and future plans.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Partner",
    "target": "wa-call",
    "alt": null,
    "text": "Rather talk? Start a voice call — same thread, same partner, stays right here.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Partner",
    "target": "rtab-Suggestions",
    "alt": null,
    "text": "Suggestions: everything Mythos noticed, pinned to the exact line. Tap the tab.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Partner",
    "target": "rtab-Notes & Analysis",
    "alt": null,
    "text": "Notes & Analysis: references, scene analysis and the vault’s open questions. Tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Partner",
    "target": "ed-comments",
    "alt": null,
    "text": "Margin comments — yours and Mythos’s — live behind this chip. Tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "zoom-book",
    "alt": null,
    "text": "Zoom levels! Full Book shows the whole manuscript on one scroll. Tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "zoom-part",
    "alt": null,
    "text": "Part — one act at a time. Tap Part.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "zoom-chapter",
    "alt": null,
    "text": "Chapter — one chapter, all its scenes. Tap Chapter.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "zoom-scene",
    "alt": null,
    "text": "Scene — one scene, nothing else. Tap Scene.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "ssub-book",
    "alt": null,
    "text": "Book — a compiled read-through, front to back. Tap Book.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "ssub-structure",
    "alt": null,
    "text": "Structure — your book as cards. Tap Structure.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "struct-cards",
    "alt": null,
    "text": "Every card is a scene, colour = status. Drag one into another chapter — the manuscript reorders itself.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "struct-list",
    "alt": null,
    "text": "Prefer a list? Same scenes, tighter. Tap List.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Story",
    "target": "ssub-strip",
    "alt": null,
    "text": "Draft first? Outline first? Whole-book-at-once? These are all just views of one manuscript. Pick whatever fits how you write.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Notes & Boards",
    "target": "rail-notes",
    "alt": null,
    "text": "Now the world bible. Tap Notes.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Notes & Boards",
    "target": "notes-tree",
    "alt": null,
    "text": "Plain Markdown files: characters, places, factions. Got an Obsidian vault? It drops straight in.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Notes & Boards",
    "target": "note-title",
    "alt": null,
    "text": "Every note has properties, tags and backlinks — it knows who mentions it.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Notes & Boards",
    "target": "ntab-agent",
    "alt": null,
    "text": "Mythos reads along here too — ask what the vault knows. Tap the tab.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Notes & Boards",
    "target": "rail-boards",
    "alt": null,
    "text": "Boards next. Tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Notes & Boards",
    "target": "boards-hub",
    "alt": null,
    "text": "Here’s the secret: a board card IS the note. Edit either side and both update. Same files, different view.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Notes & Boards",
    "target": "board-canvas",
    "alt": "boards-hub",
    "text": "Right-click the canvas → New card. Drag it. Link two cards — that link shows up in backlinks and the graph.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Crafter",
    "target": "rail-crafter",
    "alt": null,
    "text": "Stuck on a scene? Scene Crafter. Tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Crafter",
    "target": "cf-setup",
    "alt": null,
    "text": "Scene setup: title, POV, goal, conflict. Fill in what you know — blanks are fine.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Crafter",
    "target": "cf-gen",
    "alt": null,
    "text": "Generate: Mythos turns your summary + plan cards into a beat board. You write the prose. Give it a go.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Timeline",
    "target": "rail-timeline",
    "alt": null,
    "text": "Time travel. Tap Timeline.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Timeline",
    "target": "tl-board",
    "alt": null,
    "text": "Every world on one axis, each with its own calendar and year length. Ctrl + scroll to zoom from centuries to hours.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Timeline",
    "target": "tl-zoom",
    "alt": null,
    "text": "Tall stack? Zoom the whole board out here.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Timeline",
    "target": "tl-sync",
    "alt": null,
    "text": "Drop a sync line: one instant, read in every world’s own calendar. Tap, then click the axis.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Timeline",
    "target": "tl-today",
    "alt": null,
    "text": "Today jumps to wherever you’re writing right now.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Graph",
    "target": "rail-graph",
    "alt": null,
    "text": "Last big one. Tap Graph.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Graph",
    "target": "g-node",
    "alt": null,
    "text": "Every [[link]] you typed became an edge. Click a node to see the sentence it came from.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Graph",
    "target": "g-relayout",
    "alt": null,
    "text": "Shake it out — tap Re-layout.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Settings",
    "target": "set-appearance",
    "alt": null,
    "text": "Make it yours. Settings › Appearance — tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Settings",
    "target": "set-theme",
    "alt": null,
    "text": "Themes: curated neon sets or build your own. Each vault can wear its own colours so you always know where you are.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Settings",
    "target": "set-wp",
    "alt": null,
    "text": "Wallpaper sits behind the glass. Theme match follows your palette.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Settings",
    "target": "set-partner",
    "alt": null,
    "text": "Writing partner: rename Mythos, pick a voice, and set how bold the suggestions get. Tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Settings",
    "target": "set-agents",
    "alt": null,
    "text": "Model & keys: bring your own Claude key. Your words stay on your machine. Tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Settings",
    "target": "set-vault",
    "alt": null,
    "text": "Vault & Files — tap it.",
    "advanceOnClick": true,
    "side": "auto"
  },
  {
    "chapter": "Settings",
    "target": "vault-link",
    "alt": null,
    "text": "A Mythos vault holds Notes Vaults + Story Vaults. This chain links a story to notes — even in another Mythos vault (green). Read & write or Read only.",
    "advanceOnClick": false,
    "side": "auto"
  },
  {
    "chapter": "Settings",
    "target": "demo-btn",
    "alt": null,
    "text": "That’s the tour! Mythos bends to your process — outline-first, draft-first, worldbuild-forever. Almost every style (there are always oddballs). Tap Demo to hide me.",
    "advanceOnClick": false,
    "side": "bottom"
  }
];

export const WALKTHROUGH_CHAPTERS = [
  'Story',
  'Partner',
  'Notes & Boards',
  'Crafter',
  'Timeline',
  'Graph',
  'Settings',
] as const;
