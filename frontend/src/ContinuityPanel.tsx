import { useState, useEffect, useCallback, useRef } from 'react';
import { ScrollText, CircleCheck } from 'lucide-react';
import { useAgentActivity } from './agents/agentActivity';
import { useAiEnabled } from './hooks/useAiEnabled';
import type { Scene } from './types';
import { InconsistencyCard } from './InconsistencyCard';
import type { InconsistencyItem, ResolutionAction } from './InconsistencyCard';
import { PanelHeader } from './components/ui/PanelChrome';
import { DropdownSelect } from './components/ui/DropdownSelect';
import './ContinuityPanel.css';

export type { InconsistencyItem };

// M12.3 (SKY-10770): scan-scope selection. The picker chooses how much of the
// manuscript the extraction pass covers; contradiction detection stays a
// global DB query regardless (SKY-10666 binding).
export type ScanScopeLevel = 'scene' | 'chapter' | 'part' | 'book';

const SCOPE_OPTIONS: Array<{ value: ScanScopeLevel; label: string }> = [
  { value: 'scene', label: 'Scene' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'part', label: 'Part' },
  { value: 'book', label: 'Book' },
];

/** The legacy LLM continuity scan speaks active_scene/active_chapter/
 *  full_manuscript — map the four-level picker onto it. */
const LEGACY_SCAN_SCOPE: Record<ScanScopeLevel, 'active_scene' | 'active_chapter' | 'full_manuscript'> = {
  scene: 'active_scene',
  chapter: 'active_chapter',
  part: 'full_manuscript',
  book: 'full_manuscript',
};

function initialScope(legacy?: 'active_scene' | 'active_chapter' | 'full_manuscript'): ScanScopeLevel {
  if (legacy === 'active_chapter') return 'chapter';
  if (legacy === 'full_manuscript') return 'book';
  return 'scene';
}

interface GlobalContradictionItem {
  id: string;
  category: string;
  severity: string;
  sceneId: string;
  excerpt: string;
  vaultNotePath: string;
  rationale: string;
}

interface BgScanProgress {
  completedUnits: number;
  skippedUnits: number;
  totalUnits: number | null;
}

type PanelState =
  | 'loading'
  | 'scanning'
  | 'empty'
  | 'not_scanned'
  | 'partial'
  | 'error_llm'
  | 'error_vault'
  | 'open_issues';

type GroupKey = 'critical' | 'high' | 'medium' | 'low' | 'ignored';

const GROUP_LABELS: Record<GroupKey, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  ignored: 'Ignored',
};

function groupItems(items: InconsistencyItem[]): Record<GroupKey, InconsistencyItem[]> {
  const groups: Record<GroupKey, InconsistencyItem[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    ignored: [],
  };
  for (const item of items) {
    if (item.status === 'ignored') {
      groups.ignored.push(item);
    } else if (item.status !== 'open') {
      continue;
    } else if (item.severity === 'critical') {
      groups.critical.push(item);
    } else if (item.severity === 'high') {
      groups.high.push(item);
    } else if (item.severity === 'medium') {
      groups.medium.push(item);
    } else {
      groups.low.push(item);
    }
  }
  return groups;
}

function classifyError(errorMsg: string): PanelState {
  const lower = errorMsg.toLowerCase();
  if (lower.includes('vault') || lower.includes('file') || lower.includes('read')) return 'error_vault';
  return 'error_llm';
}

export interface ContinuityPanelProps {
  scene: Scene | null;
  enabled?: boolean;
  /**
   * SKY-9022/M6 (GAP-6): WHICH flag turned continuity off — `enabled` is a
   * conjunction of the Archive Agent toggle and the "Enable continuity
   * checking" feature toggle, and the disabled message must name the right
   * one. 'agent' (default) = Archive Agent is off; 'feature' = the agent is
   * on but continuity checking is off.
   */
  disabledReason?: 'agent' | 'feature';
  archiveStoryEditConsentGiven?: boolean;
  archiveScanScope?: 'active_scene' | 'active_chapter' | 'full_manuscript';
  onConsentGranted?: () => void;
  onCountChange?: (count: number) => void;
  onOpenSettings?: () => void;
  /**
   * SKY-6978 (Beta4/M18): the Notes editor's right-panel "CONTINUITY FLAGS"
   * header — replaces the default "Continuity" title with the FULL-SPEC §6 /
   * prototype (3152) label + ARCHIVE AGENT badge. Story-side usages
   * (archive-continuity tab, BrainstormPage's hidden facts-column instance)
   * keep the default header.
   */
  flagsHeader?: boolean;
}

