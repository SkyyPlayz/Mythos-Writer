# Accessibility Audit — Phase 2
**Scope:** Writing surface WCAG 2.1 AA audit — keyboard navigation, ARIA roles, contrast, screen-reader labels  
**Date:** 2026-05-28  
**Issue:** MYT-772  
**Auditor:** QA agent (automated static analysis + pattern review against WCAG 2.1 AA and ARIA APG)

---

## Methodology

Static code review of all writing-surface TSX components against:

- **WCAG 2.1 AA** success criteria, specifically SC 1.3.1, 2.1.1, 2.4.3, 4.1.2, 4.1.3
- **ARIA Authoring Practices Guide (APG)** dialog, tabs, tree, slider, and toolbar patterns
- Existing axe-core unit tests in `frontend/src/accessibility.test.tsx` as baseline

Components inspected:

| Component | File |
|-----------|------|
| Settings modal | `SettingsPanel.tsx` |
| Advanced UI popover | `SettingsPanel.tsx` (inline) |
| Left Rail tabs + VaultBrowser | `LeftRail.tsx` |
| Right Sidebar tabs + AI sub-tabs | `RightSidebar.tsx` |
| BlockEditor toolbar | `BlockEditor.tsx` |
| DepthSlider | `components/EditorHeader/DepthSlider.tsx` |
| BrainstormPage chat | `BrainstormPage.tsx` |
| BottomBar | `BottomBar.tsx` |
| ThemeContrastSlider | `ThemeContrastSlider.tsx` |

---

## Findings Table

### HIGH severity — child issues required

| ID | Component | WCAG SC | Description | Repro |
|----|-----------|---------|-------------|-------|
| H-1 | `SettingsPanel` | 2.1.1 Keyboard | Main Settings dialog has no `Escape` key handler. ARIA APG dialog pattern requires Escape to dismiss. The inner Advanced UI popover has Escape (line 200) but the outer dialog does not. | Open Settings with ⚙ button; press Escape — dialog does not close. |
| H-2 | `SettingsPanel` | 2.4.3 Focus Order | Settings dialog sets initial focus and restores on close, but does not trap Tab/Shift+Tab within the dialog. Focus escapes to content behind the modal backdrop. | Open Settings; Tab repeatedly — focus cycles into the page behind the overlay. |
| H-3 | `RightSidebar` | 4.1.2 Name/Role/Value | Right Sidebar main tab bar (`sidebar-tabs`) lacks `role="tablist"`, `aria-label`; tab buttons lack `role="tab"`, `aria-selected`, `id`, `aria-controls`; content area lacks `role="tabpanel"`. | Open any view with a scene selected; inspect `.sidebar-tabs` — no tablist semantics announced by AT. |
| H-4 | `RightSidebar` (AI panel) | 4.1.2 Name/Role/Value | The Writing / Vault / Archive sub-tab bar (`ai-subtabs`) has the same missing ARIA tab pattern as H-3. | Activate the AI/Assistant sidebar; inspect `.ai-subtabs` — sub-tabs not announced as tabs. |
| H-5 | `LeftRail` (`VaultBrowser`) | 2.1.1 Keyboard | `VaultTreeNode` directory rows and file rows have only `onClick` with no `tabIndex`, `role="treeitem"`, `onKeyDown`, or keyboard activation. Vault tree is entirely mouse-only. | Switch to Vault tab; attempt to Tab into the tree and press Enter/Space — no elements reachable or activatable by keyboard. |
| H-6 | `LeftRail` (tab bar) | 4.1.2 + APG Tabs | `role="tablist"` and `role="tab"` are present, but arrow-key roving tabindex navigation (left/right arrow between tabs) is not implemented. ARIA APG tab pattern requires this. Only mouse click works. | Focus a left-rail tab button; press Arrow Right/Left — focus does not move to the adjacent tab. |

### MEDIUM severity — recorded, no blocking child issue required

