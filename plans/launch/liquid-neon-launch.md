# Liquid Neon Companion — Launch Content Pack

> **Status: DRAFT — pending CEO approval.**
> Per CMO charter, no content in this file may be published externally without an accepted `request_confirmation` from the CEO. This file is a draft input only.
>
> Related issues: [SKY-1975](/SKY/issues/SKY-1975) (this issue) · [SKY-1770](/SKY/issues/SKY-1770) (Obsidian community PR) · [SKY-1936](/SKY/issues/SKY-1936) (README + listing copy)

---

## 1. Blog Post (≤ 600 words)

*Channel: Mythos Writer dev blog / GitHub release notes companion post*
*Primary reader: Obsidian power user who runs the CyberGlow theme and has noticed unstyled surfaces in their vault*

---

### Liquid Neon Companion is now in the Obsidian community directory

> One plugin. Every surface of your CyberGlow vault finally matches.

If you run CyberGlow in Obsidian, you've seen it: the editor looks sharp, but scroll to a callout panel and it's flat and unstyled. Open your kanban board and the card chrome doesn't match the rest of your vault. Launch the settings modal and it feels like a different app shipped it.

**Liquid Neon Companion fixes that.**

It's a companion CSS plugin that extends CyberGlow with coordinated Liquid Neon styling across the surfaces the base theme leaves untouched. No CSS editor. No manual snippet hunting. Install it alongside CyberGlow and your vault is consistent from edge to edge.

#### What it adds

- **Callouts** — each callout type (note, warning, tip, success) gets a distinct frosted-glass panel with a per-type neon frame color
- **Buttons** — primary, secondary, and danger states in coordinated cyan/magenta neon
- **Panel chrome** — tab bars, modal headers, and settings sections matched to the Liquid Neon glass language
- **Kanban boards** — card backgrounds, column headers, and drag handles share the same glass treatment as the rest of the vault
- **Tags** — inline pill badges with per-category neon tinting

#### Who it's for

If you're a CyberGlow user who has ever thought "this callout looks wrong" — this plugin was made for you.

It's also the missing piece if you run Mythos Writer alongside Obsidian. Liquid Neon is Mythos Writer's visual identity — translucent frosted glass with restrained neon accents. Liquid Neon Companion brings that same design language to your Obsidian notes vault, so the look is consistent whether you're writing in the app or editing notes.

#### How to install

1. Open **Settings → Community plugins → Browse** in Obsidian
2. Search **"Liquid Neon"**
3. Install and enable **Liquid Neon Companion**
4. Confirm **CyberGlow** is your active theme — Liquid Neon Companion requires it

*[Screenshot: callout panel before/after with CyberGlow active — image pending UXDesigner via SKY-1817]*

One thing to know: this plugin extends CyberGlow — it does not function as a standalone theme. If a surface looks unstyled, make sure CyberGlow is enabled and active first. There is no settings panel to configure; styles activate automatically. To adjust glow intensity or contrast across the vault, use CyberGlow's existing Style Settings controls.

#### What's next

We're tracking coverage gaps and compatibility issues after launch. First in queue:

- Additional callout type variants based on user requests
- Style Settings integration for per-surface intensity controls
- Dark Reader compatibility review

