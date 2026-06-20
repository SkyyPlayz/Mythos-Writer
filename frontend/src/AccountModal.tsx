import { useId } from 'react';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from './components/ui/Dialog';
import './AccountModal.css';

export interface AccountModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AccountModal({ open, onClose }: AccountModalProps) {
  const titleId = useId();

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId}>
      <DialogHeader onClose={onClose}>
        <h2 id={titleId} className="am-title">Mythos Account</h2>
      </DialogHeader>

      <DialogBody className="am-body">
        <div className="am-brand-glyph" aria-hidden="true">M</div>
        <p className="am-tagline">Account features coming soon in a future release.</p>
      </DialogBody>

      <DialogFooter className="am-footer">
        <button type="button" className="am-dismiss" onClick={onClose} autoFocus>
          Close
        </button>
      </DialogFooter>
    </Dialog>
  );
}
