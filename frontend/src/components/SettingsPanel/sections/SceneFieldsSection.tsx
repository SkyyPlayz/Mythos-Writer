import { useState, useCallback, useEffect } from 'react';
import type { FieldType, CustomFieldDef } from '../settingsPanelTypes';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface SceneFieldsSectionProps {}

export default function SceneFieldsSection(_props: SceneFieldsSectionProps) {
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [customFieldsDirty, setCustomFieldsDirty] = useState(false);
  const [customFieldsSavedOk, setCustomFieldsSavedOk] = useState(false);
  const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');
  const [addingField, setAddingField] = useState(false);

  useEffect(() => {
    window.api.customFieldsList?.()
      .then((res: { fields: CustomFieldDef[] }) => {
        if (res?.fields) setCustomFields(res.fields);
      })
      .catch(() => {});
  }, []);

  const handleSaveCustomFields = useCallback(async () => {
    setCustomFieldsError(null);
    setCustomFieldsSavedOk(false);
    try {
      const res = await window.api.customFieldsSet?.(customFields) as { fields: CustomFieldDef[] };
      if (res?.fields) {
        setCustomFields(res.fields);
        setCustomFieldsDirty(false);
        setCustomFieldsSavedOk(true);
      }
    } catch (e) {
      setCustomFieldsError(e instanceof Error ? e.message : 'Failed to save field definitions.');
    }
  }, [customFields]);

  const handleAddField = useCallback(() => {
    const name = newFieldName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!name) return;
    if (customFields.some((f) => f.name === name)) {
      setCustomFieldsError(`A field named "${name}" already exists.`);
      return;
    }
    const options = newFieldType === 'select'
      ? newFieldOptions.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const newDef: CustomFieldDef = {
      id: crypto.randomUUID(),
      name,
      type: newFieldType,
      ...(options ? { options } : {}),
    };
    setCustomFields((prev) => [...prev, newDef]);
    setCustomFieldsDirty(true);
    setCustomFieldsSavedOk(false);
    setCustomFieldsError(null);
    setNewFieldName('');
    setNewFieldOptions('');
    setAddingField(false);
  }, [customFields, newFieldName, newFieldType, newFieldOptions]);

  const handleRemoveField = useCallback((id: string) => {
    setCustomFields((prev) => prev.filter((f) => f.id !== id));
    setCustomFieldsDirty(true);
    setCustomFieldsSavedOk(false);
  }, []);

  return (
    <section className="settings-section" aria-labelledby="section-scene-fields" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-scene-fields">Scene Fields</h3>
      <p className="settings-hint">
        Define custom frontmatter fields — mood, tension, weather, POV, etc. — that appear in the scene
        properties panel and are queryable in Saved Searches (e.g. <code>mood: tense AND tension: 8</code>).
        Removing a field definition does not delete existing values from scene files.
      </p>
      {customFields.length > 0 && (
        <ul className="cf-field-list" aria-label="Custom field definitions">
          {customFields.map((f) => (
            <li key={f.id} className="cf-field-item">
              <span className="cf-field-name">{f.name}</span>
              <span className="cf-field-type">{f.type}</span>
              {f.type === 'select' && f.options && (
                <span className="cf-field-options">{f.options.join(', ')}</span>
              )}
              <button
                type="button"
                className="cf-field-remove"
                aria-label={`Remove field ${f.name}`}
                onClick={() => handleRemoveField(f.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {!addingField ? (
        <button
          type="button"
          className="settings-btn settings-btn-secondary"
          onClick={() => { setAddingField(true); setCustomFieldsError(null); }}
        >
          + Add field
        </button>
      ) : (
        <div className="cf-add-form" role="group" aria-label="Add custom field">
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor="cf-name">Name</label>
            <input
              id="cf-name"
              className="settings-input"
              type="text"
              placeholder="mood"
              value={newFieldName}
              autoFocus
              onChange={(e) => setNewFieldName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddField(); if (e.key === 'Escape') setAddingField(false); }}
            />
          </div>
          <div className="settings-field settings-field-inline">
            <label className="settings-label" htmlFor="cf-type">Type</label>
            <select
              id="cf-type"
              className="settings-input settings-select"
              value={newFieldType}
              onChange={(e) => setNewFieldType(e.target.value as FieldType)}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="select">Select</option>
            </select>
          </div>
          {newFieldType === 'select' && (
            <div className="settings-field settings-field-inline">
              <label className="settings-label" htmlFor="cf-options">Options</label>
              <input
                id="cf-options"
                className="settings-input"
                type="text"
                placeholder="calm, tense, urgent"
                value={newFieldOptions}
                onChange={(e) => setNewFieldOptions(e.target.value)}
              />
              <span className="settings-hint" style={{ marginLeft: 8 }}>comma-separated</span>
            </div>
          )}
          <div className="settings-input-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="settings-btn settings-btn-save"
              onClick={handleAddField}
              disabled={!newFieldName.trim()}
            >
              Add
            </button>
            <button
              type="button"
              className="settings-btn settings-btn-cancel"
              onClick={() => setAddingField(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {customFieldsDirty && (
        <div className="settings-input-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="settings-btn settings-btn-secondary"
            onClick={handleSaveCustomFields}
          >
            Save field definitions
          </button>
          {customFieldsSavedOk && <span className="settings-saved-msg" role="status">Saved.</span>}
          {customFieldsError && <span className="settings-error-msg" role="alert">{customFieldsError}</span>}
        </div>
      )}
      {!customFieldsDirty && customFieldsSavedOk && (
        <span className="settings-saved-msg" role="status">Saved.</span>
      )}
    </section>
  );
}
