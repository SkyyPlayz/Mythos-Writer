// SKY-10: MigrationBanner — surfaces the legacy → per-scene migration when a
// project that pre-dates SKY-9/SKY-15 is opened.
//
// Click "Migrate" → dry-run modal lists every change → user confirms → apply.
// The legacy file is snapshotted as `migration` intent before unlinking so the
// SceneHistoryPane can roll the change back if the user changes their mind.
import React, { useEffect, useState } from 'react';
import './MigrationBanner.css';

export interface MigrationBannerProps {
  /** Optional initial poll — when set, the banner skips the inline dry-run on mount. */
  initialPlans?: MigrationPlan[];
  /** Called after the user successfully applies one or more plans. */
  onMigrated?: () => void;
}

export function MigrationBanner({ initialPlans, onMigrated }: MigrationBannerProps): React.ReactElement | null {
  const [plans, setPlans] = useState<MigrationPlan[] | null>(initialPlans ?? null);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPlans) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await window.api.migrationDryRun();
        if (!cancelled) setPlans(res.plans);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialPlans]);

  if (!plans || plans.length === 0) return null;

  const totalFiles = plans.reduce((acc, p) => acc + p.detectedLegacyFiles.length, 0);

  const handleApplyAll = async () => {
    setApplying(true);
    setError(null);
    try {
      for (const plan of plans) {
        await window.api.migrationApply(plan.planId, plan.storyPath);
      }
      setOpen(false);
      setPlans([]);
      onMigrated?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <div className="migration-banner" role="status" aria-live="polite">
        <span className="migration-banner-text">
          {totalFiles === 1
            ? '1 legacy chapter file can be migrated to the per-scene layout.'
            : `${totalFiles} legacy chapter files can be migrated to the per-scene layout.`}
        </span>
        <button
          type="button"
          className="migration-banner-action"
          onClick={() => setOpen(true)}
          aria-label="Review migration"
        >
          Review
        </button>
      </div>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Migration preview" className="migration-modal">
          <div className="migration-modal-card">
            <h2>Migrate to per-scene layout?</h2>
            <p>
              This converts each chapter into a folder containing one scene per file. The original
              chapter file is archived as a migration-intent snapshot you can roll back from the
              history pane.
            </p>

            <div className="migration-modal-body">
              {plans.map((plan) => (
                <section key={plan.planId} className="migration-plan-section">
                  <h3>{plan.storyPath}</h3>
                  <ul className="migration-change-list">
                    {plan.changes.map((change, idx) => (
                      <li key={idx} className={`migration-change migration-change--${change.kind}`}>
                        <span className="migration-change-path">{change.path}</span>
                        <span className="migration-change-description">{change.description}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {error ? (
              <p role="alert" className="migration-modal-error">
                {error}
              </p>
            ) : null}

            <div className="migration-modal-actions">
              <button type="button" onClick={() => setOpen(false)} disabled={applying}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleApplyAll}
                disabled={applying}
              >
                {applying ? 'Migrating…' : 'Migrate'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default MigrationBanner;
