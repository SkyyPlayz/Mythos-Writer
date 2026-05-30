import { useState, useEffect, useRef } from 'react';
import type { EntityType, EntityEntry } from './types';
import './EntityPicker.css';

const TYPE_LABELS: Record<string, string> = {
  character: 'Character', location: 'Location', faction: 'Faction',
  event: 'Event', item: 'Item', concept: 'Concept', other: 'Other',
};

interface SinglePickerProps {
  allowedTypes: EntityType[];
  value: string | null;
  onChange: (id: string | null) => void;
  onBlur?: () => void;
  placeholder?: string;
}

export function EntityPicker({ allowedTypes, value, onChange, onBlur, placeholder }: SinglePickerProps) {
  const [options, setOptions] = useState<EntityEntry[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<EntityEntry | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(allowedTypes.map(t => window.api.entityList(t))).then(results => {
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all: EntityEntry[] = (results as any[]).flatMap(r => r?.entities ?? []);
      setOptions(all);
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedTypes.join(',')]);

  useEffect(() => {
    if (!value) { setSelected(null); return; }
    const found = options.find(o => o.id === value) ?? null;
    setSelected(found);
  }, [value, options]);

  const filtered = query.trim()
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options.slice(0, 12);

  const handleSelect = (opt: EntityEntry) => {
    onChange(opt.id);
    setSelected(opt);
    setQuery('');
    setOpen(false);
    onBlur?.();
  };

  const handleClear = () => {
    onChange(null);
    setSelected(null);
    onBlur?.();
  };

  const handleCreate = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const type = allowedTypes[0];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await (window.api.entityCreate as any)({ name: trimmed, type });
      setOptions(prev => [...prev, created]);
      handleSelect(created);
    } catch { /* noop */ }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (open) onBlur?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onBlur]);

  if (selected) {
    return (
      <div className="ep-selected" ref={wrapRef}>
        <span className={`ep-chip ep-chip-${selected.type}`}>
          <span className="ep-chip-type">{TYPE_LABELS[selected.type]}</span>
          {selected.name}
        </span>
        <button className="ep-clear" onClick={handleClear} title="Clear selection">×</button>
      </div>
    );
  }

  return (
    <div className="ep-wrap" ref={wrapRef}>
      <input
        className="ep-input"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? `Search ${allowedTypes.map(t => TYPE_LABELS[t]).join(' / ')}…`}
      />
      {open && (
        <div className="ep-dropdown">
          {filtered.map(opt => (
            <button key={opt.id} className="ep-option" onMouseDown={() => handleSelect(opt)}>
              <span className={`ep-chip ep-chip-${opt.type}`}>{TYPE_LABELS[opt.type]}</span>
              <span className="ep-option-name">{opt.name}</span>
            </button>
          ))}
          {query.trim() && !filtered.find(o => o.name.toLowerCase() === query.trim().toLowerCase()) && (
            <button className="ep-option ep-create" onMouseDown={handleCreate}>
              + Create &ldquo;{query.trim()}&rdquo; as {TYPE_LABELS[allowedTypes[0]]}
            </button>
          )}
          {filtered.length === 0 && !query.trim() && (
            <div className="ep-empty">No {allowedTypes.map(t => TYPE_LABELS[t]).join(' / ')} entities yet</div>
          )}
        </div>
      )}
    </div>
  );
}

interface MultiPickerProps {
  allowedTypes: EntityType[];
  value: string[];
  onChange: (ids: string[]) => void;
  onBlur?: () => void;
  placeholder?: string;
}

export function MultiEntityPicker({ allowedTypes, value, onChange, onBlur, placeholder }: MultiPickerProps) {
  const [options, setOptions] = useState<EntityEntry[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(allowedTypes.map(t => window.api.entityList(t))).then(results => {
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all: EntityEntry[] = (results as any[]).flatMap(r => r?.entities ?? []);
      setOptions(all);
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedTypes.join(',')]);

  const selected = value.map(id => options.find(o => o.id === id)).filter(Boolean) as EntityEntry[];

  const filtered = query.trim()
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()) && !value.includes(o.id))
    : options.filter(o => !value.includes(o.id)).slice(0, 12);

  const handleAdd = (opt: EntityEntry) => {
    onChange([...value, opt.id]);
    setQuery('');
    setOpen(false);
    onBlur?.();
  };

  const handleRemove = (id: string) => {
    onChange(value.filter(v => v !== id));
    onBlur?.();
  };

  const handleCreate = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const type = allowedTypes[0];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await (window.api.entityCreate as any)({ name: trimmed, type });
      setOptions(prev => [...prev, created]);
      handleAdd(created);
    } catch { /* noop */ }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (open) onBlur?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onBlur]);

  return (
    <div className="ep-multi-wrap" ref={wrapRef}>
      <div className="ep-multi-chips">
        {selected.map(opt => (
          <span key={opt.id} className={`ep-chip ep-chip-${opt.type}`}>
            <span className="ep-chip-type">{TYPE_LABELS[opt.type]}</span>
            {opt.name}
            <button className="ep-chip-remove" onMouseDown={() => handleRemove(opt.id)}>×</button>
          </span>
        ))}
        <input
          className="ep-multi-input"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length === 0 ? (placeholder ?? `Add ${allowedTypes.map(t => TYPE_LABELS[t]).join(' / ')}…`) : ''}
        />
      </div>
      {open && (
        <div className="ep-dropdown">
          {filtered.map(opt => (
            <button key={opt.id} className="ep-option" onMouseDown={() => handleAdd(opt)}>
              <span className={`ep-chip ep-chip-${opt.type}`}>{TYPE_LABELS[opt.type]}</span>
              <span className="ep-option-name">{opt.name}</span>
            </button>
          ))}
          {query.trim() && !filtered.find(o => o.name.toLowerCase() === query.trim().toLowerCase()) && (
            <button className="ep-option ep-create" onMouseDown={handleCreate}>
              + Create &ldquo;{query.trim()}&rdquo; as {TYPE_LABELS[allowedTypes[0]]}
            </button>
          )}
          {filtered.length === 0 && !query.trim() && (
            <div className="ep-empty">No more {allowedTypes.map(t => TYPE_LABELS[t]).join(' / ')} to add</div>
          )}
        </div>
      )}
    </div>
  );
}
