import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './DropdownSelect.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  'aria-label'?: string;
  disabled?: boolean;
  id?: string;
}

const MARGIN = 8;
const FALLBACK_H = 200;

export function DropdownSelect({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  'aria-label': ariaLabel,
  disabled = false,
  id,
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id ?? 'ln-select'}-listbox`;

  const selectedOption = options.find((o) => o.value === value);

  const close = useCallback(() => {
    setOpen(false);
    setFocusedIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const select = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      close();
    },
    [onChange, close],
  );

  // Position the listbox below (or above) the trigger.
  useLayoutEffect(() => {
    const listbox = listboxRef.current;
    const trigger = triggerRef.current;
    if (!open || !listbox || !trigger) return;

    const rect = trigger.getBoundingClientRect();
    const lH = listbox.offsetHeight || FALLBACK_H;
    const vH = window.innerHeight;
    const vW = window.innerWidth;
    const triggerWidth = rect.width;

    let top = rect.bottom + 4;
    let left = rect.left;

    // Flip above if not enough room below.
    if (top + lH > vH - MARGIN) top = rect.top - lH - 4;
    top = Math.max(MARGIN, top);

    // Clamp left so listbox stays in viewport.
    if (left + triggerWidth > vW - MARGIN) left = vW - triggerWidth - MARGIN;
    left = Math.max(MARGIN, left);

    listbox.style.top = `${top}px`;
    listbox.style.left = `${left}px`;
    listbox.style.width = `${triggerWidth}px`;
  }, [open]);

  // On open: focus the currently-selected option (or first enabled).
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value && !o.disabled);
    setFocusedIndex(idx >= 0 ? idx : options.findIndex((o) => !o.disabled));
  }, [open, value, options]);

  // Drive focus to the focused option element.
  useEffect(() => {
    if (!open || focusedIndex < 0 || !listboxRef.current) return;
    const opts = listboxRef.current.querySelectorAll<HTMLElement>('[role="option"]');
    opts[focusedIndex]?.focus();
  }, [focusedIndex, open]);

  // Dismiss on outside click.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        listboxRef.current &&
        !listboxRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [open, close]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const handleListboxKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = options.findIndex((o, i) => i > focusedIndex && !o.disabled);
        if (next >= 0) setFocusedIndex(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        let prev = -1;
        for (let i = focusedIndex - 1; i >= 0; i--) {
          if (!options[i].disabled) { prev = i; break; }
        }
        if (prev >= 0) setFocusedIndex(prev);
        break;
      }
      case 'Home': {
        e.preventDefault();
        const first = options.findIndex((o) => !o.disabled);
        if (first >= 0) setFocusedIndex(first);
        break;
      }
      case 'End': {
        e.preventDefault();
        let last = -1;
        for (let i = options.length - 1; i >= 0; i--) {
          if (!options[i].disabled) { last = i; break; }
        }
        if (last >= 0) setFocusedIndex(last);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const opt = options[focusedIndex];
        if (opt && !opt.disabled) select(opt.value);
        break;
      }
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        close();
        break;
    }
  };

  return (
    <div className="ln-select" id={id}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        className="ln-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span
          className={[
            'ln-select-value',
            !selectedOption ? 'ln-select-value--placeholder' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className="ln-select-chevron"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="ln-select-listbox"
            style={{ position: 'fixed', zIndex: 9999 }}
            onKeyDown={handleListboxKeyDown}
            data-testid="ln-select-listbox"
          >
            {options.map((option, i) => (
              <div
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled ?? false}
                tabIndex={-1}
                className={[
                  'ln-select-option',
                  option.value === value ? 'ln-select-option--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-testid={`select-option-${option.value}`}
                onClick={() => {
                  if (!option.disabled) select(option.value);
                }}
                onMouseEnter={() => {
                  if (!option.disabled) setFocusedIndex(i);
                }}
              >
                {option.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
