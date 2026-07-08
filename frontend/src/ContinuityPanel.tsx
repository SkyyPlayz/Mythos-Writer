import { useState, useEffect, useCallback, useRef } from 'react';
import { ScrollText, CircleCheck } from 'lucide-react';
import { useAgentActivity } from './agents/agentActivity';
import type { Scene } from './types';
import { InconsistencyCard } from './InconsistencyCard';
import type { InconsistencyItem, ResolutionAction } from './InconsistencyCard';
import { PanelHeader } from './components/ui/PanelChrome';
import './ContinuityPanel.css';

export type { InconsistencyItem };

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
  archiveStoryEditConsentGiven?: boolean;
  archiveScanScope?: 'active_scene' | 'active_chapter' | 'full_manuscript';
  onConsentGranted?: () => void;
  onCountChange?: (count: number) => void;
  onOpenSettings?: () => void;
}

export default function ContinuityPanel({
  scene,
  enabled = true,
  archiveStoryEditConsentGiven = false,
  archiveScanScope = 'active_scene',
  onConsentGranted,
  onCountChange,
  onOpenSettings,
}: ContinuityPanelProps) {
  const [panelState, setPanelState] = useState<PanelState>('loading');
  const [items, setItems] = useState<InconsistencyItem[]>([]);
  // Beta 3 M22: archive scans light the workspace tab strip's agents chip.
  useAgentActivity(panelState === 'scanning');
  const [lastTokenUsed, setLastTokenUsed] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
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
    });

    const unsubError = window.api.onArchiveContScanError((data) => {
      setPanelState(classifyError(data.error));
      setStatusMsg(data.error);
    });

    return () => {
      unsubStart();
      unsubResult();
      unsubError();
    };
  }, [enabled]);

  const handleResolve = useCallback(async (id: string, action: ResolutionAction) => {
    let previousItem: InconsistencyItem | undefined;
    const resolvedAt = new Date().toISOString();
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

    try {
      await window.api.archiveResolveContinuity(id, action);
    } catch {
      if (previousItem) {
        const restored = previousItem as InconsistencyItem;
        setItems((prev) => prev.map((item) => (item.id === id ? restored : item)));
      }
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
    void window.api.archiveScanContinuity(scene.id, prose, archiveScanScope);
  }, [scene, archiveScanScope]);

  const toggleGroup = useCallback((group: GroupKey) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  if (!enabled) {
    return (
      <div className="cp-panel">
        <PanelHeader
          icon={<ScrollText size={14} aria-hidden="true" />}
          title="Continuity"
        />
        <p role="status" className="cp-status-msg" aria-live="polite">Archive Agent is disabled. Enable it in Settings.</p>
      </div>
    );
  }

  const groups = groupItems(items);
  const hasHigherSeverity = groups.critical.length > 0 || groups.high.length > 0 || groups.medium.length > 0;

  return (
    <div className="cp-panel">
      <PanelHeader
        icon={<ScrollText size={14} aria-hidden="true" />}
        title="Continuity"
      />
      {/* Always-in-DOM aria-live status region */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {statusMsg}
      </p>

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
