// SKY-11154 (parent spec SKY-11141 §4/§4a) — Notes / Story columns for the
// CURRENTLY ACTIVE Mythos vault, with dot-linking pairing. Replaces
// AddVaultButtonsSection.tsx's role (that file rendered only the two bare
// "+ Add" buttons, no list — "that surface is SKY-11154's job"). Kept as its
// own component (rather than folded into MythosVaultsSection) so the
// Mythos-vault-level cards and the inner Notes/Story columns stay a clean
// diff, matching this codebase's one-component-per-settings-sub-block
// convention.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import AddVaultDialog, { type AddVaultKind } from './AddVaultDialog';
import VaultOverflowMenu from './VaultOverflowMenu';
import { useNotesVaultLinkGate } from '../../../hooks/useNotesVaultLinkGate';

interface NotesVaultEntry {
  id: string;
  displayName: string;
  dirName: string;
  createdAt: string;
  origin: 'created' | 'imported';
}

interface StoryVaultEntry {
  id: string;
  displayName: string;
  dirName: string;
  createdAt: string;
  pairedNotesVaultId: string | null;
}

type DotSelection = { side: 'notes' | 'story'; id: string } | null;

const columnSt = { display: 'flex', flexDirection: 'column' as const, gap: 8, flex: 1, minWidth: 0 };

const cardSt = (current: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 12,
  background: 'rgba(255,255,255,.03)',
  border: current ? 'var(--bw,1px) solid var(--b1,rgba(0,240,255,.45))' : '1px solid rgba(255,255,255,.08)',
  cursor: current ? 'default' : 'pointer',
});

const dotSt = (paired: boolean, selected: boolean): CSSProperties => ({
  width: 14, height: 14, borderRadius: '50%', flex: 'none', cursor: 'pointer',
  border: selected ? '2px solid #00f0ff' : '1px solid rgba(255,255,255,.35)',
  background: paired ? '#00f0ff' : 'transparent',
  boxShadow: selected ? '0 0 8px rgba(0,240,255,.6)' : 'none',
});

/** Mirrors electron-main's vaultAbsPath(mythosRoot, entry) = path.join(mythosRoot, entry.dirName)
 *  exactly — vaults live FLAT directly under the Mythos root (no "Notes"/"Stories" subfolder). */
function absPathFor(mythosRoot: string, pathSep: string, dirName: string): string {
  return `${mythosRoot.replace(/[\\/]+$/, '')}${pathSep}${dirName}`;
}

