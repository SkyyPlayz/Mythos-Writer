/**
 * Slice C — production-team role toggles (SKY-11411 / SKY-11412).
 * Soft-FAIL keeps four classic agent cards unmounted; these opt-in roles stay
 * on Model & keys so Beta Reader › Production Team can enable them.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { resolveProductionRoleName } from '../agents/productionRoles';
import {
  LISTABLE_PROVIDERS,
  MODEL_OPTIONS,
  type ModelListStatus,
  type ProviderKind,
} from '../components/SettingsPanel/settingsPanelTypes';

type ProductionRoleKey = 'alphaReader' | 'storylineConsultant' | 'lineEditor';

const ROLES: readonly {
  key: ProductionRoleKey;
  label: string;
  idPrefix: string;
  hint: string;
}[] = [
  {
    key: 'alphaReader',
    label: 'Alpha Reader',
    idPrefix: 'alpha-reader',
    hint: 'First-pass reader — raw reactions, blind to twists it hasn’t reached yet.',
  },
  {
    key: 'storylineConsultant',
    label: 'Storyline Consultant',
    idPrefix: 'storyline-consultant',
    hint: 'Structural review — arc, stakes, and whether every setup pays off.',
  },
  {
    key: 'lineEditor',
    label: 'Line Editor',
    idPrefix: 'line-editor',
    hint: 'Sentence-level craft — rhythm, word choice, grammar. Never changes meaning.',
  },
];

function RoleModelField({
  idPrefix,
  label,
  value,
  onChange,
  providerKind,
  providerModel,
  modelList,
  modelListStatus,
}: {
  idPrefix: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  providerKind: ProviderKind;
  providerModel: string;
  modelList: string[];
  modelListStatus: ModelListStatus;
}) {
  const [useCustomInput, setUseCustomInput] = useState(false);
  useEffect(() => { setUseCustomInput(false); }, [providerKind]);
  const fieldId = `${idPrefix}-model`;
  const defaultOptionLabel = providerModel ? `Default (${providerModel})` : 'Default';
  const options = providerKind === 'anthropic' ? MODEL_OPTIONS : modelList.map((m) => ({ value: m, label: m }));
  const hasOptions = providerKind === 'anthropic'
    || (LISTABLE_PROVIDERS.has(providerKind) && modelListStatus === 'ok' && modelList.length > 0);

  return (
    <div className="settings-field settings-field-inline">
      <label className="settings-label" htmlFor={fieldId}>Model</label>
      {hasOptions && !useCustomInput ? (
        <select
          id={fieldId}
          className="settings-input settings-select settings-input-sm"
          value={value}
          aria-label={label}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '__custom__') {
              setUseCustomInput(true);
              onChange('');
            } else {
              onChange(val);
            }
          }}
        >
          <option value="">{defaultOptionLabel}</option>
          {value !== '' && !options.some((o) => o.value === value) && (
            <option value={value}>{value}</option>
          )}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {providerKind !== 'anthropic' && <option value="__custom__">Custom…</option>}
        </select>
      ) : (
        <input
          id={fieldId}
          className="settings-input settings-input-sm"
          type="text"
          value={value}
          placeholder={providerModel ? `Default: ${providerModel}` : 'model name (e.g. llama3-70b)'}
          aria-label={label}
          maxLength={128}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

interface Props {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  providerKind: ProviderKind;
  providerModel: string;
  modelList: string[];
  modelListStatus: ModelListStatus;
  setSavedOk: (ok: boolean) => void;
}

export default function ProductionRolesSection({
  settings,
  setSettings,
  providerKind,
  providerModel,
  modelList,
  modelListStatus,
  setSavedOk,
}: Props) {
  const setRoleField = <K extends 'enabled' | 'model'>(
    key: ProductionRoleKey,
    field: K,
    value: K extends 'enabled' ? boolean : string,
  ) => {
    setSettings((prev) => ({
      ...prev,
      agents: {
        ...prev.agents,
        [key]: {
          ...(prev.agents[key] ?? { enabled: false, model: '' }),
          [field]: value,
        },
      },
    }));
    setSavedOk(false);
  };

  return (
    <section
      className="settings-section"
      aria-labelledby="section-production-roles"
      data-settings-cat="agents"
      data-testid="production-roles-section"
    >
      <h3 className="settings-section-title" id="section-production-roles">Production team roles</h3>
      <p className="settings-hint">
        Opt-in roles for Beta Reader › Production Team. All default off — nothing calls a provider until you enable it.
      </p>
      {ROLES.map(({ key, label, idPrefix, hint }) => {
        const roleSettings = settings.agents[key];
        return (
          <div key={key} className="settings-agent-card" data-testid={`${idPrefix}-agent-card`}>
            <div className="settings-agent-header">
              <span className="settings-agent-name">{resolveProductionRoleName(key, settings.agentNames)}</span>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label={`Enable ${label}`}
                  checked={roleSettings?.enabled ?? false}
                  onChange={(e) => setRoleField(key, 'enabled', e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>
            <div className="settings-agent-fields">
              <p className="settings-hint" style={{ marginBottom: '0.5rem' }}>{hint}</p>
              <RoleModelField
                idPrefix={idPrefix}
                label={`${label} model`}
                value={roleSettings?.model ?? ''}
                onChange={(v) => setRoleField(key, 'model', v)}
                providerKind={providerKind}
                providerModel={providerModel}
                modelList={modelList}
                modelListStatus={modelListStatus}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}
