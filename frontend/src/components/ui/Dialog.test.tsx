import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from './Dialog';

const DIALOG_CSS = readFileSync(resolve(process.cwd(), 'src/components/ui/Dialog.css'), 'utf-8');

function BasicDialog({
  open = true,
  onClose = vi.fn(),
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="dlg-title">
      <DialogHeader onClose={onClose}>
        <h2 id="dlg-title">Test Dialog</h2>
      </DialogHeader>
      <DialogBody id="dlg-body">
        <p>Body content</p>
      </DialogBody>
      <DialogFooter>
        <button>Cancel</button>
        <button>Confirm</button>
      </DialogFooter>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(<BasicDialog open={false} />);
    expect(container.querySelector('.ln-dialog-overlay')).toBeNull();
  });

  it('renders dialog panel when open is true', () => {
    render(<BasicDialog />);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Body content')).toBeDefined();
  });

  it('has aria-modal="true"', () => {
    render(<BasicDialog />);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });

  it('passes aria-labelledby through to the panel', () => {
    render(<BasicDialog />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('dlg-title');
  });

  it('passes aria-describedby through to the panel', () => {
    render(
      <Dialog open onClose={vi.fn()} aria-describedby="dlg-body">
        <DialogBody id="dlg-body">desc</DialogBody>
      </Dialog>,
    );
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBe('dlg-body');
  });

  it('passes aria-label through to the panel when provided', () => {
    render(
      <Dialog open onClose={vi.fn()} aria-label="My dialog">
        <p>content</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('My dialog');
  });

  it('applies the variant class', () => {
    render(<BasicDialog />);
    expect(screen.getByRole('dialog').classList.contains('ln-dialog--default')).toBe(true);
  });

  it('applies destructive variant class', () => {
    render(
      <Dialog open onClose={vi.fn()} variant="destructive">
        <p>x</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog').classList.contains('ln-dialog--destructive')).toBe(true);
  });

  describe('closing', () => {
    it('calls onClose when Escape is pressed', () => {
      const onClose = vi.fn();
      render(<BasicDialog onClose={onClose} />);
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the scrim overlay is clicked', () => {
      const onClose = vi.fn();
      const { container } = render(<BasicDialog onClose={onClose} />);
      const overlay = container.querySelector('.ln-dialog-overlay')!;
      fireEvent.click(overlay, { target: overlay });
      // Simulate direct click on overlay (not bubbling from panel)
      // jsdom doesn't naturally set target for fireEvent; use dispatchEvent for precise test
      const evt = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(evt, 'target', { value: overlay, configurable: true });
      Object.defineProperty(evt, 'currentTarget', { value: overlay, configurable: true });
      overlay.dispatchEvent(evt);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('focus trap — Tab key', () => {
    it('wraps Tab from last focusable element to first', () => {
      render(<BasicDialog />);
      const dialog = screen.getByRole('dialog');
      const buttons = screen.getAllByRole('button');
      const last = buttons[buttons.length - 1]; // Confirm

      last.focus();
      fireEvent.keyDown(dialog, { key: 'Tab' });

      // Should wrap to first focusable (close button)
      expect(document.activeElement).toBe(buttons[0]);
    });

    it('wraps Shift+Tab from first focusable element to last', () => {
      render(<BasicDialog />);
      const dialog = screen.getByRole('dialog');
      const buttons = screen.getAllByRole('button');
      const first = buttons[0]; // close button
      const last = buttons[buttons.length - 1]; // Confirm

      first.focus();
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

      expect(document.activeElement).toBe(last);
    });

    it('does not move focus for non-Tab/Escape keys', () => {
      render(<BasicDialog />);
      const dialog = screen.getByRole('dialog');
      const buttons = screen.getAllByRole('button');
      buttons[0].focus();
      fireEvent.keyDown(dialog, { key: 'Enter' });
      expect(document.activeElement).toBe(buttons[0]);
    });
  });

  describe('DialogHeader', () => {
    it('renders the close button when onClose is provided', () => {
      render(<BasicDialog />);
      expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDefined();
    });

    it('does not render close button when onClose is absent', () => {
      render(
        <Dialog open onClose={vi.fn()}>
          <DialogHeader>
            <h2>No close</h2>
          </DialogHeader>
        </Dialog>,
      );
      expect(screen.queryByRole('button', { name: 'Close dialog' })).toBeNull();
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<BasicDialog onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('DialogBody', () => {
    it('accepts an id prop for aria-describedby wiring', () => {
      render(
        <Dialog open onClose={vi.fn()}>
          <DialogBody id="test-body">content</DialogBody>
        </Dialog>,
      );
      const body = document.getElementById('test-body');
      expect(body).not.toBeNull();
      expect(body?.classList.contains('ln-dialog-body')).toBe(true);
    });

    it('accepts a className prop', () => {
      render(
        <Dialog open onClose={vi.fn()}>
          <DialogBody className="custom-body">content</DialogBody>
        </Dialog>,
      );
      const body = document.querySelector('.ln-dialog-body.custom-body');
      expect(body).not.toBeNull();
    });
  });

  describe('DialogFooter', () => {
    it('renders children inside a footer element', () => {
      render(
        <Dialog open onClose={vi.fn()}>
          <DialogFooter>
            <button>OK</button>
          </DialogFooter>
        </Dialog>,
      );
      expect(screen.getByRole('button', { name: 'OK' })).toBeDefined();
    });

    it('accepts a className prop', () => {
      render(
        <Dialog open onClose={vi.fn()}>
          <DialogFooter className="custom-footer">x</DialogFooter>
        </Dialog>,
      );
      expect(document.querySelector('.ln-dialog-footer.custom-footer')).not.toBeNull();
    });
  });
});

// ─── Liquid Neon a11y — CSS regression ───────────────────────────────────────

describe('Dialog — Liquid Neon a11y CSS', () => {
  it('close button focus ring uses --focus-ring token', () => {
    const m = DIALOG_CSS.match(/\.ln-dialog-close:focus-visible\s*\{([^}]*)\}/);
    expect(m?.[1] ?? '').toContain('var(--focus-ring)');
  });

  it('reduced-motion block removes dialog entrance animation', () => {
    expect(DIALOG_CSS).toContain('@media (prefers-reduced-motion');
    const m = DIALOG_CSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\{([\s\S]*?)\}\s*\}/,
    );
    expect(m?.[1] ?? '').toContain('animation: none');
  });

  it('high-contrast block uses solid border and removes box-shadow', () => {
    expect(DIALOG_CSS).toContain('[data-contrast="high"]');
    const m = DIALOG_CSS.match(/\[data-contrast="high"\]\s*\.ln-dialog\s*\{([^}]*)\}/);
    const block = m?.[1] ?? '';
    expect(block).toContain('border');
    expect(block).toContain('box-shadow: none');
  });

  it('high-contrast overlay disables backdrop-filter', () => {
    const m = DIALOG_CSS.match(
      /\[data-contrast="high"\]\s*\.ln-dialog-overlay\s*\{([^}]*)\}/,
    );
    expect(m?.[1] ?? '').toContain('backdrop-filter: none');
  });

  it('dialog autofocuses the first focusable element on open', () => {
    render(
      <Dialog open onClose={vi.fn()}>
        <DialogHeader onClose={vi.fn()}>
          <h2>Title</h2>
        </DialogHeader>
        <DialogFooter>
          <button>OK</button>
        </DialogFooter>
      </Dialog>,
    );
    const closeBtn = document.querySelector<HTMLButtonElement>('.ln-dialog-close');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn).toHaveFocus();
  });

  it('dialog has aria-modal="true" and role="dialog"', () => {
    render(<Dialog open onClose={vi.fn()}><p>x</p></Dialog>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});