export default function VaultLinkingColumns() {
  const [notesVaults, setNotesVaults] = useState<NotesVaultEntry[] | null>(null);
  const [storyVaults, setStoryVaults] = useState<StoryVaultEntry[] | null>(null);
  const [activeNotesId, setActiveNotesId] = useState<string | null>(null);
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);
  const [mythosRoot, setMythosRoot] = useState<string | null>(null);
  const [pathSep, setPathSep] = useState<'/' | '\\'>('/');
  const [hiddenPaths, setHiddenPaths] = useState<string[]>([]);
  const [selectedDot, setSelectedDot] = useState<DotSelection>(null);
  const [addDialogKind, setAddDialogKind] = useState<AddVaultKind | null>(null);
  const [showHiddenNotes, setShowHiddenNotes] = useState(false);
  const [showHiddenStory, setShowHiddenStory] = useState(false);

  const { pending, busy: switching, requestGatedSwitch, confirm: confirmSwitch, cancel: cancelSwitch } = useNotesVaultLinkGate();

  const loadLists = useCallback(() => {
    window.api?.notesVaultRegistryList?.()
      .then((res) => {
        if (!res) return;
        setNotesVaults(res.vaults);
        setActiveNotesId(res.activeId);
      })
      .catch(() => { /* non-fatal — column renders empty */ });
    window.api?.storyVaultRegistryList?.()
      .then((res) => {
        if (!res) return;
        setStoryVaults(res.vaults);
        setActiveStoryId(res.activeId);
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  const refreshHidden = useCallback(() => {
    window.api?.vaultSurfaceListHidden?.()
      .then((res) => { if (res?.hiddenVaultRoots) setHiddenPaths(res.hiddenVaultRoots); })
      .catch(() => { /* non-fatal */ });
  }, []);

  useEffect(() => {
    window.api?.vaultGetPaths?.()
      .then((paths) => {
        setMythosRoot(paths.mythosRoot ?? null);
        if (paths.pathSeparator) setPathSep(paths.pathSeparator);
      })
      .catch(() => { /* non-fatal */ });
    loadLists();
    refreshHidden();
    // SKY-11154: newly-added vaults (via AddVaultDialog) push these events —
    // subscribe so the columns refresh without a manual Settings remount.
    const unsubNotes = window.api?.onNotesVaultRegistryChanged?.(loadLists);
    const unsubStory = window.api?.onStoryVaultRegistryChanged?.(loadLists);
    return () => { unsubNotes?.(); unsubStory?.(); };
  }, [loadLists, refreshHidden]);

  const notesAbsPath = useCallback((entry: NotesVaultEntry): string => (
    mythosRoot ? absPathFor(mythosRoot, pathSep, entry.dirName) : ''
  ), [mythosRoot, pathSep]);

  const storyAbsPath = useCallback((entry: StoryVaultEntry): string => (
    mythosRoot ? absPathFor(mythosRoot, pathSep, entry.dirName) : ''
  ), [mythosRoot, pathSep]);

  const linkedStoryNamesFor = useCallback((notesId: string): string[] => (
    (storyVaults ?? []).filter((s) => s.pairedNotesVaultId === notesId).map((s) => s.displayName)
  ), [storyVaults]);

  const performPair = useCallback(async (storyId: string, notesId: string | null) => {
    const isActiveStory = storyId === activeStoryId;
    if (notesId !== null && isActiveStory && notesId !== activeNotesId) {
      // Pairing FROM the active story vault to a DIFFERENT notes vault also
      // switches the active notes vault — gate the whole thing (pair +
      // switch) behind the broken-wikilink report, atomically (SKY-11141:
      // "Any change to the active notes vault... must run the report").
      const target = notesVaults?.find((n) => n.id === notesId);
      await requestGatedSwitch(notesId, target?.displayName ?? 'Notes', async (id) => {
        await window.api?.storyVaultRegistryPair?.(storyId, id);
        await window.api?.notesVaultRegistrySetActive?.(id);
      });
      return;
    }
    await window.api?.storyVaultRegistryPair?.(storyId, notesId);
  }, [activeStoryId, activeNotesId, notesVaults, requestGatedSwitch]);

  const onDotClick = useCallback((side: 'notes' | 'story', id: string) => {
    if (!selectedDot) {
      if (side === 'story') {
        const sv = storyVaults?.find((s) => s.id === id);
        if (sv?.pairedNotesVaultId) {
          // A lone click on an already-paired story dot unpairs it.
          void performPair(id, null);
          return;
        }
      }
      setSelectedDot({ side, id });
      return;
    }
    if (selectedDot.side === side) {
      setSelectedDot(selectedDot.id === id ? null : { side, id });
      return;
    }
    const storyId = side === 'story' ? id : selectedDot.id;
    const notesId = side === 'notes' ? id : selectedDot.id;
    setSelectedDot(null);
    void performPair(storyId, notesId);
  }, [selectedDot, storyVaults, performPair]);

  const onNotesCardClick = useCallback(async (entry: NotesVaultEntry) => {
    if (entry.id === activeNotesId) return;
    await requestGatedSwitch(entry.id, entry.displayName, async (id) => {
      await window.api?.notesVaultRegistrySetActive?.(id);
    });
  }, [activeNotesId, requestGatedSwitch]);

  const onStoryCardClick = useCallback(async (entry: StoryVaultEntry) => {
    if (entry.id === activeStoryId) return;
    await window.api?.storyVaultRegistrySetActive?.(entry.id).catch(() => { /* non-fatal */ });
  }, [activeStoryId]);

  const onRevealHiddenTarget = useCallback((path: string) => {
    window.api?.vaultSurfaceUnhide?.(path).then(refreshHidden).catch(() => { /* non-fatal */ });
  }, [refreshHidden]);

  // notesVaultRegistryList returns vaults: null for a legacy (pre-v2) vault
  // with no Mythos bundle — hide this UI entirely, matching the existing
  // NotesVaultPicker.tsx convention for the same signal.
  if (notesVaults === null) return null;

  const visibleNotes = notesVaults.filter((n) => !hiddenPaths.includes(notesAbsPath(n)));
  const hiddenNotes = notesVaults.filter((n) => hiddenPaths.includes(notesAbsPath(n)));
  const visibleStory = (storyVaults ?? []).filter((s) => !hiddenPaths.includes(storyAbsPath(s)));
  const hiddenStory = (storyVaults ?? []).filter((s) => hiddenPaths.includes(storyAbsPath(s)));

  return (
    <section className="settings-section" aria-labelledby="section-add-vault" data-settings-cat="vaults">
      <h3 className="settings-section-title" id="section-add-vault">Notes &amp; Story vaults</h3>
      <p className="settings-hint">
        Every Notes/Story vault inside the current Mythos vault. Click a dot on one side then the
        other to pair a story vault to a notes vault — a story vault pairs to at most one notes
        vault at a time.
      </p>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={columnSt}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="settings-label">Notes vaults</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="m24-btn"
                data-testid="notes-show-hidden-btn"
                aria-expanded={showHiddenNotes}
                onClick={() => setShowHiddenNotes((s) => !s)}
              >
                Show hidden{hiddenNotes.length > 0 ? ` (${hiddenNotes.length})` : ''}
              </button>
              <button
                type="button"
                className="m24-btn m24-btn--primary"
                data-testid="add-notes-vault-btn"
                onClick={() => setAddDialogKind('notes')}
              >
                + Add Notes Vault
              </button>
            </div>
          </div>

          {visibleNotes.map((n) => {
            const current = n.id === activeNotesId;
            const linked = linkedStoryNamesFor(n.id);
            return (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                data-testid={`notes-vault-card-${n.id}`}
                style={cardSt(current)}
                onClick={() => { void onNotesCardClick(n); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void onNotesCardClick(n); } }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e6ecf9' }}>{n.displayName}</div>
                  <div style={{ fontSize: 10, color: '#7686a2', marginTop: 2 }}>
                    {linked.length > 0 ? `Linked to: ${linked.join(', ')}` : 'Not linked'}
                  </div>
                </div>
                {current && (
                  <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--n1,#00f0ff)', flex: 'none' }}>Current</span>
                )}
                <div onClick={(e) => e.stopPropagation()}>
                  <VaultOverflowMenu
                    level="notes"
                    vaultPath={notesAbsPath(n)}
                    vaultName={n.displayName}
                    pairedStoryVaultName={linked[0]}
                    testIdSuffix={n.id}
                    onHidden={refreshHidden}
                    onDeleted={loadLists}
                  />
                </div>
                <button
                  type="button"
                  className="vault-pair-dot"
                  aria-label={`Pair with notes vault ${n.displayName}`}
                  data-testid={`pair-dot-notes-${n.id}`}
                  style={dotSt(linked.length > 0, selectedDot?.side === 'notes' && selectedDot.id === n.id)}
                  onClick={(e) => { e.stopPropagation(); onDotClick('notes', n.id); }}
                />
              </div>
            );
          })}
          {visibleNotes.length === 0 && (
            <p className="settings-hint" data-testid="notes-vaults-empty">No notes vaults yet.</p>
          )}

          {showHiddenNotes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="notes-hidden-list">
              {hiddenNotes.map((n) => (
                <div key={`hidden-${n.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px', borderRadius: 10, background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.1)' }}>
                  <span style={{ flex: 1, fontSize: 11, color: '#8e9db8' }}>{n.displayName}</span>
                  <button type="button" className="m24-btn" data-testid={`notes-unhide-${n.id}`} onClick={() => onRevealHiddenTarget(notesAbsPath(n))}>
                    Unhide
                  </button>
                </div>
              ))}
              {hiddenNotes.length === 0 && <p className="settings-hint">No hidden notes vaults.</p>}
            </div>
          )}
        </div>

        <div style={columnSt}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="settings-label">Story vaults</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="m24-btn"
                data-testid="story-show-hidden-btn"
                aria-expanded={showHiddenStory}
                onClick={() => setShowHiddenStory((s) => !s)}
              >
                Show hidden{hiddenStory.length > 0 ? ` (${hiddenStory.length})` : ''}
              </button>
              <button
                type="button"
                className="m24-btn m24-btn--primary"
                data-testid="add-story-vault-btn"
                onClick={() => setAddDialogKind('story')}
              >
                + Add Story Vault
              </button>
            </div>
          </div>

          {visibleStory.map((s) => {
            const current = s.id === activeStoryId;
            const pairedNotes = notesVaults.find((n) => n.id === s.pairedNotesVaultId);
            const pairedNotesHidden = pairedNotes != null && hiddenPaths.includes(notesAbsPath(pairedNotes));
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                data-testid={`story-vault-card-${s.id}`}
                style={cardSt(current)}
                onClick={() => { void onStoryCardClick(s); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void onStoryCardClick(s); } }}
              >
                <button
                  type="button"
                  className="vault-pair-dot"
                  aria-label={`Pair with story vault ${s.displayName}`}
                  data-testid={`pair-dot-story-${s.id}`}
                  style={dotSt(s.pairedNotesVaultId != null, selectedDot?.side === 'story' && selectedDot.id === s.id)}
                  onClick={(e) => { e.stopPropagation(); onDotClick('story', s.id); }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e6ecf9' }}>{s.displayName}</div>
                  <div style={{ fontSize: 10, color: '#7686a2', marginTop: 2 }}>
                    {pairedNotes ? `Linked to: ${pairedNotes.displayName}` : 'Not linked'}
                    {pairedNotesHidden && (
                      <button
                        type="button"
                        data-testid={`story-target-hidden-${s.id}`}
                        onClick={(e) => { e.stopPropagation(); if (pairedNotes) onRevealHiddenTarget(notesAbsPath(pairedNotes)); }}
                        style={{ marginLeft: 6, fontSize: 9.5, color: '#ffb020', background: 'none', border: '1px solid rgba(255,176,32,.4)', borderRadius: 6, padding: '1px 5px', cursor: 'pointer' }}
                      >
                        target hidden — reveal
                      </button>
                    )}
                  </div>
                </div>
                {current && (
                  <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--n1,#00f0ff)', flex: 'none' }}>Current</span>
                )}
                <div onClick={(e) => e.stopPropagation()}>
                  <VaultOverflowMenu
                    level="story"
                    vaultPath={storyAbsPath(s)}
                    vaultName={s.displayName}
                    testIdSuffix={s.id}
                    onHidden={refreshHidden}
                    onDeleted={loadLists}
                  />
                </div>
              </div>
            );
          })}
          {visibleStory.length === 0 && (
            <p className="settings-hint" data-testid="story-vaults-empty">No story vaults yet.</p>
          )}

          {showHiddenStory && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="story-hidden-list">
              {hiddenStory.map((s) => (
                <div key={`hidden-${s.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px', borderRadius: 10, background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.1)' }}>
                  <span style={{ flex: 1, fontSize: 11, color: '#8e9db8' }}>{s.displayName}</span>
                  <button type="button" className="m24-btn" data-testid={`story-unhide-${s.id}`} onClick={() => onRevealHiddenTarget(storyAbsPath(s))}>
                    Unhide
                  </button>
                </div>
              ))}
              {hiddenStory.length === 0 && <p className="settings-hint">No hidden story vaults.</p>}
            </div>
          )}
        </div>
      </div>

      <AddVaultDialog kind="notes" open={addDialogKind === 'notes'} onClose={() => setAddDialogKind(null)} />
      <AddVaultDialog kind="story" open={addDialogKind === 'story'} onClose={() => setAddDialogKind(null)} />

      {pending && (
        <Dialog
          open
          onClose={cancelSwitch}
          aria-labelledby="vlc-dialog-title"
          aria-describedby="vlc-dialog-body"
          testId="vault-linking-switch-dialog"
        >
          <DialogHeader onClose={cancelSwitch}>
            <span id="vlc-dialog-title">Switch to &ldquo;{pending.targetDisplayName}&rdquo;?</span>
          </DialogHeader>
          <DialogBody id="vlc-dialog-body">
            <p>
              <strong>{pending.report.resolvedCount}</strong> of{' '}
              <strong>{pending.report.totalStems}</strong> linked notes resolve in this vault.
            </p>
            {pending.report.unresolvedStems.length > 0 && (
              <>
                <p>
                  These {pending.report.unresolvedStems.length} link
                  {pending.report.unresolvedStems.length === 1 ? '' : 's'} will show as unresolved:
                </p>
                <ul>
                  {pending.report.unresolvedStems.slice(0, 20).map((stem) => (
                    <li key={stem}><code>[[{stem}]]</code></li>
                  ))}
                  {pending.report.unresolvedStems.length > 20 && (
                    <li>…and {pending.report.unresolvedStems.length - 20} more</li>
                  )}
                </ul>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={cancelSwitch} disabled={switching}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirmSwitch()}
              disabled={switching}
              data-testid="vault-linking-switch-confirm"
            >
              {switching ? 'Switching…' : 'Switch vault'}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </section>
  );
}
