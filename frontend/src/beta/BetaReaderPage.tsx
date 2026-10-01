// Beta Reader agent view (SKY-6982, Beta 4 M27; §10 FULL-SPEC).
//
// Full-page overlay, opened from the agent hub "Beta Reader" row and the
// Tools menu ("Beta read this chapter") — not a nav-rail tab (per the M27
// build-plan note). Two pages: Reports (default) and Chat.
//
// Data flow: Run a Beta Read → window.api.betaReportRun (persona+budget-aware
// LLM call, electron-main/src/betaReport.ts) → structured report (score
// chips + LOVED/STUMBLED/CONFUSED reactions, each citing an exact sceneId) →
// this component posts one margin comment per reaction through the M9/M11
// comments store (kind: 'beta') so they land in the manuscript gutter with
// Beta Reader attribution, then persists the report to the BETA READS
// history (electron-main SQLite) for the left column.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chapter, Scene, Story } from '../types';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast/Toast';
import { useAgentActivity } from '../agents/agentActivity';
import { resolveAgentDisplayName, type NamedAgentId } from '../agents/agentIdentity';
import { PARTNER_SESSION_AGENT, resolvePartnerDisplayName } from '../agents/partnerIdentity';
import { useMiniAgentChat } from '../timeline2/panel/useMiniAgentChat';
import MiniAgentChat from '../timeline2/panel/MiniAgentChat';
import { invokeBrainstorm } from '../timeline2/panel/BrainstormTab';
import { createComment, isValidAnchor } from '../comments';
import { buildBetaReadSourceText, buildScopeOptions, findSceneAndChapter, type BetaScopeOption } from './textAssembly';
import ProductionReviewPanel from './ProductionReviewPanel';
import type { ProductionRoleId } from '../agents/productionRoles';
import './BetaReaderPage.css';

// SKY-11411: a third page runs the production-team roles (Alpha Reader / Storyline
// Consultant / Line Editor) through the same reveal-point-aware path.
type BetaReaderTab = 'reports' | 'chat' | 'production';

const FOCUS_DEFS: Array<{ key: keyof BetaReportFocus; label: string }> = [
  { key: 'pacing', label: 'Pacing' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'character', label: 'Character' },
  { key: 'plot', label: 'Plot' },
];

