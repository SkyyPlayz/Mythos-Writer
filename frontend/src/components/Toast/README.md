# Toast / Notification Component

Canonical API for ephemeral user-facing notifications in Mythos Writer.

## Quick start

```tsx
import { useToast } from '../../hooks/useToast';
import { Toast } from './Toast';

function MyComponent() {
  const { toast, showToast, clearToast } = useToast(3000); // ms auto-dismiss

  return (
    <>
      <button onClick={() => showToast('Saved!', 'info')}>Save</button>
      <button onClick={() => showToast('Low disk space', 'warn')}>Warn</button>
      <button onClick={() => showToast('Export failed', 'error')}>Error</button>
      <Toast message={toast?.message ?? null} level={toast?.level} />
    </>
  );
}
```

## `useToast(duration?)` hook

| Return | Type | Description |
|--------|------|-------------|
| `toast` | `ToastState \| null` | Current toast, or null when dismissed |
| `showToast(message, level?)` | `fn` | Show a toast; restarts the dismiss timer |
| `clearToast()` | `fn` | Dismiss immediately |

`ToastState` has `{ message: string; level: ToastLevel }`.

## `<Toast>` component

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `message` | `string \| null` | — | Text to display; renders nothing when null |
| `level` | `'info' \| 'warn' \| 'error'` | `'info'` | Visual style and ARIA role |
| `action` | `{ label, onClick }` | — | Optional action button (e.g. Undo) |
| `onDismiss` | `() => void` | — | Renders a ✕ dismiss button |
| `className` | `string` | — | Extra CSS class for position overrides |

The component is `position: fixed; bottom: 1.5rem; left: 50%` by default.
Use `className="app-toast--stacked"` to raise it to `3.2rem` when two toasts
must coexist (e.g. budget warn + voice status in DesktopShell).

## When to use which level

| Level | Use for | ARIA role |
|-------|---------|-----------|
| `info` | Success, confirmation, status (saved, copied, navigation) | `status` / `aria-live="polite"` |
| `warn` | Soft limits, degraded operation (budget cap, quota warnings) | `status` / `aria-live="polite"` |
| `error` | Hard failures the user must notice (export failed, API error) | `alert` / `aria-live="assertive"` |

### Not toast — use inline error instead

Inline errors (`role="alert"` in the form/panel) are better for:
- Form validation (field-level feedback)
- Errors that block the current action (user must fix before continuing)
- Persistent state the user needs to refer back to

## Notification surface inventory (2026-06-17)

All user-facing notification surfaces in `frontend/src`:

### Migrated to `useToast` + `<Toast>`

| File | What it notifies | Level |
|------|-----------------|-------|
| `BrainstormPage.tsx` | Fact actions, nav results, clipboard, generation status | `info` |
| `DesktopShell.tsx` (budgetToast) | Token cap reached | `warn` |
| `DesktopShell.tsx` (voiceToast) | Voice input status / errors | `info` |
| `OnboardingWizard.tsx` (templateToast) | Template import/export feedback | `info` |

### Inline banners (intentional — not ephemeral)

| File | What it shows | Pattern |
|------|--------------|---------|
| `BrainstormPage.tsx` | AI generation error | `error` state → inline `brainstorm-error-bar` |
| `VaultGraphView.tsx` | Vault load error | `error` state → inline display |
| `OnboardingWizard.tsx` | Scaffold error | `scaffoldError` state → inline |
| `EntriesQuickAdd.tsx` | Save error | `error` state → inline `entries-qa-error` |
| `ArchiveConfirmDialog.tsx` | Archive error | `error` state → inline |
| `EntityDetail.tsx` | Save error | `error` state → inline |
| `PromptHistoryPanel.tsx` | Load error | `error` state → inline |
| `WritingApp.tsx` | Manifest load error | `error` state → inline |
| `TemplatePicker.tsx` | Load error | `error` state → inline |
| `EntriesQuickAdd.tsx` | Undo toast (with action button) | `undoPath` state → inline `entries-qa-toast` |

### `alert()` dialogs (follow-up: migrate to toast)

| File | Where | What |
|------|-------|------|
| `DesktopShell.tsx` (AppMenuBar) | EPUB/DOCX export | Success path + errors |
| `ExportDialog.tsx` | Export | Success path + errors |
| `ProjectSwitcher.tsx` | Vault create/switch | Errors + validation |

These block the main thread and are visually inconsistent. Migrating them requires
threading a `showToast` callback from `DesktopShell` down through `AppMenuBar` into
`ProjectSwitcher`, and making `ExportDialog` accept one too. Tracked as a follow-up.

### `console.error` (fire-and-forget, not user-facing)

`KanbanBoard.tsx`, `WritingApp.tsx` — non-critical failures logged only to devtools.
Leave as-is unless the feature becomes user-visible.
