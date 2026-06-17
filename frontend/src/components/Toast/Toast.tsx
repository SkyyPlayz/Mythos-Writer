import './Toast.css';
import type { ToastLevel } from '../../hooks/useToast';

interface ToastProps {
  message: string | null;
  level?: ToastLevel;
  /** Optional inline action button (e.g. Undo). */
  action?: { label: string; onClick: () => void };
  /** If provided, renders a dismiss (✕) button. */
  onDismiss?: () => void;
  /** Extra CSS class — use to adjust bottom offset when stacking multiple toasts. */
  className?: string;
}

/**
 * Floating fixed-position toast notification.
 * Pair with `useToast()` for state and timer management.
 *
 * @example
 *   const { toast, showToast } = useToast();
 *   showToast('Saved!', 'info');
 *   // ...
 *   <Toast message={toast?.message ?? null} level={toast?.level} />
 */
export function Toast({ message, level = 'info', action, onDismiss, className }: ToastProps) {
  if (!message) return null;
  return (
    <div
      className={`app-toast app-toast--${level}${className ? ` ${className}` : ''}`}
      role={level === 'error' ? 'alert' : 'status'}
      aria-live={level === 'error' ? 'assertive' : 'polite'}
      data-testid="app-toast"
    >
      <span className="app-toast__message">{message}</span>
      {action && (
        <button type="button" className="app-toast__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          className="app-toast__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      )}
    </div>
  );
}
