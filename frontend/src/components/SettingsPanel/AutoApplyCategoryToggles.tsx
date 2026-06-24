import { SUGGESTION_CATEGORY_LABELS } from '../../types';
import { SUGGESTION_CATEGORY_ORDER, isCategoryAutoApplyEnabled } from './settingsPanelTypes';

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
}

export default function AutoApplyCategoryToggles({
  idPrefix,
  agentLabel,
  agent,
  agentKey,
  onChange,
}: AutoApplyCategoryTogglesProps) {
  if (!agent.autoApply) return null;
  return (
    <fieldset
      className="settings-category-toggles"
      data-testid={`${idPrefix}-category-toggles`}
      aria-label={`${agentLabel} auto-apply categories`}
    >
      <legend className="settings-category-toggles-legend">
        Auto-apply categories
      </legend>
      {SUGGESTION_CATEGORY_ORDER.map((category) => {
        const id = `${idPrefix}-cat-${category}`;
        const checked = isCategoryAutoApplyEnabled(agent, category);
        return (
          <div key={category} className="settings-field settings-field-inline">
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
        );
      })}
    </fieldset>
  );
}
