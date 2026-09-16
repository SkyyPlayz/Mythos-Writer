// SKY-11154 — the shared "..." overflow menu (Hide / Delete), identical at
// every level (Mythos vault cards, Notes vault cards, Story vault cards).
// Parent spec SKY-11141 §4a: "the bare × and the trashcan are gone" — every
// delete affordance on the Vault & Files page must live inside this menu,
// never a standalone icon button.
import { useCallback, useRef, useState } from 'react';
import { Menu, type MenuItemDef } from '../../ui/Menu';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from '../../ui/Dialog';
import { Button } from '../../ui/Button';

export type VaultOverflowLevel = 'mythos' | 'notes' | 'story';

// Mirrors electron-main/src/vaultSurface.ts VAULT_SURFACE_COPY verbatim —
// keep in sync. Duplicated rather than imported because electron-main code
// cannot be bundled into the renderer.
const COPY = {
  innerVaultTrashTitle: 'Move to Recycle Bin?',
  innerVaultTrashBody: (vaultName: string) =>
    `"${vaultName}" will be moved to the Recycle Bin. You can restore it from there if you change your mind.`,
  innerVaultTrashConfirm: 'Move to Recycle Bin',

  mythosTrashTitle1: 'Move Mythos Vault to Recycle Bin?',
  mythosTrashBody1: (vaultName: string, innerCount: number) =>
    `"${vaultName}" contains ${innerCount} inner vault${innerCount !== 1 ? 's' : ''} ` +
    `(story + notes). Everything inside will be moved to the Recycle Bin together.`,
  mythosTrashConfirm1: 'Continue',

  mythosTrashTitle2: 'This cannot be undone from within Mythos Writer.',
  mythosTrashBody2: (vaultName: string, innerCount: number) =>
    `"${vaultName}" and its ${innerCount} inner vault${innerCount !== 1 ? 's' : ''} will be moved to the Recycle Bin. ` +
    `You can restore them from the Recycle Bin if you change your mind.`,
  mythosTrashConfirm2: 'Move to Recycle Bin',

  hideTitle: 'Hide vault?',
  hideBody: (vaultName: string) =>
    `"${vaultName}" will be hidden from this list. The folder stays exactly where it is — ` +
    `it won't be moved or deleted, and syncing continues if active.`,
  hideBodyPairedNotes: (vaultName: string, linkedStoryVaultName: string) =>
    `"${vaultName}" is linked to "${linkedStoryVaultName}". ` +
    `Hiding it won't break the link — the story vault will show a "target hidden" indicator, ` +
    `syncing continues, and the folder stays exactly where it is.`,
  hideConfirm: 'Hide',

  trashFailedTitle: 'Could not move to Recycle Bin',
  trashFailedBody: (vaultName: string, reason: string) =>
    `"${vaultName}" could not be moved to the Recycle Bin: ${reason}\n\n` +
    `The folder has not been modified.`,
} as const;

export interface VaultOverflowMenuProps {
  level: VaultOverflowLevel;
  /** Absolute path to hide/trash — the Mythos root for level='mythos'. */
  vaultPath: string;
  vaultName: string;
  /** Pre-known linked story vault name for a 'notes'-level hide, if any —
   *  used for the hideBodyPairedNotes copy variant. Optional: the vaultSurfaceHide
   *  response also returns this as a convenience, used when this prop is absent. */
  pairedStoryVaultName?: string;
  onHidden?: () => void;
  onDeleted?: () => void;
  /** Distinguishing suffix for data-testid — callers pass something unique per card. */
  testIdSuffix: string;
}

type DeleteStep = 'idle' | 'inner-confirm' | 'mythos-confirm-1' | 'mythos-confirm-2' | 'failed';

