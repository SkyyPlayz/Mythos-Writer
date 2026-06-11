import { useState, useEffect } from 'react';
import './TemplatePicker.css';

interface TemplateItem {
  id: string;
  name: string;
  description: string;
  isUserTemplate?: boolean;
}

interface Props {
  onApplied: () => void;
  onClose: () => void;
}

export default function TemplatePicker({ onApplied, onClose }: Props) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [selected, setSelected] = useState<TemplateItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (window.api as any).templateList?.()
      .then((res: { templates: TemplateItem[] }) => setTemplates(res.templates ?? []))
      .catch(() => {});
  }, []);

  const handleApply = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Get a registration token by having the user pick a target folder
      const folderRes = await window.api.pickFolder();
      if (folderRes.cancelled || !folderRes.registrationToken) {
        setBusy(false);
        return;
      }
      const res = await (window.api as any).templateScaffold(selected.id, folderRes.registrationToken);
      if (res && 'error' in res) throw new Error(res.error);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply template');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tp-backdrop" role="dialog" aria-modal="true" aria-label="Choose a template">
      <div className="tp-modal">
        <div className="tp-header">
          <h2 className="tp-title">Choose a project template</h2>
          <button className="tp-close" onClick={onClose} aria-label="Close template picker">×</button>
        </div>
        <div className="tp-grid" role="list">
          {templates.map((t) => (
            <button
              key={t.id}
              role="listitem"
              className={`tp-card${selected?.id === t.id ? ' tp-card--selected' : ''}`}
              data-testid={`template-${t.id}`}
              onClick={() => setSelected(t)}
            >
              {t.isUserTemplate && <span className="tp-badge">Saved</span>}
              <span className="tp-card-name">{t.name}</span>
              <span className="tp-card-desc">{t.description}</span>
            </button>
          ))}
        </div>
        {error && <p className="tp-error" role="alert">{error}</p>}
        <div className="tp-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleApply} disabled={!selected || busy} data-testid="tp-apply">
            {busy ? 'Applying…' : `Apply "${selected?.name ?? '…'}"`}
          </button>
        </div>
      </div>
    </div>
  );
}
