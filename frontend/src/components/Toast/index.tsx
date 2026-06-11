import { useEffect, useRef } from 'react';
import './Toast.css';

interface ToastProps {
  message: string;
  variant?: 'success' | 'error';
  onDismiss: () => void;
  durationMs?: number;
}

export default function Toast({ message, variant = 'success', onDismiss, durationMs = 4000 }: ToastProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const id = setTimeout(() => onDismissRef.current(), durationMs);
    return () => clearTimeout(id);
  }, [durationMs]);

  return (
    <div
      className={`app-toast app-toast--${variant}`}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      data-testid="app-toast"
    >
      <span className="app-toast__message">{message}</span>
      <button
        type="button"
        className="app-toast__close"
        onClick={onDismiss}
        aria-label="Close notification"
        data-testid="app-toast-close"
      >
        ×
      </button>
    </div>
  );
}
