// SKY-207: Scene properties panel — custom frontmatter fields editor.
import { useState, useEffect, useRef } from 'react';
import './ScenePropertiesPanel.css';

type FieldType = 'text' | 'number' | 'select';

interface CustomFieldDef {
  id: string;
  name: string;
  type: FieldType;
  options?: string[];
}

interface Props {
  sceneId: string;
}

const SAVE_DEBOUNCE_MS = 800;

export default function ScenePropertiesPanel({ sceneId }: Props) {
  const [fieldDefs, setFieldDefs] = useState<CustomFieldDef[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoaded(false);
    Promise.all([
      (window.api as any).customFieldsList?.() as Promise<{ fields: CustomFieldDef[] }>,
      (window.api as any).scenePropsGet?.(sceneId) as Promise<{ customFields: Record<string, unknown> }>,
    ])
      .then(([defsRes, propsRes]) => {
        setFieldDefs(defsRes?.fields ?? []);
        setValues(propsRes?.customFields ?? {});
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [sceneId]);

  const handleChange = (name: string, value: unknown) => {
    const next = { ...values, [name]: value };
    setValues(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      (window.api as any).scenePropsSet?.(sceneId, { [name]: value }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  };

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  if (!loaded || fieldDefs.length === 0) return null;

  return (
    <div className="scene-props-panel" aria-label="Scene properties">
      <span className="scene-props-label">Properties</span>
      <div className="scene-props-fields">
        {fieldDefs.map((def) => {
          const val = values[def.name];
          const fieldId = `scene-prop-${def.name}`;
          return (
            <div key={def.id} className="scene-props-field">
              <label className="scene-props-field-label" htmlFor={fieldId}>
                {def.name}
              </label>
              {def.type === 'text' && (
                <input
                  id={fieldId}
                  className="scene-props-input"
                  type="text"
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => handleChange(def.name, e.target.value)}
                  aria-label={def.name}
                />
              )}
              {def.type === 'number' && (
                <input
                  id={fieldId}
                  className="scene-props-input scene-props-input--number"
                  type="number"
                  value={typeof val === 'number' ? val : ''}
                  onChange={(e) => handleChange(def.name, e.target.value === '' ? '' : Number(e.target.value))}
                  aria-label={def.name}
                />
              )}
              {def.type === 'select' && (
                <select
                  id={fieldId}
                  className="scene-props-select"
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => handleChange(def.name, e.target.value)}
                  aria-label={def.name}
                >
                  <option value="">—</option>
                  {(def.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
