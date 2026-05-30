import { useState, useRef, useCallback, useEffect } from 'react';
import './TagInput.css';

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  allTags?: string[];
  placeholder?: string;
  disabled?: boolean;
}

export default function TagInput({ value, onChange, allTags = [], placeholder = 'Add tag…', disabled }: Props) {
  const [input, setInput] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = allTags.filter(
    (t) => t.toLowerCase().includes(input.toLowerCase()) && !value.includes(t)
  ).slice(0, 8);

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInput('');
    setShowDropdown(false);
    setActiveIdx(-1);
  }, [value, onChange]);

  const removeTag = useCallback((tag: string) => {
    onChange(value.filter((t) => t !== tag));
  }, [value, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        addTag(suggestions[activeIdx]);
      } else if (input.trim()) {
        addTag(input);
      }
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  useEffect(() => {
    setShowDropdown(input.length > 0 && suggestions.length > 0);
    setActiveIdx(-1);
  }, [input, suggestions.length]);

  return (
    <div className="tag-input-wrap" onClick={() => inputRef.current?.focus()}>
      {value.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          {!disabled && (
            <button
              className="tag-chip-remove"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              aria-label={`Remove tag ${tag}`}
              type="button"
            >×</button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          ref={inputRef}
          className="tag-input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => input && setShowDropdown(suggestions.length > 0)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder={value.length === 0 ? placeholder : ''}
          aria-label="Add tag"
        />
      )}
      {showDropdown && (
        <div className="tag-dropdown" role="listbox">
          {suggestions.map((s, i) => (
            <button
              key={s}
              role="option"
              aria-selected={i === activeIdx}
              className={`tag-dropdown-item${i === activeIdx ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