| ID | Component | WCAG SC | Description |
|----|-----------|---------|-------------|
| M-1 | `RightSidebar` (Notes) | 1.3.1 Info and Relationships | `<textarea>` in Notes panel has only a `placeholder` — no `aria-label` or `<label>`. Placeholder is not a programmatic label. |
| M-2 | `BrainstormPage` | 4.1.2 Name/Role/Value | Continuity answer-kind buttons (`bs-cont-kind-btn`) have a visual active state but no `aria-pressed`. State change is not announced to AT. |
| M-3 | `BrainstormPage` | 4.1.2 Name/Role/Value | Fact "retry" button (`bs-fact-retry-btn`) has text content "retry" with no `aria-label` carrying fact name context. Screen reader reads "retry" with no reference to which fact. |
| M-4 | `DepthSlider` | 4.1.3 Status Messages | `<span className="depth-context-label">` updates dynamically as the user changes depth/position, but is not a live region (`role="status"` / `aria-live`). AT users receive no announcement of the context change. |
| M-5 | `BlockEditor` | 1.3.1 Info and Relationships | Scene title `<span className="scene-name">` in the editor toolbar is not a semantic heading or landmark. It functions as the effective page heading but carries no heading role or `aria-label` for the editing region. |
| M-6 | `SettingsPanel` (loading) | 4.1.2 Name/Role/Value | The loading-state dialog `<div role="dialog" aria-modal="true">` has no `aria-label` or `aria-labelledby`. |
| M-7 | `BottomBar` | 4.1.2 Name/Role/Value | Prev/Next scene buttons have `title="Previous scene"` / `title="Next scene"` but no `aria-label`. Titles are not a reliable accessible name in all AT configurations. |
| M-8 | `BlockEditor` (wiki-link tooltip) | 2.1.1 Keyboard | Wiki-link hint tooltip (`wl-hint-tooltip`) is hover-only. Accept/Reject buttons inside are not reachable by keyboard. |

### LOW severity — recorded for future sprint

| ID | Component | WCAG SC | Description |
|----|-----------|---------|-------------|
| L-1 | `BottomBar` | 1.3.1 | Breadcrumb separator `‹` spans (`bottom-sep`) are not `aria-hidden="true"` — AT reads them aloud. |
| L-2 | `ThemeContrastSlider` | 1.3.1 | "Soft" / "Sharp" decorative `<span>` labels flanking the slider track are not associated with the `<input type="range">` via `aria-describedby`. |
| L-3 | `BottomBar` | 4.1.2 | Draft state badge renders raw CSS value (e.g. `in-progress`) as content with no human-readable label. |
| L-4 | Contrast ratios | 1.4.3 Contrast | Theme contrast ratio verification requires runtime/manual testing; the existing axe suite intentionally disables `color-contrast` due to jsdom limitations. Recommend a dedicated runtime Playwright visual test step for contrast floors. |
| L-5 | `DepthSlider` | 2.4.6 Headings and Labels | Prev/Next depth navigation buttons say "Previous" / "Next" without indicating what they navigate (scene vs. chapter vs. book). Consider `aria-label="Previous scene"` contextual to the active depth. |

---

## Existing coverage (passing)

The following surfaces already have solid ARIA coverage confirmed by axe-core tests and code review:

- `LeftRail` tab pattern (`role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `role="tabpanel"`, `aria-labelledby`) — pending H-6 arrow-key nav
- `SettingsPanel` loaded state — all sections labeled with `aria-labelledby`, inputs with `aria-label`, error messages with `role="alert"`, live regions with `aria-live`
- `BrainstormPage` — live announcer (`useLiveAnnounce`), `aria-label` on textarea, mic, cancel, and close buttons; `role="alert"` on errors
- `DepthSlider` — `aria-pressed` on depth buttons, `aria-hidden` on indicator, `role="group"` on track
- `SettingsPanel` Advanced UI popover — Escape handler, initial focus, `role="dialog"`, `aria-modal`, `aria-label`, close button labeled
- `BlockEditor` — `aria-pressed` on draft-state buttons, labeled wiki-link tooltip buttons
- `DesktopShell` resize handles — `role="separator"`, `aria-orientation`, `aria-valuenow/min/max`, `tabIndex`, arrow-key handlers
- `DesktopShell` view mode switcher — `aria-pressed` on all four buttons
- `EntityBrowser` create dialog — `role="dialog"`, `aria-modal`, `aria-labelledby`
- `UpdateBanner` — `role="status"`, `aria-live="polite"`, `aria-label` on dismiss
- `ProjectSwitcher` — `aria-haspopup="listbox"`, `aria-expanded`, listbox with `role="option"`, `aria-selected`

---

## Child issues filed

| Finding ID | Child issue |
|------------|-------------|
| H-1 | MYT-801 |
| H-2 | MYT-802 |
| H-3, H-4 | MYT-803 |
| H-5 | MYT-804 |
| H-6 | MYT-805 |