export default function VaultOverflowMenu({
  level,
  vaultPath,
  vaultName,
  pairedStoryVaultName,
  onHidden,
  onDeleted,
  testIdSuffix,
}: VaultOverflowMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const [hideBusy, setHideBusy] = useState(false);
  const [hideLinkedName, setHideLinkedName] = useState<string | undefined>(pairedStoryVaultName);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [innerCount, setInnerCount] = useState(0);
  const [failedError, setFailedError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const items: MenuItemDef[] = [
    { id: 'hide', label: 'Hide' },
    { id: 'delete', label: 'Delete', destructive: true },
  ];

  const handleMenuAction = useCallback((id: string) => {
    setMenuOpen(false);
    if (id === 'hide') {
      // The caller (Mythos/Notes/Story card) already knows any story-vault
      // pairing from its own loaded lists — passed in as a prop — so the
      // dialog copy is correct on first paint with no extra round trip.
      setHideLinkedName(pairedStoryVaultName);
      setHideOpen(true);
    } else if (id === 'delete') {
      setFailedError('');
      if (level === 'mythos') {
        setDeleteBusy(true);
        window.api?.vaultSurfaceBlastRadius?.(vaultPath)
          .then((res) => {
            setInnerCount(res?.innerCount ?? 0);
            setDeleteStep('mythos-confirm-1');
          })
          .catch(() => setDeleteStep('mythos-confirm-1'))
          .finally(() => setDeleteBusy(false));
      } else {
        setDeleteStep('inner-confirm');
      }
    }
  }, [level, pairedStoryVaultName, vaultPath]);

  const confirmHide = useCallback(async () => {
    setHideBusy(true);
    try {
      const res = await window.api?.vaultSurfaceHide?.({ vaultRoot: vaultPath, level });
      if (res?.hidden) {
        setHideOpen(false);
        onHidden?.();
      }
    } finally {
      setHideBusy(false);
    }
  }, [level, vaultPath, onHidden]);

  const runTrash = useCallback(async () => {
    setDeleteBusy(true);
    try {
      const res = await window.api?.vaultSurfaceTrash?.({ vaultPath, level });
      if (res?.trashed) {
        setDeleteStep('idle');
        onDeleted?.();
      } else {
        setFailedError(res?.error ?? 'Unknown error');
        setDeleteStep('failed');
      }
    } catch (e) {
      setFailedError(e instanceof Error ? e.message : 'Unknown error');
      setDeleteStep('failed');
    } finally {
      setDeleteBusy(false);
    }
  }, [vaultPath, level, onDeleted]);

  const cancelDelete = useCallback(() => setDeleteStep('idle'), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="vault-overflow-btn"
        aria-label={`More options for ${vaultName}`}
        aria-haspopup="menu"
        data-testid={`vault-overflow-btn-${testIdSuffix}`}
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        style={{
          background: 'none', border: 'none', color: '#8e9db8', fontSize: 16,
          cursor: 'pointer', padding: '2px 6px', borderRadius: 6, lineHeight: 1,
        }}
      >
        &#8943;
      </button>

      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onAction={handleMenuAction}
        items={items}
        anchorEl={triggerRef.current}
        aria-label={`Options for ${vaultName}`}
        data-testid={`vault-overflow-menu-${testIdSuffix}`}
      />

      {hideOpen && (
        <Dialog
          open
          onClose={() => setHideOpen(false)}
          aria-labelledby={`voh-title-${testIdSuffix}`}
          testId={`vault-hide-dialog-${testIdSuffix}`}
        >
          <DialogHeader onClose={() => setHideOpen(false)}>
            <span id={`voh-title-${testIdSuffix}`}>{COPY.hideTitle}</span>
          </DialogHeader>
          <DialogBody>
            <p>{hideLinkedName ? COPY.hideBodyPairedNotes(vaultName, hideLinkedName) : COPY.hideBody(vaultName)}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setHideOpen(false)} disabled={hideBusy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirmHide()}
              disabled={hideBusy}
              data-testid={`vault-hide-confirm-${testIdSuffix}`}
            >
              {hideBusy ? 'Hiding…' : COPY.hideConfirm}
            </Button>
          </DialogFooter>
        </Dialog>
      )}

      {deleteStep === 'inner-confirm' && (
        <Dialog
          open
          onClose={cancelDelete}
          aria-labelledby={`vod-title-${testIdSuffix}`}
          testId={`vault-delete-dialog-${testIdSuffix}`}
        >
          <DialogHeader onClose={cancelDelete}>
            <span id={`vod-title-${testIdSuffix}`}>{COPY.innerVaultTrashTitle}</span>
          </DialogHeader>
          <DialogBody>
            <p>{COPY.innerVaultTrashBody(vaultName)}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={cancelDelete} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void runTrash()}
              disabled={deleteBusy}
              data-testid={`vault-delete-confirm-${testIdSuffix}`}
            >
              {deleteBusy ? 'Moving…' : COPY.innerVaultTrashConfirm}
            </Button>
          </DialogFooter>
        </Dialog>
      )}

      {deleteStep === 'mythos-confirm-1' && (
        <Dialog
          open
          onClose={cancelDelete}
          aria-labelledby={`vod1-title-${testIdSuffix}`}
          testId={`vault-delete-dialog-1-${testIdSuffix}`}
        >
          <DialogHeader onClose={cancelDelete}>
            <span id={`vod1-title-${testIdSuffix}`}>{COPY.mythosTrashTitle1}</span>
          </DialogHeader>
          <DialogBody>
            <p>{COPY.mythosTrashBody1(vaultName, innerCount)}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={cancelDelete}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => setDeleteStep('mythos-confirm-2')}
              data-testid={`vault-delete-confirm-1-${testIdSuffix}`}
            >
              {COPY.mythosTrashConfirm1}
            </Button>
          </DialogFooter>
        </Dialog>
      )}

      {deleteStep === 'mythos-confirm-2' && (
        <Dialog
          open
          onClose={cancelDelete}
          aria-labelledby={`vod2-title-${testIdSuffix}`}
          testId={`vault-delete-dialog-2-${testIdSuffix}`}
        >
          <DialogHeader onClose={cancelDelete}>
            <span id={`vod2-title-${testIdSuffix}`}>{COPY.mythosTrashTitle2}</span>
          </DialogHeader>
          <DialogBody>
            <p>{COPY.mythosTrashBody2(vaultName, innerCount)}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={cancelDelete} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void runTrash()}
              disabled={deleteBusy}
              data-testid={`vault-delete-confirm-2-${testIdSuffix}`}
            >
              {deleteBusy ? 'Moving…' : COPY.mythosTrashConfirm2}
            </Button>
          </DialogFooter>
        </Dialog>
      )}

      {deleteStep === 'failed' && (
        <Dialog
          open
          onClose={cancelDelete}
          aria-labelledby={`vodf-title-${testIdSuffix}`}
          testId={`vault-delete-failed-${testIdSuffix}`}
        >
          <DialogHeader onClose={cancelDelete}>
            <span id={`vodf-title-${testIdSuffix}`}>{COPY.trashFailedTitle}</span>
          </DialogHeader>
          <DialogBody>
            <p style={{ whiteSpace: 'pre-line' }}>{COPY.trashFailedBody(vaultName, failedError)}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="primary" onClick={cancelDelete}>
              OK
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}
