import { SUGGESTION_CATEGORY_LABELS } from '../../types';
import {
  SUGGESTION_CATEGORY_ORDER,
  isCategoryAutoApplyEnabled,
  categoryAutoApplyThreshold,
} from './settingsPanelTypes';

interface AutoApplyCategoryTogglesProps {
  idPrefix: string;
  agentLabel: string;
  agent: AgentBudgetSettings;
  agentKey: keyof AppSettings['agents'];
  onChange: (
    agent: keyof AppSettings['agents'],
    category: SuggestionCategory,
    enabled: boolean,
  ) => void;
  /** Beta 4 M28 (B4-8): per-category certainty slider writes autoApplyThresholds. */
  onThresholdChange: (
    agent: keyof AppSettings['agents'],
    category: SuggestionCategory,
    threshold: number,
  ) => void;
}

/**
 * Beta 4 M28 — Autonomy card body (B4-8, binding owner decision):
 * every auto-apply toggle ships OFF by default, and each category carries a
 * certainty slider. Suggestions at/above the threshold auto-apply
 * (snapshot-first, undoable); below it they land in the suggestion inbox
 * (the Assistant panel's review list) instead.
 */
export default function AutoApplyCategoryToggles({
  idPrefix,
  agentLabel,
  agent,
  agentKey,
  onChange,
  onThresholdChange,
}: AutoApplyCategoryTogglesProps) {
  if (!agent.autoApply) return null;
  return (
    <fieldset
      className="settings-category-toggles"
      data-testid={`${idPrefix}-category-toggles`}
      aria-label={`${agentLabel} auto-apply categories`}
    >
      <legend className="settings-category-toggles-legend">
        Autonomy — auto-apply categories
      </legend>
      <p className="settings-hint settings-category-toggles-hint">
        Suggestions at or above a category&rsquo;s certainty auto-apply — a snapshot is
        saved first, so every change is undoable. Anything below the bar lands in the
        suggestion inbox for review instead.
      </p>
      {SUGGESTION_CATEGORY_ORDER.map((category) => {
        const id = `${idPrefix}-cat-${category}`;
        const checked = isCategoryAutoApplyEnabled(agent, category);
        const threshold = categoryAutoApplyThreshold(agent, category);
        return (
          <div key={category} className="settings-category-toggle-row">
            <div className="settings-field settings-field-inline">
              <label className="settings-toggle" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  aria-label={`${agentLabel} auto-apply ${SUGGESTION_CATEGORY_LABELS[category]}`}
                  checked={checked}
                  onChange={(e) => onChange(agentKey, category, e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
              <span className="settings-label">{SUGGESTION_CATEGORY_LABELS[category]}</span>
            </div>
            <div className="settings-field settings-field-inline settings-category-threshold-row">
              <div className="settings-slider-row">
                <input
                  id={`${id}-threshold`}
                  className="settings-slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  disabled={!checked}
                  value={threshold}
                  aria-label={`${agentLabel} ${SUGGESTION_CATEGORY_LABELS[category]} certainty threshold`}
                  data-testid={`${id}-threshold`}
                  onChange={(e) => onThresholdChange(agentKey, category, Number(e.target.value))}
                />
                <span className="settings-slider-value">{threshold.toFixed(2)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