Bug reports and surface requests go to [GitHub Issues](https://github.com/SkyyPlayz/liquid-neon-companion/issues). If CyberGlow is active and a surface isn't picking up the Liquid Neon treatment — that's exactly the kind of report that shapes the next release.

---

*Liquid Neon Companion is MIT licensed. Built on top of the excellent [CyberGlow](https://github.com/ArtexJay/Obsidian-CyberGlow) theme by ArtexJay.*

---

## 2. Changelog Snippet — Mythos Writer Release Notes

*Drop into CHANGELOG.md → `[Unreleased]` → `### Added` when SKY-1770 lands.*

```markdown
- **Liquid Neon Companion** (Obsidian plugin) — The Liquid Neon visual identity
  is now available as a companion CSS plugin for Obsidian. It extends the
  CyberGlow theme with coordinated Liquid Neon styling across callout panels,
  buttons, kanban boards, panel chrome, and tag pills — so your Obsidian notes
  vault matches Mythos Writer edge to edge. Available in the Obsidian community
  directory (search "Liquid Neon"). Requires CyberGlow as the active theme.
  ([SkyyPlayz/liquid-neon-companion](https://github.com/SkyyPlayz/liquid-neon-companion))
```

---

## 3. Social Posts

> **Publish gate:** all three posts require accepted `request_confirmation` from CEO before posting. Do not schedule or publish independently.

---

### Twitter / X (≤ 280 chars)

```
CyberGlow users: Liquid Neon Companion just landed in the Obsidian community directory.

Glass callouts. Neon buttons. Kanban cards that match your vault.

Install it alongside CyberGlow and every surface finally lines up.

Settings → Community plugins → search "Liquid Neon"
```

*Character count (without link): 248 chars. Add the repo link to land at ~278.*

---

### Bluesky (≤ 300 chars)

```
CyberGlow users — Liquid Neon Companion is live in the Obsidian community directory.

One plugin extends CyberGlow to cover the surfaces it skips: callouts, buttons, kanban cards, tags, and panel chrome.

Search "Liquid Neon" in Settings → Community plugins to install. Requires CyberGlow active.
```

*Character count: 293 chars. Fits standard Bluesky post length.*

---

### Reddit — r/ObsidianMD

**Post title:**
> Liquid Neon Companion — a CSS companion plugin that finishes CyberGlow's unstyled surfaces (callouts, kanban, buttons, tags)

**Body:**

```markdown
Hey r/ObsidianMD,

I've been using CyberGlow for a while and kept running into the same gap: the editor
looks great, but callouts are unstyled, kanban cards don't match, and the settings
modal feels like it came from a different theme.

I built Liquid Neon Companion to fix that. It's a CSS companion plugin that extends
CyberGlow with coordinated Liquid Neon styling across the surfaces the base theme
leaves untouched:

- **Callouts** — frosted-glass panels with per-type neon frame colors (note/warning/tip/success)
- **Buttons** — primary, secondary, and danger states in cyan/magenta neon
- **Panel chrome** — tab bars, modal headers, and settings sections
- **Kanban boards** — card backgrounds, column headers, and drag handles
- **Tags** — inline pill badges with per-category tinting

It's in the community directory now — search "Liquid Neon" in Settings → Community
plugins. CyberGlow must be your active theme; this doesn't work standalone.

Repo + bug reports: https://github.com/SkyyPlayz/liquid-neon-companion

It's also the companion piece for Mythos Writer users who use Obsidian for their
notes vault — Liquid Neon is the visual identity of Mythos Writer, so this keeps
both apps consistent.

Would love feedback on any surfaces I missed.
```

*Format note: conversational, first-person, acknowledges the gap before pitching the fix. Ends with an open invitation for community feedback — r/ObsidianMD convention.*

---

## Delivery notes

| Item | Status | Publish gate |
|------|--------|--------------|
| Blog post | Draft | CEO `request_confirmation` |
| Changelog snippet | Draft | Lands with SKY-1770 merge |
| Twitter/X | Draft | CEO `request_confirmation` |
| Bluesky | Draft | CEO `request_confirmation` |
| Reddit r/ObsidianMD | Draft | CEO `request_confirmation` |
| Screenshots in blog post | Missing — placeholder | [SKY-1817](/SKY/issues/SKY-1817) UXDesigner delivery |

**Marketing lenses applied:**
- **Audience-first:** CyberGlow Obsidian user mid-vault-setup — not "Obsidian users" generically
- **Jobs-to-be-done:** make every surface match without manual CSS — the job users hire a companion plugin to do
- **Hook/promise/proof:** "the gap you've seen" → "one plugin fixes it" → specific surface list as proof
- **StoryBrand:** user is the vault curator; the plugin is the guide that closes the gap
- **Specificity beats superlative:** named surfaces (callouts, kanban, tags) not "beautiful styling"
- **Beta empathy:** install note calls out CyberGlow dependency requirement clearly
- **Distribution-shaped:** Twitter/Bluesky fit character limits; Reddit is first-person community voice, not a press release

**Success metrics:** Plugin installs within 30 days of community listing; BRAT install count as pre-listing proxy. Reddit post upvote count and comments as signal of community-problem fit.
