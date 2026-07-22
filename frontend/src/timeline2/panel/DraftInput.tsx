// Beta 4 M25 — §1.4 draft-commit inputs for the Inspector.
// Formatted fields keep a raw draft while focused and commit on blur/Enter;
// they never reformat mid-keystroke. Escape reverts to the last committed
// value. Numeric commits that don't parse are dropped (the field snaps back).
import { useState } from 'react';

interface DraftTextInputProps {
  value: string;
  onCommit: (value: string) => void;
  /** Fires on every keystroke — lets titles update the canvas live. */
  onLive?: (value: string) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  multiline?: boolean;
}

export function DraftTextInput({
  value,
  onCommit,
  onLive,
  multiline = false,
  ...rest
}: DraftTextInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    if (draft != null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      (e.target as HTMLElement).blur();
    } else if (e.key === 'Escape') {
      if (draft != null && onLive) onLive(value);
      setDraft(null);
    }
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    onLive?.(e.target.value);
  };

  if (multiline) {
    return (
      <textarea {...rest} value={shown} onChange={onChange} onBlur={commit} onKeyDown={onKeyDown} />
    );
  }
  return <input {...rest} value={shown} onChange={onChange} onBlur={commit} onKeyDown={onKeyDown} />;
}

interface DraftNumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  /** Reject a parsed commit (e.g. chapter < 1); the field snaps back. */
  validate?: (value: number) => boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** Trim trailing float noise without ever reformatting while focused. */
function formatNumber(value: number): string {
  return String(Number.isFinite(value) ? parseFloat(value.toFixed(2)) : 0);
}

export function DraftNumberInput({ value, onCommit, validate, ...rest }: DraftNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatNumber(value);

  const commit = () => {
    if (draft != null) {
      const parsed = parseFloat(draft);
      if (Number.isFinite(parsed) && parsed !== value && (!validate || validate(parsed))) {
        onCommit(parsed);
      }
    }
    setDraft(null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') (e.target as HTMLElement).blur();
    else if (e.key === 'Escape') setDraft(null);
  };

  return (
    <input
      {...rest}
      inputMode="decimal"
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
