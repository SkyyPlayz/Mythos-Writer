import { useCallback, useRef, useState } from 'react';

/**
 * Promise-based text prompt to replace window.prompt(), which Electron does not
 * support ("prompt() is not supported"). Returns a `requestText` function that
 * resolves with the entered string (or null if cancelled) and a `promptModal`
 * element the caller renders somewhere in its tree.
 */
export function useTextPrompt(): {
  requestText: (label: string) => Promise<string | null>;
  promptModal: React.ReactNode;
} {
  const [label, setLabel] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const resolverRef = useRef<((v: string | null) => void) | null>(null);

  const settle = useCallback((result: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setLabel(null);
    setValue('');
    resolve?.(result);
  }, []);

  const requestText = useCallback((promptLabel: string): Promise<string | null> => {
    // Resolve any previous outstanding prompt as cancelled before opening a new one.
    resolverRef.current?.(null);
    setValue('');
    setLabel(promptLabel);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const promptModal =
    label === null ? null : (
      <div
        className="prompt-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => {
          if (e.target === e.currentTarget) settle(null);
        }}
      >
        <div className="prompt-modal">
          <label className="prompt-modal-label">{label}</label>
          <input
            className="prompt-modal-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') settle(value);
              else if (e.key === 'Escape') settle(null);
            }}
          />
          <div className="prompt-modal-actions">
            <button type="button" className="prompt-modal-cancel" onClick={() => settle(null)}>
              Cancel
            </button>
            <button type="button" className="prompt-modal-ok" onClick={() => settle(value)}>
              OK
            </button>
          </div>
        </div>
      </div>
    );

  return { requestText, promptModal };
}
