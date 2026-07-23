import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import './Dialog.css';

export type DialogVariant = 'default' | 'destructive' | 'form';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  variant?: DialogVariant;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  /** Extra class(es) merged onto the dialog panel — for callers with bespoke panel skins. */
  className?: string;
  /** data-testid on the overlay (the click-outside-to-close backdrop). */
  overlayTestId?: string;
  /** data-testid on the dialog panel itself. */
  testId?: string;
  children: ReactNode;
}

export interface DialogHeaderProps {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}

export interface DialogBodyProps {
  children: ReactNode;
  id?: string;
  className?: string;
}

export interface DialogFooterProps {
  children: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DialogHeader({ children, onClose, className }: DialogHeaderProps) {
  return (
    <header className={['ln-dialog-header', className].filter(Boolean).join(' ')}>
      <div className="ln-dialog-header-content">{children}</div>
      {onClose && (
        <button type="button" className="ln-dialog-close" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      )}
    </header>
  );
}

export function DialogBody({ children, id, className }: DialogBodyProps) {
  return (
    <div className={['ln-dialog-body', className].filter(Boolean).join(' ')} id={id}>
      {children}
    </div>
  );
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return (
    <footer className={['ln-dialog-footer', className].filter(Boolean).join(' ')}>{children}</footer>
  );
}

export default function Dialog({
  open,
  onClose,
  variant = 'default',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  className,
  overlayTestId,
  testId,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Capture trigger and restore focus on close
  useEffect(() => {
    if (!open) return;
    const lastFocus = document.activeElement;
    const dialog = dialogRef.current;

    // Autofocus: if nothing inside the dialog already has focus (e.g. from autoFocus attr),
    // move focus to the first focusable element or the panel itself.
    if (dialog && !dialog.contains(document.activeElement)) {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        dialog.focus();
      }
    }

    return () => {
      if (lastFocus instanceof HTMLElement) {
        lastFocus.focus();
      }
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  const handleOverlayClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div className="ln-dialog-overlay" onClick={handleOverlayClick} data-testid={overlayTestId}>
      <div
        className={['ln-dialog', `ln-dialog--${variant}`, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}
