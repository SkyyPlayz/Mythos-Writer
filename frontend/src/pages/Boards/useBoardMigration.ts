/**
 * SKY-11192 — offering the retired brainstorm board's cards to the user.
 *
 * ── Why this is a prompt and not an effect ─────────────────────────────────
 * The legacy Brainstorm board is a single JSON blob of cards. The unified
 * board replaces that model, and `migrateBrainstormBoardToNotes` in the main
 * process turns each card into a real note and parks the source file.
 *
 * That migration WRITES TO THE USER'S VAULT: it creates files they did not ask
 * for in that moment and renames one they may be looking for later. An earlier
 * revision of this feature ran it from a mount effect the first time the
 * unified board rendered. Nothing about it was unsafe — it is idempotent and
 * never overwrites — but it still changed the contents of someone's vault
 * without them asking, which is exactly what this ticket's own load-bearing
 * constraint (AC 4) forbids fifteen lines away in `useIdeaFiling`. Filing one
 * idea needed a click; converting the user's whole board did not. That was
 * inconsistent, and the consistent answer is the stricter one.
 *
 * So the shape here is: LOOK, then ASK, then act.
 *
 *   `preview` is read-only. It stats and parses the board file and answers
 *   "how many cards are waiting". It cannot create, rename or delete anything,
 *   which is why it is safe to run from an effect.
 *
 *   `migrate` is the write, and it carries the same three locks as
 *   `useIdeaFiling`: only reachable through this hook, demands a `UserGesture`
 *   minted from a trusted DOM event, and is single-flight. An agent turn, a
 *   timer or a re-render has nothing to pass it.
 *
 * The user is never blocked by the prompt. Dismissing it hides the banner for
 * the session and leaves the board file untouched, so the offer returns on the
 * next launch — the ideas are not lost by saying "not now", and they are not
 * converted by ignoring it. Dismissal is deliberately NOT persisted: a flag
 * that permanently hides the only route to those cards would be a worse
 * outcome than being asked twice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isUserGesture, type UserGesture } from './userGesture';

/** What is waiting, when there is something worth prompting about. */
export interface BoardMigrationOffer {
  /** Cards that would become notes. Zero only when `unreadable`. */
  pending: number;
  /** The board file exists but does not parse — migrating just parks it. */
  unreadable: boolean;
}

export type MigrateBoardResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; reason: 'no-gesture' | 'busy' | 'error'; message: string };

export interface BoardMigration {
  /** The pending offer, or `null` when there is nothing to migrate. */
  offer: BoardMigrationOffer | null;
  /** True while the write is in flight — drives the button's busy state. */
  running: boolean;
  /**
   * Convert the legacy board, on ONE direct user click.
   * @param gesture must come from `userGestureFrom(clickEvent)`.
   */
  migrate: (gesture: UserGesture | null) => Promise<MigrateBoardResult>;
  /** Hide the offer for this session without touching the vault. */
  dismiss: () => void;
}

/**
 * @param enabled gate the read on the unified board actually being in use with
 *   a valid notes vault; there is nowhere to migrate cards to otherwise.
 */
export function useBoardMigration(enabled: boolean): BoardMigration {
  const [offer, setOffer] = useState<BoardMigrationOffer | null>(null);
  const [running, setRunning] = useState(false);
  // A ref as well as state: two clicks in the same tick must not both pass the
  // guard, and state is not readable synchronously.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setOffer(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.api.brainstormBoard?.migrationPreview?.();
        if (cancelled || !res) return;
        // Nothing waiting and nothing broken: stay silent rather than render an
        // empty banner. This is the steady state after the first migration.
        if (res.pending === 0 && !res.unreadable) return;
        setOffer({ pending: res.pending, unreadable: res.unreadable });
      } catch {
        // No bridge (unit tests, degraded startup) — simply nothing to offer.
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  const dismiss = useCallback(() => setOffer(null), []);

  const migrate = useCallback(async (
    gesture: UserGesture | null,
  ): Promise<MigrateBoardResult> => {
    // LOCK 2 — no trusted user event, no write. This is the line a reviewer
    // should look for; deleting it is the whole regression.
    if (!isUserGesture(gesture)) {
      return { ok: false, reason: 'no-gesture', message: 'Moving these ideas requires a direct click.' };
    }
    // LOCK 3 — one pass at a time.
    if (inFlightRef.current) {
      return { ok: false, reason: 'busy', message: 'Already moving your ideas.' };
    }
    inFlightRef.current = true;
    setRunning(true);
    try {
      const res = await window.api.brainstormBoard?.migrateToNotes?.();
      if (!res) return { ok: false, reason: 'error', message: 'Notes vault is unavailable.' };
      if (res.error && !res.migrated) {
        return { ok: false, reason: 'error', message: res.error };
      }
      // The source file is parked on success, so the offer is spent either way
      // — including the unreadable case, where parking IS the whole outcome.
      setOffer(null);
      return { ok: true, created: res.created.length, skipped: res.skipped.length };
    } catch (err) {
      return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
    } finally {
      inFlightRef.current = false;
      setRunning(false);
    }
  }, []);

  return { offer, running, migrate, dismiss };
}
