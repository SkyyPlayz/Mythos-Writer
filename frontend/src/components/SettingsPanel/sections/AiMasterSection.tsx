// M11a (SKY-9160): master AI switch — manual mode. Prototype of record:
// "AI master switch" card, Liquid Neon HTML 2404-2419 (copy, toast, indicator
// verbatim). Unlike the rest of the panel this toggle persists immediately —
// the prototype toasts on flip, and "Nothing is sent anywhere" must hold
// without a separate Save click.
import { useCallback } from 'react';
import { useToast } from '../../../hooks/useToast';
import { Toast } from '../../Toast/Toast';
import { setAiEnabled } from '../../../hooks/useAiEnabled';

interface AiMasterSectionProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

// Prototype toast auto-clears after 2400 ms (HTML 4660-4663).
const TOAST_DURATION_MS = 2400;

export default function AiMasterSection({ settings, setSettings }: AiMasterSectionProps) {
  const { toast, showToast, clearToast } = useToast(TOAST_DURATION_MS);
  const enabled = settings.ai?.enabled !== false;

  const handleToggle = useCallback(
    async (next: boolean) => {
      setSettings((p) => ({ ...p, ai: { enabled: next } }));
      setAiEnabled(next);
      showToast(next ? 'AI features back on' : 'AI features off — every tool is now manual');
      try {
        // Persist only this flip: round-trip the stored settings so unsaved
        // edits elsewhere in the panel stay unsaved (masked keys reconcile
        // main-side, see settings-masking.ts).
        const stored = await window.api.settingsGet();
        await window.api.settingsSet({ ...stored, ai: { enabled: next } });
      } catch (err) {
        setSettings((p) => ({ ...p, ai: { enabled: !next } }));
        setAiEnabled(!next);
        showToast(
          `Could not save the AI switch — ${err instanceof Error ? err.message : 'settings write failed'}`,
          'error',
        );
      }
    },
    [setSettings, showToast],
  );

  return (
    <section className="settings-section" aria-labelledby="section-ai-master" data-settings-cat="agents">
      <div className="settings-agent-card ai-master-card" data-screen-label="AI master switch">
        <div className="ai-master-row">
          <div className="ai-master-copy">
            <h3 className="settings-section-title ai-master-title" id="section-ai-master">
              AI features
            </h3>
            <p className="ai-master-desc">
              Turn this off and every AI surface disappears — the Coach, the agent panels, Brainstorm
              chat, continuity flags, beta reads and AI suggestions. Nothing is sent anywhere. Every
              tool stays fully usable by hand.
            </p>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              role="switch"
              aria-label="AI features"
              checked={enabled}
              onChange={(e) => void handleToggle(e.target.checked)}
            />
            <span className="settings-toggle-track" />
          </label>
        </div>
        {!enabled && (
          <div className="ai-master-manual-note" role="status">
            <div className="ai-master-manual-note__title">Manual mode is on</div>
            <div className="ai-master-manual-note__body">
              Wiki-links and backlinks still auto-build as you type — that is plain text matching, not
              AI. Timeline, Vault Graph, Scene Crafter beats, drafts, export and the reader all work
              exactly as before.
            </div>
          </div>
        )}
      </div>
      <Toast message={toast?.message ?? null} level={toast?.level} onDismiss={clearToast} />
    </section>
  );
}
