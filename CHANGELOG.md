# Changelog

All notable changes to Mythos Writer are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Mythos Writer uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

_No git tag and no GitHub release for 0.5.8. The version on main is still 0.5.7 ([#1663](https://github.com/SkyyPlayz/Mythos-Writer/pull/1663))._

### Removed
- **Branded cloud/sync surface** — the Move Vault wizard's cloud destination (Dropbox, iCloud Drive, OneDrive, Google Drive), the vault sync badge, cloud-provider detection on the vault path, and the conflicted-copy scanner that silently rearranged files matching those providers' naming patterns. Mythos Writer is local-first: a vault is plain files in a folder you choose. Moving a vault to a different local folder is unchanged and remains the default. The concurrent-session lockfile stays — it guards against a second Mythos session holding the same vault, which is a local concern. (SKY-11804)

### Fixed
- A board drag or recolor whose sidecar is a symbolic link no longer throws out of the main process. The board shows the shortcut refusal and returns to the last saved layout, so the drag is not left looking saved. If that notice cannot be delivered, the pending edit stays queued. The link target is left unchanged. ([#1748](https://github.com/SkyyPlayz/Mythos-Writer/pull/1748))
- On Windows, where the no-follow open flag is zero, a save, an append, a settings read, a manifest read, and a note read reject a symbolic link or junction before the open, and they keep the handle only when it is still the same file. ([#1748](https://github.com/SkyyPlayz/Mythos-Writer/pull/1748))
- A settings or secrets read keeps the file it checked: the open does not follow a link, and the bytes come from that handle. An append stores every byte and then syncs, the same way a full save does. A manifest or note that is a symbolic link is not read as the real file. ([#1748](https://github.com/SkyyPlayz/Mythos-Writer/pull/1748))
- A save stores every byte before it syncs the file, so a short write cannot be renamed into place as a truncated note. A named pipe at a note path is refused instead of stalling the save. A manifest backup over 25 MB is kept. ([#1748](https://github.com/SkyyPlayz/Mythos-Writer/pull/1748))
- Saving over an existing note no longer follows a symbolic link swapped in at that path, so the write cannot land on a different file. Tag rename and merge keep a backup when the combined notes are over 25 MB, and those rewrites refresh note search and metadata. ([#1748](https://github.com/SkyyPlayz/Mythos-Writer/pull/1748))
- Chapter text and story comments no longer show a refused save as successful. A note that is a symbolic link stays out of the tag list, and renaming or merging tags does not read or back up that link. ([#1748](https://github.com/SkyyPlayz/Mythos-Writer/pull/1748))
- Tests now clean up their temporary folders, even when interrupted ([#1758](https://github.com/SkyyPlayz/Mythos-Writer/pull/1758)).
- Electron 44.9.1 and undici 7.30.1 close high-severity advisories in the desktop shell and its download client (compromised certificate intermediates, and request-parser crashes). ([#1753](https://github.com/SkyyPlayz/Mythos-Writer/pull/1753))
- Updated the build tool (vite) to close a high-severity security advisory in the dev server. ([#1745](https://github.com/SkyyPlayz/Mythos-Writer/pull/1745))
- Saving a note no longer follows a symbolic link at the note's path, so a link pointing outside the vault can't make the app write there. Saving a note that is a symbolic link now shows: Couldn't save <name>: it's a shortcut (symbolic link). Save it under a new name instead. ([#1748](https://github.com/SkyyPlayz/Mythos-Writer/pull/1748))
- Opening a note path now refuses a parent folder that is a symlink loop, including when the platform reports the missing note as absent instead of a loop. ([#1748](https://github.com/SkyyPlayz/Mythos-Writer/pull/1748))
- Markdown import and paste no longer risk freezing the app on very large or malformed text (markdown-it security update 14.2.0 → 14.3.3). ([#1743](https://github.com/SkyyPlayz/Mythos-Writer/pull/1743))

### Changed
- **README matches the current app.** Windows is the primary platform. AI is your own OpenRouter key, Paste key (OpenAI-compatible), or a model on this computer (Ollama, LM Studio, or llama.cpp). A subscription sign-in is in beta. The screenshots are the current Liquid Neon window. ([#1759](https://github.com/SkyyPlayz/Mythos-Writer/pull/1759))
- **OpenRouter requests never use Google** — chat, speech, and transcription calls to OpenRouter ignore Google Vertex and Google AI Studio, keep zero-data-retention and data-collection deny, and will not select a google/* model. ([#1741](https://github.com/SkyyPlayz/Mythos-Writer/pull/1741))
- AI suggestions can no longer write into your manuscript files. Auto-mark no longer edits notes: suggestions for your notes now wait in the inbox until you accept them, and suggestions for your manuscript are just marked done. ([#1742](https://github.com/SkyyPlayz/Mythos-Writer/pull/1742))
- Continuity fixes now show how to fix the issue, with no Apply Edit button; manuscript suggestions are marked done instead of accepted; the Add to scene draft menu item and drawer button are gone. ([#1740](https://github.com/SkyyPlayz/Mythos-Writer/pull/1740))
- **Timeline views** — the timeline shows Structure and Progress. Plotlines, Spreadsheet, Tension, Relationships, and Subway are hidden from the view switcher; saved timeline data is unchanged. ([#1695](https://github.com/SkyyPlayz/Mythos-Writer/pull/1695))
- **Graph filters sit at the top-right of the graph card** — the category chips and depth control are a compact bar on the card, and Tab still reaches them after the header controls. ([PR #1715](https://github.com/SkyyPlayz/Mythos-Writer/pull/1715))
- Electron 44.9.0 (from 42). macOS 13+ required. File dialogs remember the last folder again. Client-certificate requests are declined, not auto-answered. ([#1728](https://github.com/SkyyPlayz/Mythos-Writer/pull/1728))
- **Theme "Neon Classic" is now "Neon Nebula"** — display name only; the stored preset key is unchanged. (SKY-11589)
- **Background settings: "No background" removed** — a stored `none` wallpaper mode falls back to Theme match. (SKY-11589)

### Added
- **Import your writing** — Settings → Vault & Files has one drop zone (plus Choose a file… / Choose a folder…) for Word, Google Docs, Markdown files and folders (Obsidian, iA Writer and other Markdown apps), Scrivener, ePub, RTF and plain text. You see a preview of the chapters, scenes, notes and characters before anything is saved. Word imports keep chapters, scenes, bold, italics and breaks. Programs, scripts and macro files are refused. ([#1785](https://github.com/SkyyPlayz/Mythos-Writer/pull/1785))
- **Theme match wallpaper cycle** — every Liquid Neon preset ships several wallpapers; arrows on the Theme match tile (Settings → Appearance → Background) cycle them, and the pick persists per vault. The pack is manifest-driven (`frontend/src/assets/wallpapers/manifest.json`, regenerate with `scripts/wallpapers/build-pack.py`). (SKY-11589)

## [0.5.7] — 2026-10-03

_Draft release that was never published._

_Wording follows the v0.5.7 release notes._

### Added

- **Notes for every level of your book.** The scene notes panel has separate notes for the Book, each Part, each Chapter, and each Scene. Part notes belong to their own book, so two books with a "Part 1" no longer share notes. In the Notes view, the Properties column lists Backlinks first, then properties and tags, then Recent notes. ([#1648](https://github.com/SkyyPlayz/Mythos-Writer/pull/1648))
- **Agent files in Model & keys.** Settings → Model & keys shows where your agents' files live, with buttons to reveal the folder, open it, or empty it (it asks before deleting anything). ([#1648](https://github.com/SkyyPlayz/Mythos-Writer/pull/1648))
- **One writing partner.** The writing partner is a single chat with quick actions (Update Timeline, Beta Read, Writer Scan) and uses the name you give your AI. Earlier chats opens past sessions, and Beta Read runs once per click. ([#1646](https://github.com/SkyyPlayz/Mythos-Writer/pull/1646))
- **New first-run welcome.** A simpler welcome screen replaces the old setup wizard and Getting Started card, and Mythos remembers whether you started from a template, a blank vault, or an import. ([#1646](https://github.com/SkyyPlayz/Mythos-Writer/pull/1646), [#1644](https://github.com/SkyyPlayz/Mythos-Writer/pull/1644))
- **Timeline and Realm.** The Timeline adds a closer Month zoom and a folder-style tree in its sidebar, and the Realm view fits everything on screen when it opens. ([#1646](https://github.com/SkyyPlayz/Mythos-Writer/pull/1646))
- **Boards sidebar as a folder tree.** Nested boards are a click or two away, Home stays pinned at the top, and you can drag the sidebar to the width you like. ([#1645](https://github.com/SkyyPlayz/Mythos-Writer/pull/1645))
- **Notes open in Rich view.** Notes open in Rich view by default, and Markdown and Source modes are turned on in Settings when you want them. A note with content Rich view can't fully keep (Markdown tables, footnotes, raw HTML, or complex callouts) opens in Source with a notice, and choosing "Open in Rich anyway" is remembered for that note. With "Always open in Rich" on (the new default), any other saved view mode for a note is kept but not used until you turn that option off. Page setup gains zoom presets, and the active tab is outlined more clearly. ([#1643](https://github.com/SkyyPlayz/Mythos-Writer/pull/1643))
- **Smoother links.** Typing `[[` shows suggestions right away, clicking a link to a note that doesn't exist yet creates it, @mentions take you to what they name, and dropping a file into the editor adds a link with its title. ([#1644](https://github.com/SkyyPlayz/Mythos-Writer/pull/1644))

### Changed

- **Settings saves when you close it.** There is no Save button. ([#1644](https://github.com/SkyyPlayz/Mythos-Writer/pull/1644))
- **AI keys are stored encrypted.** Every saved key, including the Alpha Reader, Storyline Consultant, and Line Editor keys, lives in your system's secure storage instead of in plain text in the settings file. Keys saved by older versions move over on the next start, and the settings file is written so a crash mid-save can't leave it half-written. ([#1661](https://github.com/SkyyPlayz/Mythos-Writer/pull/1661))

### Fixed

- **Restoring a backup no longer wipes your saved AI keys.** Before 0.5.7, restoring a backup made before 0.5.4 erased every saved key, and any restore erased the Alpha Reader, Storyline Consultant, and Line Editor keys. If your keys went blank after a restore, enter them again once. Backups made by 0.3 and later never contain your keys. Backups made by 0.2.x can include your app settings with any saved keys in plain text, so keep those files private or delete them. ([#1661](https://github.com/SkyyPlayz/Mythos-Writer/pull/1661))
- **Structure and Full Book.** Empty parts show up; you can drag a chapter into a part, add chapters and scenes inside a part, and rename a part from its Full Book heading or the navigator menu. A new chapter goes right after the one you have selected. ([#1645](https://github.com/SkyyPlayz/Mythos-Writer/pull/1645))
- **Moving and editing scenes.** Text you type right after moving a scene stays with that scene in its new chapter, renaming a part while a save is still going through works, and going Forward brings back the full Continuity note. ([#1645](https://github.com/SkyyPlayz/Mythos-Writer/pull/1645))
- **Scene Crafter.** Create Scene builds a board from what you filled in (goal, conflict, beats, length, tone, and references) and opens it, instead of making an empty "Board N". ([#1645](https://github.com/SkyyPlayz/Mythos-Writer/pull/1645))
- **Copied stories.** A story folder copied outside Mythos opens as its own story with its own text. Before, the copy could show the original's text, typing in one could save into the other, or the copy stayed hidden until you rebuilt the vault index. ([#1656](https://github.com/SkyyPlayz/Mythos-Writer/pull/1656))
- **Notes search** matches the new look, and the Notes sidebar starts a little wider. A width you already set is kept. ([#1655](https://github.com/SkyyPlayz/Mythos-Writer/pull/1655))
- **The Notes Brainstorm pane** fits at 900 and 1024 px window widths with no sideways scrolling, and its buttons stay clickable. ([#1662](https://github.com/SkyyPlayz/Mythos-Writer/pull/1662))
- **Look and layout.** Panel headers line up at one height, glass panels and pop-ups stack correctly, the starry wallpaper is the default, the bottom bar spans the full window, and Brainstorm's mode switch is reachable from the ⋯ menu in narrow windows. ([#1644](https://github.com/SkyyPlayz/Mythos-Writer/pull/1644))
- **Masked key previews are not saved as keys.** If a key field had been saved as its masked preview (for example `sk-ant-…1234`) instead of the real key, Settings marks it as missing and asks you to enter the key again. Pasting a masked preview into a key field shows an error instead of saving it. ([#1660](https://github.com/SkyyPlayz/Mythos-Writer/pull/1660))
- **`brace-expansion` was updated** to address a high-severity security advisory. ([#1652](https://github.com/SkyyPlayz/Mythos-Writer/pull/1652))

### Known issues

- Vaults created before 0.5.7 keep the old, reversed Timeline order. An opt-in fix is planned.
- In Settings, the **Move…** button in the agents' files section doesn't move anything yet.
- Part notes that were saved only under a plain "Part N" name, with no book, no longer show. The notes are still on disk, untouched.
- A chapter copied within the same story may stay hidden until you use **Rebuild**.
- If you switch vaults while Settings is open, the key preview can keep showing the previous vault's key status until you close and reopen Settings. Your saved keys aren't affected.
- On systems without a working keychain (mostly Linux without a keyring), API keys aren't kept between restarts, so the key fields are blank after a restart. If an older version saved a key in plaintext, it stays in the settings file until you save Settings once; that first save removes it. To remove it right away, open Settings and close it again (closing Settings saves).
- If Mythos can't write its settings file (for example, its settings folder is read-only), Settings won't close and shows "Couldn't save settings. Try again." Make the folder writable again, then press Close.
- If you go back to 0.5.6, the Alpha Reader, Storyline Consultant, and Line Editor keys will look empty. They're still saved, and they come back when you update to 0.5.7 again. If you enter a key for one of those helpers while on 0.5.6, 0.5.6 saves it unencrypted, the way it always has, and 0.5.7 encrypts it the next time it starts.
- At narrow window widths (around 900 px), the left navigation rail can overlap the content next to it by a few pixels.
- If the left pane was saved at its widest (500 px), it can still cut off content at window widths of 900–1024 px.
- The Notes search box's glow edge can look very slightly different from the design (a faint, 1 px difference). It's cosmetic only.
- If you turned off the Writing Coach in an older version, it can switch itself back on for about a second while the app starts after you update, then it turns off again on its own. Nothing was sent to an AI provider in our tests. There's no separate Writing Coach switch in Settings yet; it's coming in 0.5.8. To be sure no AI is used, turn off All AI features in Settings → Model & keys.
- In narrow windows (under about 1000 px wide), the Notes side panel is cramped: the message box is small, tab names can be cut off, and the Properties tab can sit under the Collapse button. Everything still works.
- If saving keys fails partway, some new keys may still be saved. Check the key fields after you see a save error.

## [0.5.6] — 2026-09-28

_Draft release that was never published._

_Feature list follows the v0.5.6 draft notes (`bf9a6c35..d2838622`). The GitHub release body is a commit list, so the wording is from the pull requests._

### Added

- **Liquid Neon look foundation.** Floating glass rail, title-bar Welcome, workspace tabs, and theme updates for overlay glass, hairlines, motion, scrollbars, and body zoom from density and text size. ([#1635](https://github.com/SkyyPlayz/Mythos-Writer/pull/1635))
- **Welcome overlay.** Five paths plus Skip, from the title bar or first run. The rail brand mark is gone; account is the title-bar avatar. ([#1637](https://github.com/SkyyPlayz/Mythos-Writer/pull/1637))
- **Writing-column chrome.** Story document tabs sit in the writing column, the sidebar order is Story Writer, Notes Editor, Boards, Scene Crafter, Partner, Timeline, Vault Graph, the window corners are rounded, and the keyboard-shortcut text is larger. ([#1638](https://github.com/SkyyPlayz/Mythos-Writer/pull/1638))
- **One Writing Partner with three hands** (Writer, Analyst, Archivist). The four-face agent card is gone. The right panel is your partner's name, Suggestions, Scenes, and Notes & Analysis (Scenes and Notes & Analysis when AI is off). The partner tab is chat-first, with mute, transcript, settings, and End on the card. Beta Reader is reached from the Analyst hand. A new story opens in the Editor at Full Book zoom. ([#1639](https://github.com/SkyyPlayz/Mythos-Writer/pull/1639))
- **Settings → Writing partner and Model & keys.** Writing partner holds the name, personality, teaching style (Socratic, Guided practice, Feynman, Just tell me, Adaptive), per-hand models, and hard bans. Model & keys replaces the old AI Agents page with CLI, API key, and On this computer. The Claude connect screen stops at Coming soon and does not sign in. Web search and Claude memory default off. Help improve Mythos defaults to Don't send. ([#1640](https://github.com/SkyyPlayz/Mythos-Writer/pull/1640))
- **Several vaults, a seed pack, and an Agents Vault.** You can keep many Notes vaults and many Story vaults, and a Story vault can hold many stories. New vault from the rail + or Welcome offers Template, Blank, Import, Restore, or Open an Obsidian vault in place. Linked vaults show a green dashed connector and a "from" chip, and each inner vault can be Read & write or Read only. The seed pack is two distinguishable worlds and does not wipe a vault you already have. Agents Vault holds `partner.md`, `writer.md`, `analyst.md`, and `archivist.md`, with Reveal and Clear agent memory. Sync & Backup is a Coming soon page with no sync service behind it. ([#1641](https://github.com/SkyyPlayz/Mythos-Writer/pull/1641))
- **Timeline calendars per world.** Each world has its own months, days, and hours. Year ratio vs parent is calculated and can't be typed over. Event cards and the Inspector show Local and Standard dates. A sync playhead can be armed and placed (a blank click does not place it). The vertical board zooms from 40% to 160%. The right panel is Inspector and your partner. Structure's card view is resizable, the book title on the story is editable, and `[[` suggestions include story titles and board cards. ([#1642](https://github.com/SkyyPlayz/Mythos-Writer/pull/1642))

### Removed

- **Demo, the tour, and the walkthrough** (title-bar Demo, TourModal, and the Timeline Demo badge). ([#1637](https://github.com/SkyyPlayz/Mythos-Writer/pull/1637), [#1638](https://github.com/SkyyPlayz/Mythos-Writer/pull/1638))
- **Quick Entry.** ([#1638](https://github.com/SkyyPlayz/Mythos-Writer/pull/1638))

### Fixed

- **Windows uninstall can delete your vaults only if you opt in.** The checkbox is unchecked by default, so uninstall keeps your writing. Deletes are limited to an allowlist, and paths that use `.` or `..` are rejected. ([#1630](https://github.com/SkyyPlayz/Mythos-Writer/pull/1630), [#1632](https://github.com/SkyyPlayz/Mythos-Writer/pull/1632), [#1633](https://github.com/SkyyPlayz/Mythos-Writer/pull/1633))

### Internal

- Fail-closed Mythos gate checks and a minor-and-patch dependency bump. ([#1634](https://github.com/SkyyPlayz/Mythos-Writer/pull/1634), [#1636](https://github.com/SkyyPlayz/Mythos-Writer/pull/1636), [#1624](https://github.com/SkyyPlayz/Mythos-Writer/pull/1624))

## [0.5.5] — 2026-09-28

_Draft release that was never published._

_Record is thin: the GitHub release body repeats older commits. The only change after 0.5.4.5 is the packaging fix below._

### Fixed

- **The app version is 0.5.5, which installers can package.** electron-builder rejected `0.5.4.5` as an invalid version, so Linux and Windows release builds failed. ([#1623](https://github.com/SkyyPlayz/Mythos-Writer/pull/1623))

## [0.5.4.5] — 2026-09-27

_Draft release that was never published._

_The GitHub release body is “Release build in progress…”. This section is from the pull request._

### Changed

- **Nested chrome and press motion.** Panels use nested corner radii, buttons scale slightly when pressed, menus grow from the control that opened them, and the motion is skipped when you prefer reduced motion. The command palette stays instant. Empty states use the same chrome. The package version on this build was `0.5.4.5` (replaced by 0.5.5 so installers can build). ([#1622](https://github.com/SkyyPlayz/Mythos-Writer/pull/1622))

## [0.5.4]

_Never published. No git tag and no GitHub release, draft or otherwise. Slice 1 merged 2026-09-25 and slice 2 merged 2026-09-26, while `package.json` was still 0.5.3._

### Added

- **Boards in the left nav, a Scene Crafter story dropdown, and an auto node board from Create Scene.** Idea Board replaces Brainstorm in the navigation, and Timeline opens on Structure. ([#1618](https://github.com/SkyyPlayz/Mythos-Writer/pull/1618))

### Changed

- **All AI features has a master switch.** Turning it off stops AI network calls and AI entry points; turning it back on restores them. Auto-apply, including Grammar, migrates to off once, the first time you open the app on this version. ([#1621](https://github.com/SkyyPlayz/Mythos-Writer/pull/1621))
- **Full Book chrome, type size, and menus.** The Full Book sidebar and tabs reach the top of the window. App text size runs from 82% to 118%, using Ctrl+scroll or Ctrl with +, −, or 0. Settings dropdowns use a dark background. ([#1621](https://github.com/SkyyPlayz/Mythos-Writer/pull/1621))
- **Glow and ambient animation default to off.** ([#1618](https://github.com/SkyyPlayz/Mythos-Writer/pull/1618))

### Removed

- **Archivist.** The Archive Agent hand, its settings card, and the Archive Timeline tab are removed. The transcript can be shown in the chat or in a separate view. ([#1621](https://github.com/SkyyPlayz/Mythos-Writer/pull/1621))

### Fixed

- **Vault and editor bugs from the 0.5.4 slice.** Creating a Notes vault refreshes the picker. Genre starter notes use the grouped Notes path. A failed import says to check the path and try again, and the folder picker shows that it is busy. Scene Crafter falls back to the first story, and the scene list refreshes when vault files change. The Story tab and manuscript Structure stay mounted when you leave them. With a split open, the story navigator targets the focused pane. Markdown images render in the editor. The vault menu includes "Remove from Mythos…". ([#1618](https://github.com/SkyyPlayz/Mythos-Writer/pull/1618))

### Internal

- Release-tag normalization, a dependency bump, and CI hygiene. ([#1610](https://github.com/SkyyPlayz/Mythos-Writer/pull/1610), [#1611](https://github.com/SkyyPlayz/Mythos-Writer/pull/1611), [#1619](https://github.com/SkyyPlayz/Mythos-Writer/pull/1619), [#1620](https://github.com/SkyyPlayz/Mythos-Writer/pull/1620))

## [0.5.3] — 2026-09-19

_Draft release that was never published._

_The GitHub release body is a commit list. Wording is from the pull requests._

### Added

- **Timelines can use more than one calendar.** A timeline can record where its year 0 falls in standard time, what that world calls year zero, and an era suffix. One timeline is the universal standard. ([#1605](https://github.com/SkyyPlayz/Mythos-Writer/pull/1605))
- **Create-vault chooser.** New vault starts with Create blank or Import vault, then asks for the name and folder. Create blank makes an empty Story vault and Notes vault. ([#1607](https://github.com/SkyyPlayz/Mythos-Writer/pull/1607))

### Changed

- **Command palette and the Welcome window use the same denser overlay glass** as Settings. ([#1608](https://github.com/SkyyPlayz/Mythos-Writer/pull/1608))

### Fixed

- **An imported Obsidian vault shows its notes and scenes.** The copy was already on disk; the app now reindexes the story vault after import. Settings → Vaults layout was reordered in the same change. ([#1606](https://github.com/SkyyPlayz/Mythos-Writer/pull/1606))

### Internal

- Mythos gate auto-merge, the visual-regression auto-squash bypass removal, and Bugbot creed rules. ([#1602](https://github.com/SkyyPlayz/Mythos-Writer/pull/1602), [#1603](https://github.com/SkyyPlayz/Mythos-Writer/pull/1603), [#1604](https://github.com/SkyyPlayz/Mythos-Writer/pull/1604))

## [0.5.2] — 2026-09-17

_Tag date 2026-09-17. The GitHub release body is a commit list. Wording is from the pull requests._

### Added

- **Boards chrome.** Add furniture and Connector sit in the top toolbar, double-clicking a note card opens it, Set thumbnail stores an image on the note, and folders use the Liquid Neon glyphs. The center pane is denser glass, and an empty board keeps its empty state. ([#1592](https://github.com/SkyyPlayz/Mythos-Writer/pull/1592), [#1599](https://github.com/SkyyPlayz/Mythos-Writer/pull/1599))
- **Lines between paired Notes and Story vaults** on Vaults & Files, so you can see which pairs keep wiki-links intact. ([#1594](https://github.com/SkyyPlayz/Mythos-Writer/pull/1594))
- **Create a Mythos vault dialog** from the rail and from Settings, with name, folder, Browse, and Default folder. Settings still offers template, blank, and import. ([#1595](https://github.com/SkyyPlayz/Mythos-Writer/pull/1595))
- **Vaults & Files sections sit on glass cards.** ([#1596](https://github.com/SkyyPlayz/Mythos-Writer/pull/1596))

### Changed

- **Overlay glass is denser.** Menus, popovers, toasts, and Settings use a fill of at least 50%. Full-page shells still do not use a live blur. ([#1600](https://github.com/SkyyPlayz/Mythos-Writer/pull/1600))
- **Settings closes** when you click another module on the left rail, or the X in the header. ([#1593](https://github.com/SkyyPlayz/Mythos-Writer/pull/1593))

### Fixed

- **Quitting on Windows and Linux no longer hangs** on the window X. The close is treated as a real quit, so a Brainstorm prompt cannot leave the process running. ([#1597](https://github.com/SkyyPlayz/Mythos-Writer/pull/1597))
- **Less glass jank.** Brainstorm, Entries, Manuscript Structure, and Scene Crafter no longer run a live blur across the whole page. ([#1598](https://github.com/SkyyPlayz/Mythos-Writer/pull/1598))

## [0.5.1] — 2026-09-16

_Tag date 2026-09-16. The GitHub release body is “Release build in progress…”. Entries are from the pull requests merged after the 0.5.0-beta.4 version bump (2026-09-02) through this tag. Draft releases v0.5.0-beta.2, v0.5.0-beta.3, and v0.5.0-beta.4 are not given sections here. CI, dependency, and design-token cleanup pulls in this range are left out._

### Added

- **Notes Board.** A Boards tab with a canvas: auto-layout, zoom, pan, resize, grid snap, furniture (columns, checks, tables, images, sketches, swatches, connectors), per-item icons and colours, cross-board search, a wiki-link overlay, and a minimap. Note and board tools create real files, names can be edited on the canvas, and delete goes to a Recently Deleted list you can undo with Ctrl+Z before it reaches the system trash. Ideas from Brainstorm can be filed onto a board by hand. ([#1424](https://github.com/SkyyPlayz/Mythos-Writer/pull/1424), [#1494](https://github.com/SkyyPlayz/Mythos-Writer/pull/1494), [#1512](https://github.com/SkyyPlayz/Mythos-Writer/pull/1512), [#1513](https://github.com/SkyyPlayz/Mythos-Writer/pull/1513), [#1495](https://github.com/SkyyPlayz/Mythos-Writer/pull/1495), [#1532](https://github.com/SkyyPlayz/Mythos-Writer/pull/1532), [#1539](https://github.com/SkyyPlayz/Mythos-Writer/pull/1539), [#1533](https://github.com/SkyyPlayz/Mythos-Writer/pull/1533))
- **Kokoro offline voices.** `kokoro:nicole` and `kokoro:sky` play on-device neural speech. A fresh install uses Nicole. An install that already saved a voice keeps it. ([#1417](https://github.com/SkyyPlayz/Mythos-Writer/pull/1417), [#1505](https://github.com/SkyyPlayz/Mythos-Writer/pull/1505))
- **Vault & Files settings.** The page shows the vaults folder, Open folder, Move, inline rename, and Notes and Story columns with pairing dots, Hide, and Delete. ([#1419](https://github.com/SkyyPlayz/Mythos-Writer/pull/1419))
- **Story-vault picker** on the left rail: create, list, switch, rename, and pair, separate from the story navigator. ([#1426](https://github.com/SkyyPlayz/Mythos-Writer/pull/1426))
- **Choose where a new vault is created.** Name and folder, defaulting to the current vault's parent. New vaults no longer land only under the app data folder, and creating one no longer seeds the sample story. ([#1439](https://github.com/SkyyPlayz/Mythos-Writer/pull/1439))
- **First-run and add-vault flow.** Three cards: template, blank, or import. Import has separate Notes and Story rows. Every path asks for a name and a folder and shows the path it will create. ([#1408](https://github.com/SkyyPlayz/Mythos-Writer/pull/1408))
- **Production-team roles.** Alpha Reader, Storyline Consultant, and Line Editor, off unless you turn them on. Reader roles omit entity facts that the story has not revealed yet. Beta Reader's live report uses that filtered context. ([#1425](https://github.com/SkyyPlayz/Mythos-Writer/pull/1425), [#1446](https://github.com/SkyyPlayz/Mythos-Writer/pull/1446), [#1448](https://github.com/SkyyPlayz/Mythos-Writer/pull/1448))
- **Wiki autonomy.** Off, always ask, or auto. The default is always ask, which files a Brainstorm question instead of writing the vault. ([#1420](https://github.com/SkyyPlayz/Mythos-Writer/pull/1420))
- **Rebuild my timeline.** Its own command, separate from continuity check, and it only rewrites agent events on the active timeline. ([#1422](https://github.com/SkyyPlayz/Mythos-Writer/pull/1422))
- **Timeline event wiki-links** resolve to a scene, chapter, note, or folder, and you can open the match. ([#1506](https://github.com/SkyyPlayz/Mythos-Writer/pull/1506))
- **Theme-match wallpaper cycle.** Every Liquid Neon preset ships several wallpapers. Arrows on the Theme match tile (Settings → Appearance → Background) cycle them, and the pick persists per vault. ([#1503](https://github.com/SkyyPlayz/Mythos-Writer/pull/1503), [#1529](https://github.com/SkyyPlayz/Mythos-Writer/pull/1529))
- **Per-vault appearance.** Each vault keeps its own theme and Liquid Neon settings, and switching vaults repaints immediately. ([#1402](https://github.com/SkyyPlayz/Mythos-Writer/pull/1402))
- **The book title sits centered** at the top of the manuscript. ([#1431](https://github.com/SkyyPlayz/Mythos-Writer/pull/1431))

### Changed

- **Theme "Neon Classic" is now "Neon Nebula".** Display name only; the stored preset key is unchanged. ([#1503](https://github.com/SkyyPlayz/Mythos-Writer/pull/1503))
- **The Brainstorm board is named Idea Board** and is stored in the Agent Vault, not as a raw JSON file in your notes. ([#1432](https://github.com/SkyyPlayz/Mythos-Writer/pull/1432), [#1434](https://github.com/SkyyPlayz/Mythos-Writer/pull/1434))
- **New vaults use `Stories/` and `Notes/` folders.** Existing vaults stay where they are. ([#1514](https://github.com/SkyyPlayz/Mythos-Writer/pull/1514))
- **Drop cap is a setting, off by default.** ([#1396](https://github.com/SkyyPlayz/Mythos-Writer/pull/1396))
- **Beta Reader is one agent.** The Writing Assistant no longer intercepts a beta-read request and runs a second panel. ([#1398](https://github.com/SkyyPlayz/Mythos-Writer/pull/1398))
- **Notes sidebar.** Continuity flags and the Brainstorm chat are separate full-height tabs. ([#1395](https://github.com/SkyyPlayz/Mythos-Writer/pull/1395))
- **A chapter note renders under its chapter heading** in the editor. ([#1435](https://github.com/SkyyPlayz/Mythos-Writer/pull/1435))
- **Settings and popup glass follows the opacity slider** (overlay fill is the glass value plus 10 points, capped at 96). ([#1591](https://github.com/SkyyPlayz/Mythos-Writer/pull/1591))
- **Create Scene keeps the setup you typed** (POV, goal, conflict, beats, tone, and length) on the new scene. ([#1410](https://github.com/SkyyPlayz/Mythos-Writer/pull/1410))

### Removed

- **Branded cloud/sync surface.** The Move Vault wizard's cloud destination (Dropbox, iCloud Drive, OneDrive, Google Drive), the vault sync badge, cloud-provider detection on the vault path, and the conflicted-copy scanner that rearranged files matching those providers' naming patterns. A vault is plain files in a folder you choose. Moving a vault to a different local folder is unchanged. The concurrent-session lockfile stays. ([#1566](https://github.com/SkyyPlayz/Mythos-Writer/pull/1566))
- **"No background" wallpaper.** A stored `none` wallpaper falls back to Theme match. ([#1503](https://github.com/SkyyPlayz/Mythos-Writer/pull/1503))
- **The vault-format upgrade prompt.** Older vaults migrate without a Settings card or a boot-time choice. ([#1530](https://github.com/SkyyPlayz/Mythos-Writer/pull/1530))

### Fixed

- **Notes no longer appear in the wrong vault** after you switch. Open note tabs are stored per vault, so one vault's tabs are not left open on another. ([#1440](https://github.com/SkyyPlayz/Mythos-Writer/pull/1440), [#1403](https://github.com/SkyyPlayz/Mythos-Writer/pull/1403))
- **The window can always be closed,** including when a panel tries to cancel unload. ([#1437](https://github.com/SkyyPlayz/Mythos-Writer/pull/1437))
- **Closing the window flushes the scene or note you were typing.** ([#1515](https://github.com/SkyyPlayz/Mythos-Writer/pull/1515))
- **Word (.docx) story import creates chapters and scenes** and names the files it skipped, instead of reporting success with an empty vault. ([#1572](https://github.com/SkyyPlayz/Mythos-Writer/pull/1572))
- **Delete and Hide find a custom-named story vault,** so a second world is not left behind. ([#1580](https://github.com/SkyyPlayz/Mythos-Writer/pull/1580))
- **Kokoro loads on Windows.** Packaged builds passed a drive-letter path that Windows could not import. ([#1582](https://github.com/SkyyPlayz/Mythos-Writer/pull/1582))
- **Older Notes vaults still migrate.** Session and Brainstorm-board migration looks at the flat Notes Vault that existed before the grouped folders. ([#1583](https://github.com/SkyyPlayz/Mythos-Writer/pull/1583))
- **Beta Reader reports from local reasoning models** show the report, or an error, instead of silently reverting. ([#1570](https://github.com/SkyyPlayz/Mythos-Writer/pull/1570))
- **Body text stays readable over bright wallpapers.** Each panel gets a backing tuned to that wallpaper. ([#1565](https://github.com/SkyyPlayz/Mythos-Writer/pull/1565))
- **A Boards column link still opens after the note is renamed.** ([#1563](https://github.com/SkyyPlayz/Mythos-Writer/pull/1563))
- **Escape closes a dropdown** even when focus is outside its menu. ([#1567](https://github.com/SkyyPlayz/Mythos-Writer/pull/1567))
- **After you move a vault, open views drop the old path.** ([#1571](https://github.com/SkyyPlayz/Mythos-Writer/pull/1571))
- **Renaming a vault writes the new name through.** ([#1473](https://github.com/SkyyPlayz/Mythos-Writer/pull/1473))
- **Custom note templates can be created and edited again.** ([#1511](https://github.com/SkyyPlayz/Mythos-Writer/pull/1511))
- **Paragraph drag shows a preview and a gap.** ([#1442](https://github.com/SkyyPlayz/Mythos-Writer/pull/1442))
- **The active vault tile stays on the vault you switched to.** ([#1441](https://github.com/SkyyPlayz/Mythos-Writer/pull/1441))
- **Provider settings adapt when the provider is not Anthropic.** ([#1397](https://github.com/SkyyPlayz/Mythos-Writer/pull/1397))
- **The vault graph's story-cluster toggle loads manuscript nodes.** ([#1394](https://github.com/SkyyPlayz/Mythos-Writer/pull/1394))
- **Brainstorm uses the one right sidebar** instead of a second column. ([#1388](https://github.com/SkyyPlayz/Mythos-Writer/pull/1388))

## [0.5.0-beta.1] — 2026-07-23

**"Liquid Neon · Refined."** Beta 4 closes the gap between the Beta 3 shell and the approved v2 prototype across integrity/performance, fidelity, and 29 build milestones (build plan: [`docs/releases/BETA-REFINE.md`](docs/releases/BETA-REFINE.md)).

### Wave 0 — Integrity & performance (shipped first, per owner decision B4-7)

- **Seed-once vaults + notes-tree hygiene** — vault seeding runs exactly once (marker in vault metadata); story-internal scene-UUID folders no longer leak into the Notes tree. ([PR #903](https://github.com/SkyyPlayz/Mythos-Writer/pull/903))
- **Frontmatter never renders as headings** — a shared strip engine gives lossless round-trip between Rich view and raw YAML frontmatter. ([PR #901](https://github.com/SkyyPlayz/Mythos-Writer/pull/901))
- **Right-panel layout collisions + single editor chrome** fixed. ([PR #902](https://github.com/SkyyPlayz/Mythos-Writer/pull/902))
- **20fps → 60fps**: opaque window (frame ring removed), pre-blurred glass, transform-only animations, and a faster typing path. ([PR #905](https://github.com/SkyyPlayz/Mythos-Writer/pull/905))
- **Boot-race + manifest fixes**: vault-not-found boot race eliminated, `manifest.json` made structure-only for O(1) scene saves, self-write watcher suppression, incremental reindex/FTS, DB growth/retention guards. ([PR #904](https://github.com/SkyyPlayz/Mythos-Writer/pull/904), [#932](https://github.com/SkyyPlayz/Mythos-Writer/pull/932), [#889](https://github.com/SkyyPlayz/Mythos-Writer/pull/889), [#890](https://github.com/SkyyPlayz/Mythos-Writer/pull/890))
- Wave 0 gate signed off by the owner 2026-07-11; version bumped to `0.5.0-beta.0` for the smoke build. ([PR #906](https://github.com/SkyyPlayz/Mythos-Writer/pull/906), [#907](https://github.com/SkyyPlayz/Mythos-Writer/pull/907))

### Added — 29 build milestones

- **M1 Theme engine refresh** — preset import/export, per-vault theme, interface card, global scrollbars. ([#909](https://github.com/SkyyPlayz/Mythos-Writer/pull/909))
- **M2 Title bar & status bar parity** — vault switcher, real menus, search field, bell deep-links, one status bar. ([#908](https://github.com/SkyyPlayz/Mythos-Writer/pull/908))
- **M3 Nav rail v2** — labels, edit popover, stories switcher, New Story wizard. ([#911](https://github.com/SkyyPlayz/Mythos-Writer/pull/911))
- **M4 Workspace tabs as documents** — provisional scenes, split panes, tab context menu. ([#910](https://github.com/SkyyPlayz/Mythos-Writer/pull/910))
- **M5 MythosVault format** — single-folder files-first storage, migration wizard, demo seed. ([#912](https://github.com/SkyyPlayz/Mythos-Writer/pull/912))
- **M6 Auto Note Linker** — built-in deterministic wiki-linking. ([#916](https://github.com/SkyyPlayz/Mythos-Writer/pull/916))
- **M7 Editor chrome & page parity** — DocHeader, MarginRuler, PageSetupPopover, custom page texture. ([#915](https://github.com/SkyyPlayz/Mythos-Writer/pull/915), [#937](https://github.com/SkyyPlayz/Mythos-Writer/pull/937))
- **M8 Editing model hardening** — split/merge/drop-cap/status-cycle/grip-drag/scene-hops. ([#941](https://github.com/SkyyPlayz/Mythos-Writer/pull/941))
- **M9 Comments v2** — selection composer, kinds, gutter cards, vault sidecar storage. ([#953](https://github.com/SkyyPlayz/Mythos-Writer/pull/953))
- **M10 Drafts v2** — compare split, full diff, load with exact undo, snapshot settings. ([#945](https://github.com/SkyyPlayz/Mythos-Writer/pull/945))
- **M11 TTS Reader refinements** — gutter dock, full transport, sentence highlight, audiobook bar. ([#938](https://github.com/SkyyPlayz/Mythos-Writer/pull/938))
- **M12 Writing Coach** — Coach page, suggestions rail, shared conversation store. ([#952](https://github.com/SkyyPlayz/Mythos-Writer/pull/952))
- **M13 Scene analysis** — computed local metrics feeding the Coach's Read AI split. ([#956](https://github.com/SkyyPlayz/Mythos-Writer/pull/956))
- **M14 Structure & export** — grid/list Structure view, Book preview, export modal to prototype parity. ([#939](https://github.com/SkyyPlayz/Mythos-Writer/pull/939))
- **M15 Agent hub** — right-panel agent hub, session store, AgentSessionPicker. ([#917](https://github.com/SkyyPlayz/Mythos-Writer/pull/917))
- **M16 Explorer parity** — Explorer toolbar + tree parity. ([#920](https://github.com/SkyyPlayz/Mythos-Writer/pull/920))
- **M17 Note body parity** — title/tags/modes, callouts, backlinks, wiki-link hover + create. ([#940](https://github.com/SkyyPlayz/Mythos-Writer/pull/940))
- **M18 Notes right panel** — Curator greeting, CONTINUITY FLAGS badge, M9 label parity. ([#963](https://github.com/SkyyPlayz/Mythos-Writer/pull/963))
- **M19 Scene Crafter refresh** — canvas, draft cards, mini scenes panel. ([#973](https://github.com/SkyyPlayz/Mythos-Writer/pull/973))
- **M20 Brainstorm unification** — one board, shared sessions, starter library, migration. ([#958](https://github.com/SkyyPlayz/Mythos-Writer/pull/958))
- **M21 Timeline data model** — `timelines.json` codec, calendar system, migration. ([#914](https://github.com/SkyyPlayz/Mythos-Writer/pull/914))
- **M22 Timeline axis engine** — eras bar, adaptive ticks, zoom, direct manipulation, auto-stacking. ([#951](https://github.com/SkyyPlayz/Mythos-Writer/pull/951))
- **M23 Timeline lane rows** — Progress mode + full mode-seg toolbar. ([#957](https://github.com/SkyyPlayz/Mythos-Writer/pull/957))
- **M24 Timeline remaining view modes** — Plotlines, Tension, Spreadsheet rebuilt onto `timelines.json`; Relationships/Subway rebuilt as native-table/roving-tabindex a11y depth per spec. ([#1040](https://github.com/SkyyPlayz/Mythos-Writer/pull/1040), [#1077](https://github.com/SkyyPlayz/Mythos-Writer/pull/1077))
- **M25 Timeline right panel** — Inspector + Archive auto-build from vault plans and written scenes. ([#1010](https://github.com/SkyyPlayz/Mythos-Writer/pull/1010))
- **M26 Vault graph refinements** — category controls, physics sliders, node card, cluster toggle. ([#955](https://github.com/SkyyPlayz/Mythos-Writer/pull/955))
- **M27 Beta Reader agent view** — reports, reactions, margin comments. ([#965](https://github.com/SkyyPlayz/Mythos-Writer/pull/965))
- **M28 Settings workspace** — routed full view, BYO providers, autonomy card, vault & import pages. ([#959](https://github.com/SkyyPlayz/Mythos-Writer/pull/959))
- **M29 Welcome wizard** — onboarding polish, spec-compliant restore after a lost PR, design-QA delta fixes. ([#998](https://github.com/SkyyPlayz/Mythos-Writer/pull/998), [#1007](https://github.com/SkyyPlayz/Mythos-Writer/pull/1007), [#1031](https://github.com/SkyyPlayz/Mythos-Writer/pull/1031))

### Fixed & hardened

- **Accessibility sweep** — keyboard operability for Scene Crafter canvas (WCAG 2.1.1), target-size/focus-outline polish, ReaderBar `aria-pressed`/focus-visible/Escape/transport labels, Timeline keyboard-a11y layer across 5 view modes. ([#1043](https://github.com/SkyyPlayz/Mythos-Writer/pull/1043), [#1044](https://github.com/SkyyPlayz/Mythos-Writer/pull/1044), [#1041](https://github.com/SkyyPlayz/Mythos-Writer/pull/1041))
- **Import & migration verification** — real (non-stubbed) E2E for Obsidian import fidelity, docx story import, and Move-vault; hard-fail migration verification on cloud-sync placeholders; Obsidian-parity folder operations in the Notes Vault. ([#1051](https://github.com/SkyyPlayz/Mythos-Writer/pull/1051), [#1053](https://github.com/SkyyPlayz/Mythos-Writer/pull/1053), [#1055](https://github.com/SkyyPlayz/Mythos-Writer/pull/1055), [#1056](https://github.com/SkyyPlayz/Mythos-Writer/pull/1056), [#1048](https://github.com/SkyyPlayz/Mythos-Writer/pull/1048), [#1049](https://github.com/SkyyPlayz/Mythos-Writer/pull/1049))
- **Data-model & IPC fixes** — manifest schema split (single-stringify write, wordCount fix), scene prose stripped from manifest IPC payload (hydrated on vault-open), timeline IPC rerouted off the incompatible legacy schema. ([#999](https://github.com/SkyyPlayz/Mythos-Writer/pull/999), [#1059](https://github.com/SkyyPlayz/Mythos-Writer/pull/1059), [#931](https://github.com/SkyyPlayz/Mythos-Writer/pull/931))
- **Voice/agent fixes** — unified push-to-talk, per-agent Brainstorm voice, real whisper.cpp/Piper spawn E2E (incl. native Windows), distinct network-vs-auth AI provider errors. ([#1030](https://github.com/SkyyPlayz/Mythos-Writer/pull/1030), [#1037](https://github.com/SkyyPlayz/Mythos-Writer/pull/1037), [#1045](https://github.com/SkyyPlayz/Mythos-Writer/pull/1045), [#1038](https://github.com/SkyyPlayz/Mythos-Writer/pull/1038), [#1072](https://github.com/SkyyPlayz/Mythos-Writer/pull/1072))
- **CI & release infra** — required screenshot check for UI-milestone PRs, flattened CI graph, path-based e2e sharding for docs-only PRs, permanent perf-regression guard for `scene:save`, one-button release-prep automation, tag-race fix between version-commit and draft-release creation. ([#1046](https://github.com/SkyyPlayz/Mythos-Writer/pull/1046), [#1063](https://github.com/SkyyPlayz/Mythos-Writer/pull/1063), [#1064](https://github.com/SkyyPlayz/Mythos-Writer/pull/1064), [#1036](https://github.com/SkyyPlayz/Mythos-Writer/pull/1036), [#1065](https://github.com/SkyyPlayz/Mythos-Writer/pull/1065), [#1083](https://github.com/SkyyPlayz/Mythos-Writer/pull/1083))

## [0.4.0-beta.1] — 2026-07-07

**The "Liquid Neon" release.** Beta 3 rebuilds Mythos Writer around the approved Liquid Neon prototype — neon-bordered glass panels floating over animated, user-changeable backgrounds — and fills out the app's full product shape across 26 milestones (build plan: [`docs/releases/BETA-LIQUID-NEON.md`](docs/releases/BETA-LIQUID-NEON.md)).

### Added

- **Liquid Neon theme engine + 10 animated presets** — A six-slot color engine now drives every panel border, glow, and gradient in the app. Ten presets (Neon Classic, Aurora, Cyberpunk, Sunset Coast, Emberfall, Ice Mono, Verdant Reach, Royal Arcana, Noir Rose, Winterlight) each pair slot colors with their own background and animated ambience layer (stardust, rain, embers, snow, spores…); neon animation modes (Off / Cycle / Sparkle) animate panel borders and a window frame ring; wallpaper is theme-matched, custom-uploaded, or fully transparent ("No background"); the rebuilt Appearance page exposes per-slot color wheels plus intensity/glass/blur/scrim/border/glow sliders, all respecting `prefers-reduced-motion`. ([PR #848](https://github.com/SkyyPlayz/Mythos-Writer/pull/848), [#849](https://github.com/SkyyPlayz/Mythos-Writer/pull/849), [#851](https://github.com/SkyyPlayz/Mythos-Writer/pull/851), [#852](https://github.com/SkyyPlayz/Mythos-Writer/pull/852))
- **New app shell** — A real title bar with working File/Edit/View/Insert/Tools/Help menus, a Ctrl+K command palette (commands, notes, scenes), a notification center whose agent events deep-link to their source, and an account entry; workspace tabs v2 with a right-click menu (open to the side as a split pane, pop out, close) and an agents-activity chip; nav rail v2 with six modules (Story Writer, Notes, Scene Crafter, Brainstorm, Timeline, Vault Graph), a slim icon-only mode, per-universe vault tiles, and a Stories popover that creates a story plus its Story Plan note; glass panels throughout and a live word/character/read-time status bar. ([PR #853](https://github.com/SkyyPlayz/Mythos-Writer/pull/853), [#855](https://github.com/SkyyPlayz/Mythos-Writer/pull/855), [#856](https://github.com/SkyyPlayz/Mythos-Writer/pull/856), [#854](https://github.com/SkyyPlayz/Mythos-Writer/pull/854))
- **Heading-zoom manuscript** — The manuscript is one continuous document: zoom Full Book → Part → Chapter → Scene, hop same-level siblings with arrows or keys, collapse headings, click-cycle scene status dots, and drag scenes to restructure — while scene files remain the storage unit with the same per-scene backup contract as Beta 2. ([PR #857](https://github.com/SkyyPlayz/Mythos-Writer/pull/857))
- **Toolbar v2, page modes, draggable blocks & page ruler** — A Word-like toolbar (paragraph style / font / size dropdowns, Read / Dictate / Assist), page modes (Neon / No glow / Scroll parchment / Off), paragraph drag handles with a drop-line indicator, and page-width control via edge drag or the new Word-style ruler (520–3000 px) — closing the long-standing page-width ([#842](https://github.com/SkyyPlayz/Mythos-Writer/issues/842)) and editable-full-book ([#843](https://github.com/SkyyPlayz/Mythos-Writer/issues/843)) requests. ([PR #873](https://github.com/SkyyPlayz/Mythos-Writer/pull/873))
- **Margin comments** — Select text to comment; comments dock in a kind-colored gutter aligned to their anchors, agent comments carry three actions (edit notes to match / suggest story change / ignore), and Focus mode hides the gutter with an override. ([PR #872](https://github.com/SkyyPlayz/Mythos-Writer/pull/872))
- **Drafts & visual diff** — A drafts popover in the editor header (per-document list, snapshot frequency and keep-count settings), side-by-side previous-draft view with inline highlight-changes, and a full-diff view with a draft selector. ([PR #859](https://github.com/SkyyPlayz/Mythos-Writer/pull/859))
- **TTS Reader** — A Speechify-style audiobook bar on the manuscript: moving paragraph highlight synced to speech, scene and utterance skips, 50–200% speed, a voice picker over your configured engines, and read-from-cursor / from-start / selection. ([PR #874](https://github.com/SkyyPlayz/Mythos-Writer/pull/874))
- **Structure view, Book preview & export dialog** — Grid/list scene cards with drag restructure and a Save-the-Cat beat-sheet panel; a compiled read-only Book preview; and an export dialog that adds PDF alongside DOCX/EPUB with scope, synopsis, and separator options. ([PR #861](https://github.com/SkyyPlayz/Mythos-Writer/pull/861))
- **Notes tree v2 + templates** — The vault tree gains drag move/reorder and a context menu (open in new tab, beta read, continuity check, rename, delete), a template picker (Character, Location, Faction, Item/System, Event/History, Blank) creating correctly-frontmattered notes, and a per-universe vault switcher. ([PR #860](https://github.com/SkyyPlayz/Mythos-Writer/pull/860))
- **Wiki-link parity, metadata panels & note splits** — Obsidian-style hover preview cards on `[[links]]`, clicking an unresolved notes link creates the note, frontmatter-backed Properties and tag editing, a live Backlinks panel, and drag-resizable note splits with both panes editable. ([PR #876](https://github.com/SkyyPlayz/Mythos-Writer/pull/876))
- **Canvas board engine** — Obsidian-canvas-style boards: draggable corner-resizable cards with per-slot neon borders, bezier connectors, pan and scroll-zoom with Fit, and `.canvas`-style JSON persisted in the Notes Vault. ([PR #858](https://github.com/SkyyPlayz/Mythos-Writer/pull/858))
- **Scene Crafter v2** — Scene Setup (title/POV/goal/conflict, beats, tone chips, length), a searchable suggested-cards panel, plan cards from vault Story Plans with a Draft-board button onto the canvas engine, and a live mini canvas in the editor's right panel. ([PR #864](https://github.com/SkyyPlayz/Mythos-Writer/pull/864))
- **Brainstorm center** — The Brainstorm page becomes a four-mode center: restyled agent chat plus Board, Map, and Clusters visualizations of the session's vault ideas, a live agent-activity feed, suggestion chips, and idea search. ([PR #871](https://github.com/SkyyPlayz/Mythos-Writer/pull/871))
- **Timeline v2 (Aeon-class)** — Five views over the same event data — Plan-vs-Progress, Structure, Spreadsheet, Relationships, and per-character Subway lines — with eras, arcs, chapter strips, filters, and a minimap scrubber. ([PR #862](https://github.com/SkyyPlayz/Mythos-Writer/pull/862))
- **Vault graph v2** — Star-glow nodes colored by category, drag-to-pin, force-sim re-layout, per-category color wheels, distinct note↔note vs story↔note link colors, a Story cluster toggle, and a node inspector. ([PR #863](https://github.com/SkyyPlayz/Mythos-Writer/pull/863))
- **Four named agents + identity files** — The new Beta Reader agent reads chapters and files reactions as margin comments; all four agents (Writing Assistant, Brainstorm, Archive, Beta Reader) are renameable, carry editable identity files (`agent.md` / `instructions.md` / `learning.md` / `soul.md`) that genuinely shape behavior, and get per-agent provider/model and autonomy toggles. ([PR #878](https://github.com/SkyyPlayz/Mythos-Writer/pull/878))
- **Archive plumbing** — Continuity flags surface as actionable margin comments with the three agent actions, auto-`[[link]]`ing is verified against the new editor, and the timeline auto-builds from vault plans plus written scenes with planned-vs-written classification. (M23)
- **Settings remainder + vault & story import** — Account & profile, Editor, Sync & Backup, Shortcuts, and About pages; Import vault (Obsidian / Notion / Scrivener / Markdown) with a dry-run→confirm wizard; Import story (docx / Google Docs export / Markdown / Scrivener / ePub) mapping headings to parts/chapters/scenes plus a Story Plan note. ([PR #877](https://github.com/SkyyPlayz/Mythos-Writer/pull/877))
- **Welcome wizard v2** — Liquid Neon restyle of the first-run wizard plus a new Guided Setup path (location → template → genre → neon theme) driven by the real preset engine. ([PR #875](https://github.com/SkyyPlayz/Mythos-Writer/pull/875))

### Fixed

- **Beta 3 stabilization** — E2E-verified fixes on the new shell: the create-vault control restored to the title bar, menu layering, the Stories-popover focus trap, accessibility labels, and neon-frozen performance gates. ([PR #866](https://github.com/SkyyPlayz/Mythos-Writer/pull/866))
- **Preflight gate is no longer Linux-only** — `npm run preflight` picks its E2E runner per platform: `xvfb-run` only on headless Linux (unchanged CI behavior), direct execution on macOS/Windows or when a display exists. ([#846](https://github.com/SkyyPlayz/Mythos-Writer/issues/846))

## [0.3.0-beta.2] — 2026-07-03

### Added

- **Split panes** — Drag a workspace tab to the right edge of the window (or Shift+click / Shift+Enter a tab) to open Scene Crafter, Timeline, Entities, Graph, or Brainstorm in a right-hand split pane beside your editor. The pane persists across restarts. ([PR #844](https://github.com/SkyyPlayz/Mythos-Writer/pull/844))
- **Timeline view switcher** — One timeline home with a Spreadsheet | AEON | AEON Track toggle and a group-by control (arc/chapter/character/location); your view choice and grouping persist across restarts. ([PR #838](https://github.com/SkyyPlayz/Mythos-Writer/pull/838))
- **Hear replies in Brainstorm** — Per-reply Hear/Stop buttons and a session mute toggle, matching the Writing Assistant's voice controls. ([PR #841](https://github.com/SkyyPlayz/Mythos-Writer/pull/841))
- **Back up & restore app data** — Buttons in Settings → Vaults export all app-private data (manifests, snapshots, suggestion DB) to a single archive and restore it, with a native file picker and a confirm step. ([PR #839](https://github.com/SkyyPlayz/Mythos-Writer/pull/839))
- **Obsidian vault import** — Onboarding Path 3 now really imports: a dry-run report (file counts, folders, samples) before anything is touched, then import with inline, retryable errors. ([PR #831](https://github.com/SkyyPlayz/Mythos-Writer/pull/831))
- **Text alignment buttons** — Left/center/right/justify in the format toolbar for both Story and Notes editors; unaligned documents stay byte-identical on disk. ([PR #837](https://github.com/SkyyPlayz/Mythos-Writer/pull/837))
- **Chapter interlude text** — Chapter-owned prose (an epigraph or interlude that belongs to no scene) is editable in Chapter view. ([PR #830](https://github.com/SkyyPlayz/Mythos-Writer/pull/830))
- **Heading focus (H1–H6 views)** — Narrow the scene editor to a single heading section, Word-outline style, and step between same-level headings; scene version backups always keep the full text. ([PR #830](https://github.com/SkyyPlayz/Mythos-Writer/pull/830))
- **Nav rail customization that works** — The Settings nav-bar section (items, order, labels/icons, start collapsed) now actually drives the rail; Brainstorm joins the rail; the "+" tab button opens a content picker; on-canvas edge arrows step scenes/chapters from the page edges. ([PR #829](https://github.com/SkyyPlayz/Mythos-Writer/pull/829))
- **Graph quality-of-life** — The Notes/Story/Both scope filter persists across sessions, and scene nodes in the pop-out graph window open in the main window. ([PR #835](https://github.com/SkyyPlayz/Mythos-Writer/pull/835))

### Changed

- **Settings internals re-modularized** — SettingsPanel is a thin orchestrator over extracted section components again (no visible change). ([PR #836](https://github.com/SkyyPlayz/Mythos-Writer/pull/836))
- **Design polish (Part H)** — Low-contrast text fixed to meet the 4.5:1 floor, the worst bare-color CSS migrated to Liquid Neon tokens with a regression ratchet, and reduced-motion now also covers smooth scrolling. ([PR #834](https://github.com/SkyyPlayz/Mythos-Writer/pull/834))

### Fixed

- **Auto-update now works in shipped builds** — Packaged binaries previously had the updater silently disabled by a build-shell-only environment flag; it is now on by default when packaged (`MYTHOS_AUTO_UPDATE=0` remains a kill switch). This is the first release whose binaries can self-update to the next one. ([PR #833](https://github.com/SkyyPlayz/Mythos-Writer/pull/833))
- **Voice is audible and obeys your settings** — Locally- and cloud-synthesized speech is actually played (previously only the OS fallback voice made sound), and volume, rate, voice, persistent mute, microphone device, and input language all take effect; the Writing Assistant mic is reachable in the real app. ([PR #832](https://github.com/SkyyPlayz/Mythos-Writer/pull/832), [#829](https://github.com/SkyyPlayz/Mythos-Writer/pull/829))
- **Notes tab wiki links** — The `[[` autocomplete popup was permanently empty and every link rendered as unresolved in the primary Notes tab. ([PR #829](https://github.com/SkyyPlayz/Mythos-Writer/pull/829))

## [0.3.0-beta.1] — 2026-07-02

### Added

- **App shell overhaul (v0.3 UX)** — An always-mounted navigation rail on the left edge, Settings reorganized into categories, and first-class workspace tabs: reorder tabs with the keyboard, scroll overflowing tab strips, open any panel as a tab, and pick new tabs from a dedicated picker. The nav rail itself is customizable. ([PR #768](https://github.com/SkyyPlayz/Mythos-Writer/pull/768), [#674](https://github.com/SkyyPlayz/Mythos-Writer/pull/674), [#817](https://github.com/SkyyPlayz/Mythos-Writer/pull/817))
- **Wiki links in the editor** — Type `[[` for entity autocomplete with alias support; unresolved links get distinct styling, wiki-link candidates surface in the Notes tab, and links feed the vault graph view. ([PR #821](https://github.com/SkyyPlayz/Mythos-Writer/pull/821), [#814](https://github.com/SkyyPlayz/Mythos-Writer/pull/814))
- **Chapter continuous view** — Read a whole chapter as one flow with per-scene editable bands, a heading-driven (H1–H6) view model, and depth navigation that crosses chapter boundaries. ([PR #664](https://github.com/SkyyPlayz/Mythos-Writer/pull/664), [#684](https://github.com/SkyyPlayz/Mythos-Writer/pull/684), [#790](https://github.com/SkyyPlayz/Mythos-Writer/pull/790))
- **Richer text formatting** — H4–H6 headings, a line-spacing control, and paragraph/heading text alignment that persists across sessions. Notes and Manuscript now share a single rich-text editor core with a formalized mark schema. ([PR #823](https://github.com/SkyyPlayz/Mythos-Writer/pull/823), [#825](https://github.com/SkyyPlayz/Mythos-Writer/pull/825), [#820](https://github.com/SkyyPlayz/Mythos-Writer/pull/820), [#808](https://github.com/SkyyPlayz/Mythos-Writer/pull/808))
- **AEON timeline track interactions** — Hover tooltips, detail popovers, per-track context menus, and full keyboard navigation on timeline tracks; scene markers render only in the visible viewport for smooth scrolling on long timelines. ([PR #816](https://github.com/SkyyPlayz/Mythos-Writer/pull/816), [#824](https://github.com/SkyyPlayz/Mythos-Writer/pull/824))
- **Archive → Scene Crafter suggestions** — The Archive agent can emit scene suggestions directly onto the Scene Crafter board, gated behind a settings toggle. ([PR #822](https://github.com/SkyyPlayz/Mythos-Writer/pull/822))
- **Account modal** — Shows your local profile and app info (version, vault locations) with a reveal-in-file-manager shortcut. ([PR #827](https://github.com/SkyyPlayz/Mythos-Writer/pull/827))
- **Multi-vault graph scope selector** — Choose which vaults feed the graph view. ([PR #778](https://github.com/SkyyPlayz/Mythos-Writer/pull/778))
- **In-app "Clear All Data" control** — Reset the app to a fresh state without hunting for files on disk. ([PR #788](https://github.com/SkyyPlayz/Mythos-Writer/pull/788))
- **Responsive layout clamping** — Sidebars clamp so the editor always retains a usable minimum width on narrow windows. ([PR #704](https://github.com/SkyyPlayz/Mythos-Writer/pull/704))

### Changed

- **Panel homes** — The Brainstorm panel moved into the global right sidebar; Writing Assistant, Continuity, and Preview panels moved to the left sidebar, with pop-out behavior fixed along the way. ([PR #761](https://github.com/SkyyPlayz/Mythos-Writer/pull/761), [#807](https://github.com/SkyyPlayz/Mythos-Writer/pull/807), [#803](https://github.com/SkyyPlayz/Mythos-Writer/pull/803))
- **Sample-project banner** — Now dismissible instead of permanent. ([PR #787](https://github.com/SkyyPlayz/Mythos-Writer/pull/787))

### Fixed

- **Auto-update was silently disabled in every shipped build** — The updater required a runtime environment flag (`MYTHOS_AUTO_UPDATE=1`) that the release pipeline only set in the CI build shell, so no packaged binary ever checked for updates. Packaged builds now auto-update by default; `MYTHOS_AUTO_UPDATE=0` remains as an explicit kill switch, and dev/test builds stay inert.
- **Numeric input validation** — Daily-goal, Timeline word-count, and timestamp day-entry fields no longer accept or mangle partial/invalid numeric input. ([PR #800](https://github.com/SkyyPlayz/Mythos-Writer/pull/800), [#796](https://github.com/SkyyPlayz/Mythos-Writer/pull/796), [#793](https://github.com/SkyyPlayz/Mythos-Writer/pull/793), [#804](https://github.com/SkyyPlayz/Mythos-Writer/pull/804))
- **Errors surfaced instead of swallowed** — NoteViewer saves, draft history, Progress Dashboard streak resets, archive loads, and beta-read scans now report failures to the user instead of silently pretending success. ([PR #792](https://github.com/SkyyPlayz/Mythos-Writer/pull/792), [#795](https://github.com/SkyyPlayz/Mythos-Writer/pull/795), [#791](https://github.com/SkyyPlayz/Mythos-Writer/pull/791), [#786](https://github.com/SkyyPlayz/Mythos-Writer/pull/786), [#785](https://github.com/SkyyPlayz/Mythos-Writer/pull/785))
- **Vault-read resilience** — Unreadable directories are skipped and vault metadata is honored instead of failing the whole vault scan. ([PR #780](https://github.com/SkyyPlayz/Mythos-Writer/pull/780))
- **Write-order safety in floating panels** — Scene files are written before the manifest, preventing manifest/file skew if the app is interrupted mid-save. ([PR #801](https://github.com/SkyyPlayz/Mythos-Writer/pull/801))
- **Quick-entry persistence** — Blank quick-entry saves are rejected, and scene/quick-entry persistence is guarded against partial writes. ([PR #782](https://github.com/SkyyPlayz/Mythos-Writer/pull/782), [#781](https://github.com/SkyyPlayz/Mythos-Writer/pull/781))
- **Frontmatter escaping** — Inline-array frontmatter values containing commas are quoted correctly. ([PR #799](https://github.com/SkyyPlayz/Mythos-Writer/pull/799))
- **Sidebar layout regressions** — No more doubled right sidebar in Notes mode; the global right sidebar persists across Notes and Brainstorm modes. ([PR #812](https://github.com/SkyyPlayz/Mythos-Writer/pull/812), [#811](https://github.com/SkyyPlayz/Mythos-Writer/pull/811))
- **Settings tab keyboard navigation** — Category tabs regained full ARIA APG arrow-key navigation after a regression. ([PR #815](https://github.com/SkyyPlayz/Mythos-Writer/pull/815))

### Security

- **Path-containment guards** — Snapshots, journal, and vault-integrity IPC handlers now resolve and contain paths before touching disk. ([PR #774](https://github.com/SkyyPlayz/Mythos-Writer/pull/774))
- **Backup hardening** — Backup archives redact secrets, and restore is protected against zip-slip extraction attacks. ([PR #773](https://github.com/SkyyPlayz/Mythos-Writer/pull/773))
- **Floating-panel IPC guards** — Dock-back and pin IPC channels now verify the sender frame. ([PR #770](https://github.com/SkyyPlayz/Mythos-Writer/pull/770))

## [0.2.0-beta.2] — 2026-06-17

### Added

- **App UX overhaul — moveable, dockable, floatable panels** — Every panel is now a first-class workspace citizen. Drag panels across sidebars with ghost preview and drop zones (Wave 2b), detach any panel as a free-floating window (Wave 2c), dock panels as top-level tabs in the main shell (Wave 2d), split the manuscript view to edit two scenes side by side (Wave 2e), and save any arrangement as a named layout for instant recall (Wave 2f). Cross-tab links and tab-aware keyboard shortcuts keep every view connected. ([PR #478](https://github.com/SkyyPlayz/Mythos-Writer/pull/478), [#493](https://github.com/SkyyPlayz/Mythos-Writer/pull/493), [#497](https://github.com/SkyyPlayz/Mythos-Writer/pull/497), [#505](https://github.com/SkyyPlayz/Mythos-Writer/pull/505), [#535](https://github.com/SkyyPlayz/Mythos-Writer/pull/535))

- **Vault Graph** — Interactive visualization of every entity connection in your story vault. Filter by folder, adjust link depth, search and highlight nodes, and navigate to any scene or entity in one click. Includes empty-vault, loading, and large-vault states plus full keyboard accessibility. ([SKY-1760](https://github.com/SkyyPlayz/Mythos-Writer/issues/1760)–[SKY-1765](https://github.com/SkyyPlayz/Mythos-Writer/issues/1765))

- **Scene Crafter** — Full Kanban board for scene planning with drag-and-drop scene cards, keyboard-accessible drag-drop, file-watcher conflict detection, and complete IPC board-mutation channels. ([PR #492](https://github.com/SkyyPlayz/Mythos-Writer/pull/492), [#499](https://github.com/SkyyPlayz/Mythos-Writer/pull/499), [#527](https://github.com/SkyyPlayz/Mythos-Writer/pull/527))

- **Continuity Peek** — A sidebar tab that surfaces entity matches in the active scene in real time, letting you spot unintended repetition without leaving the manuscript. ([PR #515](https://github.com/SkyyPlayz/Mythos-Writer/pull/515))

- **Notes tab layout** — Dedicated Notes view with a vault file tree, embedded editor, Brainstorm sidebar, and toggleable sub-views. The Notes vault is now a fully first-class workspace surface. ([SKY-2096](https://github.com/SkyyPlayz/Mythos-Writer/issues/2096))

- **Onboarding v2.1 — genre picker + sample vaults** — The first-run wizard now opens with a genre picker (Cozy Fantasy, Sci-Fi Noir, Mystery). Selecting a genre loads a pre-seeded sample vault with era-appropriate characters, locations, and scenes. ([PR #517](https://github.com/SkyyPlayz/Mythos-Writer/pull/517), [#521](https://github.com/SkyyPlayz/Mythos-Writer/pull/521))

- **Liquid Neon Companion — four new plugin skins** — Dataview (LN-51, launch-blocker), Calendar (LN-54), Kanban, and Advanced Tables (LN-55) now render natively in the Liquid Neon palette, completing first-pass coverage of the most-used Obsidian community plugins. ([PR #523](https://github.com/SkyyPlayz/Mythos-Writer/pull/523), [#524](https://github.com/SkyyPlayz/Mythos-Writer/pull/524), [#526](https://github.com/SkyyPlayz/Mythos-Writer/pull/526), [#532](https://github.com/SkyyPlayz/Mythos-Writer/pull/532))

- **Vault browser sort + filter controls** — Sort entries by name, date modified, or type; filter by entity category. ([SKY-1982](https://github.com/SkyyPlayz/Mythos-Writer/issues/1982))

- **Vault picker polish** — Editable path input with inline validation, recent-vault suggestions, and a conflict dialog when two vaults share overlapping directories. ([PR #530](https://github.com/SkyyPlayz/Mythos-Writer/pull/530))

- **New app icon** — Fantasy-book artwork replaces the placeholder icon across all surfaces. ([SKY-2081](https://github.com/SkyyPlayz/Mythos-Writer/issues/2081))

### Changed

- **Settings dialog a11y** — ARIA labels, visible focus rings, and full keyboard navigation across all settings panels. ([PR #511](https://github.com/SkyyPlayz/Mythos-Writer/pull/511))
- **Standardized IPC error shape + breadcrumb logging** — All IPC handlers now emit a consistent `{ code, message, breadcrumbs }` error envelope. ([SKY-1970](https://github.com/SkyyPlayz/Mythos-Writer/issues/1970))
- **Shared Toast notification component** — A unified `useToast` hook and `Toast` component replace four divergent call sites. ([PR #512](https://github.com/SkyyPlayz/Mythos-Writer/pull/512))
- **Incremental vault-index rebuild** — The vault index skips unchanged files by mtime+size, reducing startup time on large vaults. ([SKY-1981](https://github.com/SkyyPlayz/Mythos-Writer/issues/1981))
- **Empty-state copy refresh** — Vault Browser and Entries Panel show friendlier guidance when empty. ([SKY-1997](https://github.com/SkyyPlayz/Mythos-Writer/issues/1997))

### Fixed

- **Scene Crafter watcher leak** — File-watcher handles are cleaned up when the panel unmounts. ([SKY-1805](https://github.com/SkyyPlayz/Mythos-Writer/issues/1805))
- **Settings dialog focus** — The Settings dialog recaptures focus correctly after an async load. ([SKY-1902](https://github.com/SkyyPlayz/Mythos-Writer/issues/1902))
- **Vault routing edge cases** — Missing-vault recovery screen appears only when both vaults are absent; a missing story-vault alone shows the story-vault recovery path. ([SKY-2095](https://github.com/SkyyPlayz/Mythos-Writer/issues/2095), [SKY-2097](https://github.com/SkyyPlayz/Mythos-Writer/issues/2097))
- **Stray vault directory creation** — The app no longer creates blank vault directories on launch; defaults now live in `userData`. ([SKY-2157](https://github.com/SkyyPlayz/Mythos-Writer/issues/2157))
- **Liquid Neon panel preset** — Default panel color preset corrected to dark glass. ([SKY-2097](https://github.com/SkyyPlayz/Mythos-Writer/issues/2097))

### Security

- **`markdown-it` 14.1.0 → 14.2.0** — Patches [GHSA-6v5v-wf23-fmfq](https://github.com/advisories/GHSA-6v5v-wf23-fmfq) (ReDoS via malformed HTML). ([PR #522](https://github.com/SkyyPlayz/Mythos-Writer/pull/522))

---

---

## [0.2.0] — 2026-06-10

### Added

- **Cloud-sync vault placement** — Move your Story Vault into a cloud-synced folder (Dropbox, iCloud, OneDrive, or any provider with a guided local sync folder) via a new Move Vault wizard. Includes conflict detection before the move, a last-modified-time-wins conflict resolver for concurrent two-machine edits, and a lockfile guard that prevents partial syncs from corrupting your vault. ([PR #357](https://github.com/SkyyPlayz/Mythos-Writer/pull/357))
- **Voice provider unification + device selector** — All speech features now share a single provider panel. Select your microphone once; pick your STT and TTS provider in one place. Supports all previously-separate voice provider integrations. ([PR #336](https://github.com/SkyyPlayz/Mythos-Writer/pull/336))
- **Granular per-category auto-apply** — Every suggestion category now has its own auto-apply toggle. Apply dialogue corrections automatically while keeping manual review for prose rewrites or chapter titles.
- **Liquid Neon third accent border** — The Liquid Neon theme adds a third accent-color variant for border styling, expanding visual customization options.
- **Global search FTS seed** — Full-text search index is seeded correctly on first launch and in E2E test runs, so search results are complete from day one. ([PR #312](https://github.com/SkyyPlayz/Mythos-Writer/pull/312))
- **Two-vault workspace** — Story Vault and Notes Vault are now distinct on-disk locations with independent default folder structures, each initialised on first use. ([SKY-9](https://github.com/SkyyPlayz/Mythos-Writer/issues/9))
- **First-run onboarding wizard** — three-path welcome flow: start a blank project, import an existing vault, or open the bundled sample project. Wizard is skipped on subsequent launches; can be re-triggered from Settings. ([SKY-12](https://github.com/SkyyPlayz/Mythos-Writer/issues/12))
- **Manuscript Structure View** — card-based scene board grouped by chapter with drag-and-drop reorder (Ctrl+Z undo), a Save the Cat 3-Act beat-sheet sidebar, and a List/Card view toggle; includes SceneCard, SceneGrid, BeatSheetSidebar, and ListView components. ([SKY-565](https://github.com/SkyyPlayz/Mythos-Writer/issues/565))
- **Entity aliases** — entities support a `aliases` frontmatter field; the editor UI and Brainstorm extraction both resolve alternative names to the canonical entity. ([SKY-191](https://github.com/SkyyPlayz/Mythos-Writer/issues/191))
- **Automatic Linker** — background agent auto-wraps entity mentions in `[[wiki-links]]` as you write, keeping the Notes Vault graph connected without manual linking. ([SKY-192](https://github.com/SkyyPlayz/Mythos-Writer/issues/192))
- **Templater (Mythos edition)** — variable, prompt, and entity-pick template types for inserting structured snippets into scenes and notes. ([SKY-190](https://github.com/SkyyPlayz/Mythos-Writer/issues/190))
- **One-click default vault setup + multi-vault switcher** — first launch pre-creates the default vault at `~/Mythos` with a starter structure; the Project Switcher supports adding, removing, and switching between multiple vaults. ([SKY-320](https://github.com/SkyyPlayz/Mythos-Writer/issues/320))

### Changed

- **Onboarding wizard polish** — Step alignment corrected across screen sizes; the bundled sample novel project now loads correctly on the "open sample project" path. ([PR #344](https://github.com/SkyyPlayz/Mythos-Writer/pull/344))
- **`@anthropic-ai/sdk` 0.24.3 → 0.100.1** — major SDK version bump; picks up streaming improvements, model-alias updates, and official tool-use helpers. ([SKY-49](https://github.com/SkyyPlayz/Mythos-Writer/issues/49))
- **Electron + builder chain upgrade** — upgraded Electron and the packaging toolchain to clear all high-severity audit advisories flagged against prior versions. ([SKY-453](https://github.com/SkyyPlayz/Mythos-Writer/issues/453))
- **`docx` 8.5.0 → 9.7.1** — minor breaking API changes handled; no user-visible export regressions. ([SKY-52](https://github.com/SkyyPlayz/Mythos-Writer/issues/52))
- **Merged backlog of 11 upstream PRs** — maintenance cycle that kept the working branch current with `main`. ([SKY-21](https://github.com/SkyyPlayz/Mythos-Writer/issues/21))
- **PR and bug-triage cleanup** — stale branches closed, duplicate issues resolved, and CI skew corrected. ([SKY-22](https://github.com/SkyyPlayz/Mythos-Writer/issues/22), [SKY-23](https://github.com/SkyyPlayz/Mythos-Writer/issues/23))

### Fixed

- **Typed-relation suggestion frontmatter persistence** — Entity typed-relation suggestions are now correctly written to frontmatter and survive restarts. Previously the auto-apply step silently reported success even when both manifest lookups missed, dropping the relation without warning.
- **Focus restoration on blank scene entry** — Opening a blank scene now places the cursor in the editor automatically; a second click is no longer required to activate the editor. ([PR #320](https://github.com/SkyyPlayz/Mythos-Writer/pull/320))
- **NotesPanel silent data-loss** — notes written in the Notes panel now persist to the Notes Vault SQLite database; previously all content was discarded on window close. ([SKY-55](https://github.com/SkyyPlayz/Mythos-Writer/issues/55))
- **`better-sqlite3` ABI boot crash** — the dev `start` script now rebuilds the native module against the running Electron ABI before launch, eliminating the crash on first run after an Electron upgrade. ([SKY-67](https://github.com/SkyyPlayz/Mythos-Writer/issues/67))
- **Snapshot toolbar restored** — the "Save snapshot now" button is back in the BlockEditor toolbar after it was dropped during a toolbar refactor. ([SKY-68](https://github.com/SkyyPlayz/Mythos-Writer/issues/68))
- **Vault-missing recovery dialog** — if the configured Story Vault directory has been moved or deleted, the app now displays a recovery dialog instead of crashing silently or showing a blank screen. ([SKY-69](https://github.com/SkyyPlayz/Mythos-Writer/issues/69))
- **Notes Vault creation routing** — note and folder creation calls in the Notes panel were incorrectly routed to the Story Vault writer; they now target the Notes Vault writer. ([SKY-75](https://github.com/SkyyPlayz/Mythos-Writer/issues/75))

### Security

- **Electron 39.8.10 → 42.3.0** — pulls in three Chromium milestone security patches (M122, M123, M124). Renderer sandbox and context-isolation settings are unchanged. ([SKY-54](https://github.com/SkyyPlayz/Mythos-Writer/issues/54))
- **persona:read enum guard (SEC-5)** — IPC handler now validates the `persona` argument against an explicit allowlist before any file access, closing an unauthenticated enumeration vector. ([SKY-102](https://github.com/SkyyPlayz/Mythos-Writer/issues/102))
- **PERSIST_PROMPTS CI guard (SEC-9)** — CI pipeline now asserts that no prompt strings are persisted to disk outside the designated settings path, enforced as a required check on every PR. ([SKY-103](https://github.com/SkyyPlayz/Mythos-Writer/issues/103))
- **persona:reset path-traversal fix (SEC-10)** — added `path.resolve` containment guard to the `agent:persona:reset` IPC handler to block directory-traversal attacks that could delete arbitrary files outside the vault root. ([SKY-575](https://github.com/SkyyPlayz/Mythos-Writer/issues/575))

---

## [0.1.0] — 2025-01-01

Initial internal release.

[Unreleased]: https://github.com/SkyyPlayz/Mythos-Writer/compare/f0bb94cf20ab8acea7f427c3d5e21ff92b68349c...HEAD
[0.5.7]: https://github.com/SkyyPlayz/Mythos-Writer/compare/d283862284a4c7bbb17f00a55958e6ce6704e41f...f0bb94cf20ab8acea7f427c3d5e21ff92b68349c
[0.5.6]: https://github.com/SkyyPlayz/Mythos-Writer/compare/bf9a6c35d2cba4f8b15fc2363d30723a5ef6cd3e...d283862284a4c7bbb17f00a55958e6ce6704e41f
[0.5.5]: https://github.com/SkyyPlayz/Mythos-Writer/compare/a497d599fdec449f66e64539d829b6a468fd45ac...bf9a6c35d2cba4f8b15fc2363d30723a5ef6cd3e
[0.5.4.5]: https://github.com/SkyyPlayz/Mythos-Writer/compare/14ca164cc7d48f670d98f8c33b305459a00266bf...a497d599fdec449f66e64539d829b6a468fd45ac
[0.5.4]: https://github.com/SkyyPlayz/Mythos-Writer/compare/018f33208a7d0fb1513087e0edaa1cd8da59fec7...14ca164cc7d48f670d98f8c33b305459a00266bf
[0.5.3]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.5.2...018f33208a7d0fb1513087e0edaa1cd8da59fec7
[0.5.2]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/SkyyPlayz/Mythos-Writer/compare/07c503798510518751fc8d54cd0d57aa5d3ee9ec...v0.5.1
[0.4.0-beta.1]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.3.0-beta.2...v0.4.0-beta.1
[0.3.0-beta.2]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.3.0-beta.1...v0.3.0-beta.2
[0.3.0-beta.1]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.2.0-beta.2...v0.3.0-beta.1
[0.2.0-beta.2]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.2.0...v0.2.0-beta.2
[0.2.0]: https://github.com/SkyyPlayz/Mythos-Writer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SkyyPlayz/Mythos-Writer/releases/tag/v0.1.0
