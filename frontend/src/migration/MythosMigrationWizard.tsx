// Beta 4 M5 — the MythosVault migration wizard.
//
// Walks the user through the copy-based v0.4 → MythosVault conversion:
//   1. intro    — what the upgrade is, the safety promise
//   2. plan     — read-only inventory of everything that will be carried over
//   3. running  — main builds + verifies the new vault
//   4. report   — verification results; the ORIGINAL is still untouched
//   5. confirm  — repoint the app at the new folder (or keep using v0.4)
//
// Every path is computed by the main process; this component only sequences
// the IPC calls and renders the results.
import { useCallback, useEffect, useState } from 'react';
import './MythosMigration.css';

type WizardStep = 'intro' | 'plan' | 'running' | 'report' | 'switched';

interface Props {
  status: MythosMigrationStatus;
  onClose: () => void;
}

export default function MythosMigrationWizard({ status, onClose }: Props) {
  const [step, setStep] = useState<WizardStep>('intro');
  const [plan, setPlan] = useState<MythosMigrationPlanResult | null>(null);
  const [report, setReport] = useState<MythosMigrationRunResult | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (step !== 'plan' || plan) return;
    let cancelled = false;
    window.api
      .mythosMigrationPlan()
      .then((p) => {
        if (!cancelled) setPlan(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setPlan({ ok: false, error: e instanceof Error ? e.message : 'Could not read the vault.' });
      });
    return () => {
      cancelled = true;
    };
  }, [step, plan]);

  const run = useCallback(() => {
    setStep('running');
    window.api
      .mythosMigrationRun()
      .then((r) => {
        setReport(r);
        setStep('report');
      })
      .catch((e: unknown) => {
        setReport({
          ok: false,
          error: e instanceof Error ? e.message : 'Migration failed.',
          targetRoot: '',
          counts: { stories: 0, chapters: 0, scenes: 0, notes: 0, comments: 0, drafts: 0, extras: 0 },
          verified: { scenesChecked: 0, notesChecked: 0, mismatches: [] },
        });
        setStep('report');
      });
  }, []);

  const confirm = useCallback(() => {
    setConfirming(true);
    setConfirmError(null);
    window.api
      .mythosMigrationConfirm()
      .then((res) => {
        if (res.switched) {
          setStep('switched');
          // Reload the renderer so every store boots against the new vault.
          window.setTimeout(() => window.location.reload(), 900);
        } else {
          setConfirming(false);
          setConfirmError(res.error ?? 'Could not switch to the new vault.');
        }
      })
      .catch((e: unknown) => {
        setConfirming(false);
        setConfirmError(e instanceof Error ? e.message : 'Could not switch to the new vault.');
      });
  }, []);

  return (
    <div className="mythos-migration-overlay" role="dialog" aria-modal="true" aria-label="Upgrade to MythosVault">
      <div className="mythos-migration-modal" data-testid="mythos-migration-wizard">
        <div className="mythos-migration-header">
          <h2>Upgrade to MythosVault</h2>
          {step !== 'running' && step !== 'switched' && (
            <button
              type="button"
              className="mythos-migration-close"
              aria-label="Close"
              data-testid="mythos-migration-close"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>

        {step === 'intro' && (
          <div className="mythos-migration-body" data-testid="mythos-migration-step-intro">
            <p>
              Your vault <strong>“{status.vaultName}”</strong> uses the older two-folder
              layout. The new <strong>MythosVault</strong> format keeps everything —
              manuscripts, notes, comments, draft history, timelines — as plain files in
              one folder you can copy, back up, or sync anywhere.
            </p>
            <ul className="mythos-migration-list">
              <li>Scenes become <code>Part / Chapter / Scene</code> markdown files.</li>
              <li>Draft history becomes numbered <code>.draft-N.md</code> files.</li>
              <li>Comments and agent sessions become files inside the vault.</li>
            </ul>
            <p className="mythos-migration-safety">
              The upgrade is <strong>copy-based</strong>: it builds a complete new folder
              at
              <code className="mythos-migration-path">{status.suggestedTarget}</code>
              and verifies every file. Your current vault is <strong>never modified</strong> —
              it stays exactly where it is until you delete it yourself.
            </p>
            <div className="mythos-migration-actions">
              <button type="button" className="mythos-migration-btn" onClick={onClose}>
                Keep current format
              </button>
              <button
                type="button"
                className="mythos-migration-btn mythos-migration-btn-primary"
                data-testid="mythos-migration-review"
                onClick={() => setStep('plan')}
              >
                Review what moves
              </button>
            </div>
          </div>
        )}

        {step === 'plan' && (
          <div className="mythos-migration-body" data-testid="mythos-migration-step-plan">
            {!plan && <p>Reading your vault…</p>}
            {plan && !plan.ok && (
              <p className="mythos-migration-error">{plan.error ?? 'Could not read the vault.'}</p>
            )}
            {plan?.ok && plan.plan && (
              <>
                <p>Everything below is carried into the new vault:</p>
                <dl className="mythos-migration-stats">
                  <div><dt>Stories</dt><dd>{plan.plan.stories}</dd></div>
                  <div><dt>Chapters</dt><dd>{plan.plan.chapters}</dd></div>
                  <div><dt>Scenes</dt><dd>{plan.plan.scenes}</dd></div>
                  <div><dt>Notes</dt><dd>{plan.plan.noteFiles}</dd></div>
                  <div>
                    <dt>Comments</dt>
                    <dd>{plan.plan.commentFiles + plan.plan.betaCommentRows}</dd>
                  </div>
                  <div>
                    <dt>Draft snapshots</dt>
                    <dd>{plan.plan.versionSnapshots + plan.plan.fileSnapshots + plan.plan.dbSnapshotRows}</dd>
                  </div>
                  <div><dt>Timeline arcs</dt><dd>{plan.plan.timelineArcs}</dd></div>
                </dl>
                {plan.plan.warnings.length > 0 && (
                  <ul className="mythos-migration-warnings">
                    {plan.plan.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                <p className="mythos-migration-safety">
                  New vault folder:
                  <code className="mythos-migration-path">{plan.plan.targetRoot}</code>
                </p>
                <div className="mythos-migration-actions">
                  <button type="button" className="mythos-migration-btn" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="mythos-migration-btn mythos-migration-btn-primary"
                    data-testid="mythos-migration-run"
                    onClick={run}
                  >
                    Build the new vault
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'running' && (
          <div className="mythos-migration-body" data-testid="mythos-migration-step-running">
            <p>Building and verifying your MythosVault…</p>
            <p className="mythos-migration-muted">
              Your current vault is being read, never written.
            </p>
            <div className="mythos-migration-spinner" aria-hidden="true" />
          </div>
        )}

        {step === 'report' && report && (
          <div className="mythos-migration-body" data-testid="mythos-migration-step-report">
            {report.ok ? (
              <>
                <p>
                  <strong>Verified.</strong> {report.verified.scenesChecked} scenes and{' '}
                  {report.verified.notesChecked} notes were checked against the original —
                  no differences found.
                </p>
                <dl className="mythos-migration-stats">
                  <div><dt>Stories</dt><dd>{report.counts.stories}</dd></div>
                  <div><dt>Scenes</dt><dd>{report.counts.scenes}</dd></div>
                  <div><dt>Notes</dt><dd>{report.counts.notes}</dd></div>
                  <div><dt>Comments</dt><dd>{report.counts.comments}</dd></div>
                  <div><dt>Drafts</dt><dd>{report.counts.drafts}</dd></div>
                </dl>
                <p className="mythos-migration-safety">
                  The original vault is kept untouched at
                  <code className="mythos-migration-path">{status.storyVaultRoot}</code>
                  Switch now to start working in
                  <code className="mythos-migration-path">{report.targetRoot}</code>
                </p>
                {confirmError && <p className="mythos-migration-error">{confirmError}</p>}
                <div className="mythos-migration-actions">
                  <button type="button" className="mythos-migration-btn" onClick={onClose} disabled={confirming}>
                    Not yet
                  </button>
                  <button
                    type="button"
                    className="mythos-migration-btn mythos-migration-btn-primary"
                    data-testid="mythos-migration-confirm"
                    onClick={confirm}
                    disabled={confirming}
                  >
                    {confirming ? 'Switching…' : 'Switch to the new vault'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mythos-migration-error">
                  {report.error ?? 'The migration could not be completed.'}
                </p>
                {report.verified.mismatches.length > 0 && (
                  <ul className="mythos-migration-warnings">
                    {report.verified.mismatches.slice(0, 8).map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
                <p className="mythos-migration-safety">
                  Your old vault is kept untouched at
                  <code className="mythos-migration-path">{status.storyVaultRoot}</code>
                  and keeps working as before.
                </p>
                <div className="mythos-migration-actions">
                  <button type="button" className="mythos-migration-btn" onClick={onClose}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'switched' && (
          <div className="mythos-migration-body" data-testid="mythos-migration-step-switched">
            <p>
              <strong>Done.</strong> Reloading into your MythosVault…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
