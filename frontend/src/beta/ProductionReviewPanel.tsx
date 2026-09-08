// ProductionReviewPanel — live run surface for the production-team roles
// (SKY-11411 / SKY-10741 M12.B6).
//
// The three roles alphaReader / storylineConsultant / lineEditor were merged as
// dead code in SKY-10741. This panel is their reachable UI: pick a role + a
// scope (scene / chapter / whole story), press Run, and it calls
// window.api.productionRoleRun — the same reveal-point-aware main-process path
// the Beta Reader uses. For the reader-perspective Alpha Reader, main filters the
// entity dossier to the reading position, so a not-yet-revealed identity can
// never reach the prompt (AC2). betaReader keeps its own Reports tab.
//
// The panel reuses the Beta Reader's scope/text assembly (textAssembly.ts) so the
// two stay in lockstep on what "Chapter 2" or "Full story" means.

import { useCallback, useMemo, useState } from 'react';
import type { Chapter, Scene, Story } from '../types';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast/Toast';
import { useAgentActivity } from '../agents/agentActivity';
import {
  PRODUCTION_ROLE_IDS,
  PRODUCTION_ROLES,
  resolveProductionRoleName,
  type ProductionRoleId,
} from '../agents/productionRoles';
import { buildBetaReadSourceText, buildScopeOptions, type BetaScopeOption } from './textAssembly';

export interface ProductionReviewPanelProps {
  story: Story | null;
  chapter: Chapter | null;
  scene: Scene | null;
  /** Per-role enable state from Settings (agents.<role>.enabled). Absent = OFF. */
  rolesEnabled?: Partial<Record<ProductionRoleId, boolean>>;
  /** Renames from settings.agentNames, so labels match Settings. */
  agentNames?: Partial<Record<string, string>>;
}

export default function ProductionReviewPanel({
  story,
  chapter,
  scene,
  rolesEnabled,
  agentNames,
}: ProductionReviewPanelProps) {
  const scopeOptions = useMemo(() => buildScopeOptions(story, chapter, scene), [story, chapter, scene]);
  const [scopeKind, setScopeKind] = useState<BetaScopeOption['kind'] | null>(scopeOptions[0]?.kind ?? null);
  const activeScope = scopeOptions.find((o) => o.kind === scopeKind) ?? scopeOptions[0] ?? null;

  const [role, setRole] = useState<ProductionRoleId>('alphaReader');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { toast, showToast, clearToast } = useToast(4500);
  useAgentActivity(running);

  const roleName = resolveProductionRoleName(role, agentNames);
  const roleEnabled = rolesEnabled?.[role] === true;

  const handleRun = useCallback(async () => {
    if (!story || !activeScope) {
      showToast('Open a story first — a review needs something to read.', 'warn');
      return;
    }
    if (!roleEnabled) {
      showToast(`${roleName} is off — enable it in Settings › AI Agents to run a review.`, 'warn');
      return;
    }
    if (typeof window.api?.productionRoleRun !== 'function') {
      showToast('Production-team roles are unavailable in this build.', 'error');
      return;
    }
    const text = buildBetaReadSourceText(activeScope, story);
    if (!text.trim()) {
      showToast(`${activeScope.label} is empty — nothing to review.`, 'warn');
      return;
    }

    setRunning(true);
    setResult(null);
    try {
      const res = await window.api.productionRoleRun({ role, scope: activeScope, text });
      if ('error' in res) throw new Error(res.error);
      const reviewText = res.text.trim();
      setResult(reviewText || `${roleName} finished but returned no notes — try a longer scope.`);
      showToast(`${roleName} finished — review ready.`, 'info');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A deliberate stop via the shared activity indicator surfaces as a
      // rejection too — not a failure, so no error toast (mirrors BetaReaderPage).
      if (msg === 'cancelled') return;
      showToast(msg || `${roleName} failed — try again.`, 'error');
    } finally {
      setRunning(false);
    }
  }, [story, activeScope, role, roleEnabled, roleName, showToast]);

  return (
    <div className="beta-production-panel" data-testid="production-review-panel">
      <p className="beta-production-panel__intro">
        Run a production-team review of the current scope. Each role reads with a
        distinct lens; the Alpha Reader stays blind to twists it hasn’t reached yet.
      </p>

      <div className="beta-run-controls">
        <label className="beta-field">
          <span className="beta-field__label">Role</span>
          <select
            className="beta-select"
            aria-label="Production role"
            value={role}
            onChange={(e) => setRole(e.target.value as ProductionRoleId)}
          >
            {PRODUCTION_ROLE_IDS.map((id) => (
              <option key={id} value={id}>
                {resolveProductionRoleName(id, agentNames)}
                {rolesEnabled?.[id] === true ? '' : ' (off)'}
              </option>
            ))}
          </select>
        </label>

        <label className="beta-field">
          <span className="beta-field__label">Scope</span>
          <select
            className="beta-select"
            aria-label="Review scope"
            value={scopeKind ?? ''}
            disabled={scopeOptions.length === 0}
            onChange={(e) => setScopeKind(e.target.value as BetaScopeOption['kind'])}
          >
            {scopeOptions.map((o) => (
              <option key={o.kind} value={o.kind}>{o.label}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="beta-run-button"
          data-testid="production-review-run"
          disabled={running || !activeScope}
          onClick={handleRun}
        >
          {running ? 'Reviewing…' : `Run ${roleName}`}
        </button>
      </div>

      <p className="beta-production-panel__lens">{PRODUCTION_ROLES[role].lens}</p>

      {result !== null && (
        <div className="beta-production-panel__result" data-testid="production-review-result">
          <h3 className="beta-production-panel__result-title">{roleName} — {activeScope?.label}</h3>
          <pre className="beta-production-panel__result-body">{result}</pre>
        </div>
      )}

      <Toast message={toast?.message ?? null} level={toast?.level} onDismiss={clearToast} />
    </div>
  );
}