export default function ContinuityPanel({
  scene,
  enabled = true,
  disabledReason = 'agent',
  archiveStoryEditConsentGiven = false,
  archiveScanScope = 'active_scene',
  onConsentGranted,
  onCountChange,
  onOpenSettings,
  flagsHeader = false,
}: ContinuityPanelProps) {
  const [panelState, setPanelState] = useState<PanelState>('loading');
  const [items, setItems] = useState<InconsistencyItem[]>([]);
  // M11a/M11b: continuity flags are an AI surface — the whole panel hides
  // when the master AI toggle is off (nothing is deleted; flags return with
  // the toggle).
  const aiEnabled = useAiEnabled();
  // Beta 3 M22: archive scans light the workspace tab strip's agents chip.
  useAgentActivity(panelState === 'scanning');
  const [lastTokenUsed, setLastTokenUsed] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  // M12.3: scan scope picked at the trigger; default = scene (or the legacy
  // Settings-level scope when one is set).
  const [scanScope, setScanScope] = useState<ScanScopeLevel>(() => initialScope(archiveScanScope));
  // M12.3: live progress of the scoped background extraction pass.
  const [bgScan, setBgScan] = useState<BgScanProgress | null>(null);
  // M12.3: open contradictions across the whole manuscript — global query,
  // never narrowed by the scan scope.
  const [globalItems, setGlobalItems] = useState<GlobalContradictionItem[]>([]);
  const [globalCollapsed, setGlobalCollapsed] = useState(false);
  // M9d: visible failure line when a flag action couldn't do what it says.
  const [actionError, setActionError] = useState<string | null>(null);
  const [footerExpanded, setFooterExpanded] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupKey>>(new Set(['low', 'ignored']));
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const openCount = items.filter((i) => i.status === 'open').length;

  useEffect(() => {
    onCountChangeRef.current?.(openCount);
  }, [openCount]);

  // Load persisted open items on mount / scene change
  useEffect(() => {
    if (!enabled) {
      setPanelState('not_scanned');
      setItems([]);
      return;
    }

    let cancelled = false;
    setPanelState('loading');
    setActionError(null);

    (async () => {
      try {
        const result = await window.api.archiveListContinuity({ sceneId: scene?.id });
        if (cancelled) return;
        const loaded = (Array.isArray(result) ? result : result?.items ?? []) as InconsistencyItem[];
        const loadedOpenCount = loaded.filter((i) => i.status === 'open').length;
        setItems(loaded);
        setPanelState(loaded.length === 0 ? 'not_scanned' : loadedOpenCount === 0 ? 'empty' : 'open_issues');
      } catch {
        if (!cancelled) setPanelState('not_scanned');
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, scene?.id]);

  // M12.3: refresh the global contradiction list — a cheap whole-manuscript
  // DB query, deliberately independent of scene and scan scope.
  const refreshGlobalContradictions = useCallback(() => {
    window.api.archiveListGlobalContradictions?.()
      .then((result) => {
        const items = (result?.items ?? []).filter((i) => i.category === 'factual_contradiction');
        setGlobalItems(items);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refreshGlobalContradictions();
  }, [enabled, scene?.id, refreshGlobalContradictions]);

  // M12.3: track the scoped background extraction pass for the progress line.
  useEffect(() => {
    if (!enabled) return;
    const unsub = window.api.jobs?.onEvent((evt) => {
      if (evt.progress.type !== 'manuscript-scan') return;
      if (evt.kind === 'progress') {
        setBgScan({
          completedUnits: evt.progress.completedUnits,
          skippedUnits: evt.progress.skippedUnits,
          totalUnits: evt.progress.totalUnits,
        });
      } else {
        setBgScan(null);
        if (evt.kind === 'done') refreshGlobalContradictions();
      }
    });
    return () => { unsub?.(); };
  }, [enabled, refreshGlobalContradictions]);

  // IPC event subscriptions
  useEffect(() => {
    if (!enabled) return;

    const unsubStart = window.api.onArchiveContScanStart(() => {
      setPanelState('scanning');
      setStatusMsg('Scanning scene…');
    });

    const unsubResult = window.api.onArchiveContScanResult((data) => {
      const incoming = data.items as InconsistencyItem[];
      setLastTokenUsed(data.tokenUsed);
      setItems(incoming);

      if (data.partial) {
        setPanelState('partial');
        setStatusMsg('Scan stopped — token budget reached.');
      } else if (incoming.filter((i) => i.status === 'open').length === 0) {
        setPanelState('empty');
      } else {
        setPanelState('open_issues');
      }
      // M12.3: a finished scan may have written new flags anywhere in the
      // manuscript — refresh the global contradiction section too.
      refreshGlobalContradictions();
    });

    const unsubError = window.api.onArchiveContScanError((data) => {
      setPanelState(classifyError(data.error));
      setStatusMsg(data.error);
    });

    // Beta 3 M23: a flag resolved from its manuscript comment's agent actions
    // (archive:confirm continuity fallback) updates the panel live too.
    const unsubItemResolved = window.api.onArchiveContItemResolved?.((data) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === data.itemId
            ? { ...item, status: data.status, resolvedAction: data.action, resolvedAt: new Date().toISOString() }
            : item,
        ),
      );
    });

    return () => {
      unsubStart();
      unsubResult();
      unsubError();
      unsubItemResolved?.();
    };
  }, [enabled, refreshGlobalContradictions]);

  const handleResolve = useCallback(async (id: string, action: ResolutionAction, note?: string) => {
    let previousItem: InconsistencyItem | undefined;
    const resolvedAt = new Date().toISOString();
    setActionError(null);
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        previousItem = item;
        return {
          ...item,
          status: action === 'ignore' ? 'ignored' : 'resolved',
          resolvedAction: action,
          resolvedAt,
        };
      }),
    );

    const revert = () => {
      if (previousItem) {
        const restored = previousItem as InconsistencyItem;
        setItems((prev) => prev.map((item) => (item.id === id ? restored : item)));
      }
    };

    try {
      const result = await window.api.archiveResolveContinuity(id, action, note);
      if (result && result.ok === false) {
        // M9d: the action couldn't do what it says (note gone / flagged text
        // changed since the scan) — keep the flag open and say why.
        revert();
        const msg = result.reason === 'excerpt_not_found'
          ? 'Couldn’t update the note — the flagged text has changed since the scan. Scan again to refresh this flag.'
          : 'Couldn’t update the note — it no longer exists in your vault.';
        setActionError(msg);
        setStatusMsg(msg);
      }
    } catch {
      revert();
    }
  }, []);

  const handleConsentGranted = useCallback(() => {
    onConsentGranted?.();
    window.api.settingsGet().then((current) =>
      window.api.settingsSet({ ...current, archiveStoryEditConsentGiven: true }),
    ).catch(() => {});
  }, [onConsentGranted]);

  const handleScanNow = useCallback(() => {
    if (!scene) return;
    const prose = scene.blocks.map((b) => b.content).join('\n\n');
    // The LLM continuity scan honors the picked scope via its legacy vocabulary…
    void window.api.archiveScanContinuity(scene.id, prose, LEGACY_SCAN_SCOPE[scanScope]);
    // …and the M12.1 extraction queue gets the real scoped scene set —
    // identifiers only; main resolves them to paths from the manifest.
    void window.api.jobs?.enqueue('manuscript-scan', {
      scope: { level: scanScope, sceneId: scene.id },
    });
  }, [scene, scanScope]);

  const toggleGroup = useCallback((group: GroupKey) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const header = flagsHeader ? (
    <PanelHeader
      title={<span className="cp-flags-label">CONTINUITY FLAGS</span>}
      actions={<span className="cp-flags-badge">ARCHIVE AGENT</span>}
    />
  ) : (
    <PanelHeader
      icon={<ScrollText size={14} aria-hidden="true" />}
      title="Continuity"
    />
  );

  // M11b surface contract: master AI off → continuity flags are gone, not
  // disabled-with-a-message. The stored flags stay intact for when it returns.
  if (!aiEnabled) return null;

  if (!enabled) {
    return (
      <div className="cp-panel">
        {header}
        <p role="status" className="cp-status-msg" aria-live="polite">
          {disabledReason === 'feature'
            // Settings label: "Enable continuity checking" (ArchiveAgentSection).
            ? 'Continuity checking is turned off. Enable it in Settings.'
            : 'Archive Agent is disabled. Enable it in Settings.'}
        </p>
      </div>
    );
  }

  const groups = groupItems(items);
  const hasHigherSeverity = groups.critical.length > 0 || groups.high.length > 0 || groups.medium.length > 0;

  return (
    <div className="cp-panel">
      {header}
      {/* Always-in-DOM aria-live status region */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {statusMsg}
      </p>

      {/* M12.3: scope picker attached to the scan trigger. Default = scene;
          wider scopes cost more extraction but never change what the global
          contradiction section below can see. */}
      <div className="cp-scan-toolbar">
        <span className="cp-scan-scope-label" id="cp-scan-scope-label">Scope</span>
        {/* Scope can be picked ahead of opening a scene — only the trigger
            needs one. */}
        <DropdownSelect
          value={scanScope}
          options={SCOPE_OPTIONS}
          onChange={(v) => setScanScope(v as ScanScopeLevel)}
          aria-label="Scan scope"
          id="cp-scan-scope"
          disabled={panelState === 'scanning'}
        />
        {panelState !== 'not_scanned' && (
          <button
            type="button"
            className="cp-scan-now-btn cp-scan-now-btn--compact"
            onClick={handleScanNow}
            disabled={!scene || panelState === 'scanning'}
            aria-label="Scan for continuity issues"
          >
            Scan
          </button>
        )}
      </div>

      {bgScan !== null && (
        <p className="cp-bg-scan-line" role="status" data-testid="cp-bg-scan-progress">
          <span className="cp-spinner" aria-hidden="true" />
          Background scan {bgScan.completedUnits + bgScan.skippedUnits}
          {bgScan.totalUnits !== null ? `/${bgScan.totalUnits}` : ''}
        </p>
      )}

      {/* Panel body */}
      {panelState === 'loading' && (
        <div className="cp-centered" aria-label="Loading continuity issues">
          <span className="cp-spinner" aria-hidden="true" /> Loading…
        </div>
      )}

      {panelState === 'scanning' && (
        <div className="cp-scanning-banner">
          <span className="cp-spinner" aria-hidden="true" />
          <span>Scanning scene…</span>
        </div>
      )}

      {panelState === 'not_scanned' && (
        <div className="cp-centered cp-not-scanned">
          <span className="cp-empty-icon" aria-hidden="true"><ScrollText size={32} /></span>
          <p className="cp-empty-text">Save your scene to check for continuity issues.</p>
          <button
            type="button"
            className="cp-scan-now-btn"
            onClick={handleScanNow}
            disabled={!scene}
            aria-label="Scan now for continuity issues"
          >
            Scan now
          </button>
        </div>
      )}

      {panelState === 'empty' && (
        <div className="cp-centered cp-empty">
          <span className="cp-empty-icon" aria-hidden="true"><CircleCheck size={32} /></span>
          <p className="cp-empty-text">All consistent</p>
          {lastTokenUsed !== null && (
            <p className="cp-empty-sub">Last scan: ~{lastTokenUsed.toLocaleString()} tokens</p>
          )}
        </div>
      )}

      {panelState === 'partial' && (
        <div className="cp-banner cp-banner--warning" role="alert">
          Scan stopped — token budget reached.{' '}
          <button
            type="button"
            className="cp-banner-link"
            onClick={() => onOpenSettings?.()}
          >
            Adjust limit ↗
          </button>
        </div>
      )}

      {panelState === 'error_llm' && (
        <div className="cp-banner cp-banner--error" role="alert">
          Continuity scan unavailable — check your provider settings.
        </div>
      )}

      {panelState === 'error_vault' && (
        <div className="cp-banner cp-banner--error" role="alert">
          Could not read vault.
        </div>
      )}

      {actionError !== null && (
        <div className="cp-banner cp-banner--error" role="alert" data-testid="cp-action-error">
          {actionError}
        </div>
      )}

      {(panelState === 'open_issues' || panelState === 'partial' || panelState === 'scanning') && items.length > 0 && (
        <ul role="list" aria-label="Continuity issues" className="cp-issues-list">
          {(['critical', 'high', 'medium', 'low', 'ignored'] as GroupKey[]).map((key) => {
            const groupItems = groups[key];
            if (groupItems.length === 0) return null;
            const isCollapsed = collapsedGroups.has(key);
            const defaultCollapsed = key === 'low' ? hasHigherSeverity : key === 'ignored';
            const collapsed = isCollapsed !== undefined ? collapsedGroups.has(key) : defaultCollapsed;

            return (
              <section key={key} aria-label={`${GROUP_LABELS[key]} issues`}>
                <button
                  type="button"
                  className="cp-group-header"
                  aria-expanded={!collapsed}
                  onClick={() => toggleGroup(key)}
                >
                  <span aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
                  <span>{GROUP_LABELS[key]}</span>
                  <span aria-label={`${groupItems.length} ${groupItems.length === 1 ? 'issue' : 'issues'}`}>
                    ({groupItems.length})
                  </span>
                </button>
                {!collapsed && (
                  <ul role="list" className="cp-group-list">
                    {groupItems.map((item) => (
                      <InconsistencyCard
                        key={item.id}
                        item={item}
                        archiveStoryEditConsentGiven={archiveStoryEditConsentGiven}
                        onResolve={handleResolve}
                        onConsentGranted={handleConsentGranted}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </ul>
      )}

      {/* M12.3: contradictions elsewhere in the manuscript — fed by the
          GLOBAL query, so a flag in a scene outside the current scan scope
          (or the current editor scene) still surfaces here. */}
      {(() => {
        const elsewhere = globalItems.filter((g) => g.sceneId !== scene?.id);
        if (elsewhere.length === 0) return null;
        return (
          <section
            className="cp-global-section"
            aria-label="Contradictions elsewhere in the manuscript"
            data-testid="cp-global-contradictions"
          >
            <button
              type="button"
              className="cp-group-header"
              aria-expanded={!globalCollapsed}
              onClick={() => setGlobalCollapsed((v) => !v)}
            >
              <span aria-hidden="true">{globalCollapsed ? '▶' : '▼'}</span>
              <span>Elsewhere in manuscript</span>
              <span aria-label={`${elsewhere.length} ${elsewhere.length === 1 ? 'contradiction' : 'contradictions'}`}>
                ({elsewhere.length})
              </span>
            </button>
            {!globalCollapsed && (
              <ul role="list" className="cp-global-list">
                {elsewhere.map((g) => (
                  <li key={g.id} className={`cp-global-item cp-global-item--${g.severity}`}>
                    <span className="cp-global-excerpt">{g.excerpt}</span>
                    <span className="cp-global-meta">{g.vaultNotePath}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })()}

      {/* Panel footer: token cost */}
      {lastTokenUsed !== null && panelState !== 'empty' && panelState !== 'not_scanned' && (
        <div className="cp-footer">
          <button
            type="button"
            className="cp-footer-toggle"
            aria-expanded={footerExpanded}
            onClick={() => setFooterExpanded((v) => !v)}
          >
            {footerExpanded ? '▼' : '>'} last scan: ~{lastTokenUsed.toLocaleString()} tokens
          </button>
          {footerExpanded && (
            <p className="cp-footer-detail">
              Tokens consumed by the last continuity scan. Adjust the scan budget in Archive Agent settings.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