const REACTION_META: Record<BetaReportReaction['kind'], { label: string; color: string }> = {
  loved: { label: 'LOVED', color: '#8ad9ff' },
  stumbled: { label: 'STUMBLED', color: '#ffd319' },
  confused: { label: 'CONFUSED', color: '#ff5f8f' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function ScoreChip({ label, score, verdict }: { label: string; score: number; verdict: BetaReportVerdict }) {
  return (
    <div className={`beta-score-chip beta-score-chip--${verdict}`}>
      <span className="beta-score-chip__label">{label}</span>
      <span className="beta-score-chip__score">{score}</span>
    </div>
  );
}

interface ReactionCardProps {
  reaction: BetaReportReaction;
  sceneTitle?: string;
  onShowInManuscript?: (sceneId: string) => void;
}

function ReactionCard({ reaction, sceneTitle, onShowInManuscript }: ReactionCardProps) {
  const meta = REACTION_META[reaction.kind];
  return (
    <div className="beta-reaction-card" style={{ ['--beta-reaction-color' as string]: meta.color }}>
      <div className="beta-reaction-card__head">
        <span className="beta-reaction-card__kind">{meta.label}</span>
        <span className="beta-reaction-card__where">{sceneTitle ?? reaction.where}</span>
      </div>
      <blockquote className="beta-reaction-card__quote">“{reaction.quote}”</blockquote>
      {reaction.note && <p className="beta-reaction-card__note">{reaction.note}</p>}
      {onShowInManuscript && (
        <button
          type="button"
          className="beta-reaction-card__show"
          onClick={() => onShowInManuscript(reaction.sceneId)}
        >
          Show in manuscript
        </button>
      )}
    </div>
  );
}

export interface BetaReaderPageProps {
  story: Story | null;
  chapter: Chapter | null;
  scene: Scene | null;
  agentNames?: Partial<Record<NamedAgentId, string>>;
  /** SKY-11411: per-role enable state (agents.<role>.enabled) for the Production Team tab. */
  productionRolesEnabled?: Partial<Record<ProductionRoleId, boolean>>;
  onClose: () => void;
  /** Jump the manuscript view to a scene (and close this overlay). Omit to disable "Show in manuscript". */
  onNavigateToScene?: (sceneId: string, chapterId: string) => void;
}

export default function BetaReaderPage({ story, chapter, scene, agentNames, productionRolesEnabled, onClose, onNavigateToScene }: BetaReaderPageProps) {
  const [tab, setTab] = useState<BetaReaderTab>('reports');
  const scopeOptions = useMemo(() => buildScopeOptions(story, chapter, scene), [story, chapter, scene]);
  const [scopeKind, setScopeKind] = useState<BetaScopeOption['kind'] | null>(scopeOptions[0]?.kind ?? null);
  const activeScope = scopeOptions.find((o) => o.kind === scopeKind) ?? scopeOptions[0] ?? null;

  const [focus, setFocus] = useState<BetaReportFocus>({ pacing: true, clarity: true, character: true, plot: true });
  const [running, setRunning] = useState(false);

  const [reports, setReports] = useState<BetaReportSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<BetaReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const { toast, showToast, clearToast } = useToast(4500);
  useAgentActivity(running);

  const partnerChat = useMiniAgentChat(PARTNER_SESSION_AGENT, invokeBrainstorm);
  const partnerName = resolvePartnerDisplayName(agentNames);
  const agentLabel = resolveAgentDisplayName('betaReader', agentNames);

  const storyId = story?.id ?? null;
  const storyPath = story?.path ?? null;

  // Load the BETA READS history for this story, and hydrate the newest report.
  useEffect(() => {
    if (!storyId || typeof window.api?.betaReportList !== 'function') {
      setReports([]);
      setSelectedReportId(null);
      setSelectedReport(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    void window.api.betaReportList(storyId)
      .then((res) => {
        if (cancelled) return;
        setReports(res.reports);
        if (res.reports.length > 0) {
          setSelectedReportId(res.reports[0].id);
        } else {
          setSelectedReportId(null);
          setSelectedReport(null);
        }
      })
      .catch(() => { if (!cancelled) setReports([]); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [storyId]);

  // Hydrate the full report whenever the selection changes. Skips the
  // round-trip when selectedReport already matches (e.g. right after Run,
  // whose response already carries the full report) — mirrors
  // useAgentSessions' activeSessionRef guard so this fetch can't clobber a
  // report we just set directly.
  const selectedReportRef = useRef<BetaReport | null>(null);
  useEffect(() => { selectedReportRef.current = selectedReport; }, [selectedReport]);
  useEffect(() => {
    if (!selectedReportId || typeof window.api?.betaReportGet !== 'function') {
      if (!selectedReportId) setSelectedReport(null);
      return;
    }
    if (selectedReportRef.current?.id === selectedReportId) return;
    let cancelled = false;
    setReportLoading(true);
    void window.api.betaReportGet(selectedReportId)
      .then((res) => { if (!cancelled) setSelectedReport(res.report); })
      .catch(() => { if (!cancelled) setSelectedReport(null); })
      .finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [selectedReportId]);

  const toggleFocus = useCallback((key: keyof BetaReportFocus) => {
    setFocus((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleRun = useCallback(async () => {
    if (!story || !activeScope) {
      showToast('Open a story first — the Beta Reader needs something to read.', 'warn');
      return;
    }
    const text = buildBetaReadSourceText(activeScope, story);
    if (!text.trim()) {
      showToast(`${activeScope.label} is empty — nothing to beta read.`, 'warn');
      return;
    }
    if (typeof window.api?.betaReportRun !== 'function') {
      showToast('Beta Reader is unavailable in this build.', 'error');
      return;
    }

    setRunning(true);
    try {
      const res = await window.api.betaReportRun({ storyId: story.id, scope: activeScope, focus, text });
      if ('error' in res) throw new Error(res.error);
      const { report } = res;

      setReports((prev) => [
        { id: report.id, storyId: report.storyId, scope: report.scope, overall: report.overall, createdAt: report.createdAt },
        ...prev,
      ]);
      setSelectedReportId(report.id);
      setSelectedReport(report);

      let posted = 0;
      if (storyPath) {
        for (const reaction of report.reactions) {
          const found = findSceneAndChapter(story, reaction.sceneId);
          if (!found || !isValidAnchor(reaction.quote)) continue;
          createComment({
            storyId: story.id,
            storyPath,
            sceneId: found.scene.id,
            anchor: reaction.quote,
            text: `${REACTION_META[reaction.kind].label} — ${reaction.note || 'no note'}`,
            kind: 'beta',
            author: agentLabel,
          });
          posted += 1;
        }
      }

      showToast(
        posted > 0
          ? `${agentLabel} finished — report ready, ${posted} margin comment${posted === 1 ? '' : 's'} posted.`
          : `${agentLabel} finished — report ready.`,
        'info',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // SKY-11223: a deliberate stop via the shared activity indicator's Stop
      // button surfaces here as a rejection too — it is not a failure, so it
      // gets no error toast (the indicator already showed "Stopped").
      if (msg === 'cancelled') return;
      showToast(msg || `${agentLabel} failed — try again.`, 'error');
    } finally {
      setRunning(false);
    }
  }, [story, activeScope, focus, storyPath, agentLabel, showToast]);

  const handleShowInManuscript = useCallback((sceneId: string) => {
    const found = findSceneAndChapter(story, sceneId);
    if (!found) { showToast('That scene has moved or been deleted.', 'warn'); return; }
    onNavigateToScene?.(found.scene.id, found.chapter.id);
    onClose();
  }, [story, onNavigateToScene, onClose, showToast]);

  const sceneTitleFor = useCallback((sceneId: string): string | undefined => {
    return findSceneAndChapter(story, sceneId)?.scene.title;
  }, [story]);

  const workingWell = selectedReport?.categories.filter((c) => c.verdict === 'strong') ?? [];
  const watchList = selectedReport?.categories.filter((c) => c.verdict !== 'strong') ?? [];

  return (
    <div className="beta-reader-overlay" role="dialog" aria-modal="true" aria-label="Beta Reader">
      <div className="beta-reader-panel">
        <header className="beta-reader-header">
          <div className="beta-reader-header__icon" aria-hidden="true">👁</div>
          <div className="beta-reader-header__text">
            <h2>{agentLabel}</h2>
            <p>Reads your pages like a first-time reader and leaves honest feedback.</p>
          </div>
          <div className="beta-reader-seg" role="tablist" aria-label="Beta Reader pages">
            <button type="button" role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>Reports</button>
            <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Chat</button>
            <button type="button" role="tab" aria-selected={tab === 'production'} className={tab === 'production' ? 'active' : ''} onClick={() => setTab('production')}>Production Team</button>
          </div>
          <button type="button" className="beta-reader-close" onClick={onClose} aria-label="Close Beta Reader">✕</button>
        </header>

        {tab === 'reports' && (
          <div className="beta-reader-columns">
            <aside className="beta-reader-left" aria-label="Beta reads history">
              <h3>BETA READS</h3>
              {historyLoading ? (
                <p className="beta-reader-muted" role="status">Loading…</p>
              ) : reports.length === 0 ? (
                <p className="beta-reader-muted">No reads yet.</p>
              ) : (
                <ul className="beta-reader-history-list">
                  {reports.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={`beta-reader-history-item${r.id === selectedReportId ? ' active' : ''}`}
                        onClick={() => setSelectedReportId(r.id)}
                      >
                        <span className="beta-reader-history-item__date">{formatDate(r.createdAt)}</span>
                        <span className="beta-reader-history-item__scope">{r.scope.label}</span>
                        <span className={`beta-score-chip beta-score-chip--${r.overall.verdict} beta-score-chip--small`}>{r.overall.score}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            <main className="beta-reader-main" aria-label="Beta read report">
              {reportLoading ? (
                <p className="beta-reader-muted" role="status">Loading report…</p>
              ) : !selectedReport ? (
                <div className="beta-reader-empty">
                  <div className="beta-reader-empty__icon" aria-hidden="true">👁</div>
                  <h3>No beta reads yet</h3>
                  <p>Run your first read to get score chips and reader reactions for this story.</p>
                </div>
              ) : (
                <>
                  <div className="beta-reader-report-head">
                    <p className="beta-reader-report-scope">{selectedReport.scope.label} · read as First-time reader · {formatDate(selectedReport.createdAt)}</p>
                    <div className="beta-reader-score-row">
                      <ScoreChip label="Overall" score={selectedReport.overall.score} verdict={selectedReport.overall.verdict} />
                      {selectedReport.categories.map((c) => (
                        <ScoreChip key={c.key} label={c.label} score={c.score} verdict={c.verdict} />
                      ))}
                    </div>
                    {selectedReport.feedback && <p className="beta-reader-overall-feedback">{selectedReport.feedback}</p>}
                  </div>

                  <h4 className="beta-reader-reactions-heading">REACTIONS</h4>
                  {selectedReport.reactions.length === 0 ? (
                    <p className="beta-reader-muted">No standout reactions in this read.</p>
                  ) : (
                    <div className="beta-reader-reactions-list">
                      {selectedReport.reactions.map((r) => (
                        <ReactionCard
                          key={r.id}
                          reaction={r}
                          sceneTitle={sceneTitleFor(r.sceneId)}
                          onShowInManuscript={onNavigateToScene ? handleShowInManuscript : undefined}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </main>

            <aside className="beta-reader-right" aria-label="Run a beta read">
              <section className="beta-reader-run-card">
                <h3>Run a Beta Read</h3>
                <label className="beta-reader-field">
                  <span>What to read</span>
                  <select
                    value={scopeKind ?? ''}
                    onChange={(e) => setScopeKind(e.target.value as BetaScopeOption['kind'])}
                    disabled={scopeOptions.length === 0}
                  >
                    {scopeOptions.length === 0 && <option value="">No story open</option>}
                    {scopeOptions.map((o) => (
                      <option key={o.kind} value={o.kind}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <div className="beta-reader-focus-toggles">
                  <span className="beta-reader-focus-label">Focus on</span>
                  {FOCUS_DEFS.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`beta-reader-focus-toggle${focus[key] ? ' active' : ''}`}
                      aria-pressed={focus[key]}
                      onClick={() => toggleFocus(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="beta-reader-run-btn"
                  onClick={() => void handleRun()}
                  disabled={running || !activeScope}
                >
                  {running ? <span className="beta-reader-run-btn__pulse">Reading…</span> : 'Run'}
                </button>
                <p className="beta-reader-how">Nothing is rewritten; the Beta Reader only reacts.</p>
              </section>

              <section className="beta-reader-feedback-card">
                <h3>General feedback</h3>
                <p className="beta-reader-reads-count">{reports.length} read{reports.length === 1 ? '' : 's'} so far</p>
                {selectedReport ? (
                  <>
                    <p className="beta-reader-feedback-text">{selectedReport.feedback}</p>
                    {workingWell.length > 0 && (
                      <div className="beta-reader-feedback-group">
                        <span className="beta-reader-feedback-group__label">Working well</span>
                        <span>{workingWell.map((c) => c.label).join(', ')}</span>
                      </div>
                    )}
                    {watchList.length > 0 && (
                      <div className="beta-reader-feedback-group">
                        <span className="beta-reader-feedback-group__label">Watch list</span>
                        <span>{watchList.map((c) => c.label).join(', ')}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="beta-reader-muted">Run a read to see feedback here.</p>
                )}
              </section>
            </aside>
          </div>
        )}
        {tab === 'chat' && (
          <div className="beta-chat-page" data-testid="beta-partner-chat-wrap">
            <MiniAgentChat
              chat={partnerChat}
              accent="brainstorm"
              partnerName={partnerName}
              placeholder={`Message ${partnerName}…`}
              testidPrefix="beta-partner"
            />
          </div>
        )}
        {tab === 'production' && (
          <div className="beta-reader-columns beta-reader-columns--production">
            <ProductionReviewPanel
              story={story}
              chapter={chapter}
              scene={scene}
              rolesEnabled={productionRolesEnabled}
              agentNames={agentNames}
            />
          </div>
        )}
      </div>
      <Toast message={toast?.message ?? null} level={toast?.level} onDismiss={clearToast} />
    </div>
  );
}
