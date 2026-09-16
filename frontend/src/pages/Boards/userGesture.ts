/**
 * SKY-11192 — proof that a real person clicked.
 *
 * Two Boards code paths write to the user's vault: filing one idea from Idea
 * Collections (`useIdeaFiling`) and migrating the retired brainstorm board into
 * notes (`useBoardMigration`). Ticket AC 4 says both are ALWAYS a direct user
 * action and never something an agent, a timer or a mount effect does on the
 * user's behalf, so both demand the same token and it lives here rather than
 * being implemented twice with a chance of drifting apart.
 *
 * The token is unforgeable in both directions:
 *
 *   AT COMPILE TIME it is branded with a `unique symbol`, so no object literal
 *   is assignable to `UserGesture`.
 *
 *   AT RUNTIME the only value that satisfies `isUserGesture` is the private
 *   `GESTURE` singleton below, which is NOT exported. The single way to obtain
 *   it is `userGestureFrom(event)` with a trusted DOM event behind it. That is
 *   why `GESTURE` stays module-private: exporting it would let any caller —
 *   including an agent code path — import a valid token directly and every
 *   other lock would be decoration.
 */

declare const userGestureBrand: unique symbol;

/**
 * Proof that a real user activated a control. Branded so it cannot be
 * structurally faked by an object literal in TypeScript, and only mintable
 * from a trusted DOM event at runtime.
 */
export interface UserGesture {
  readonly [userGestureBrand]: true;
}

/** The one valid token. Deliberately not exported — see the file header. */
const GESTURE: UserGesture = Object.freeze({}) as UserGesture;

/**
 * Mint a gesture token from a React event, or `null` if the event was not
 * user-generated.
 *
 * `isTrusted` is the browser's own answer to "did a human do this": it is true
 * only for events the user agent dispatched from real input, and false for
 * anything script-dispatched, including `element.click()` and a hand-built
 * `new MouseEvent(...)`. We read it off `nativeEvent` because React's
 * synthetic wrapper is script-constructed by definition.
 */
export function userGestureFrom(
  // `nativeEvent: unknown` rather than the React event types: the guarantee
  // here is a RUNTIME one (`instanceof Event` plus `isTrusted`), and a
  // narrower compile-time type would only imply a promise the types cannot
  // keep — a caller can always assert past it.
  event: { nativeEvent?: unknown } | null | undefined,
): UserGesture | null {
  const native: unknown = event?.nativeEvent;
  // Must be an actual DOM Event — a plain object claiming isTrusted is not.
  if (typeof Event === 'undefined' || !(native instanceof Event)) return null;
  return native.isTrusted ? GESTURE : null;
}

/**
 * The check every vault write behind AC 4 performs. Identity against the
 * private singleton, so a branded-looking value cast in from outside fails.
 */
export function isUserGesture(gesture: UserGesture | null | undefined): boolean {
  return gesture === GESTURE;
}
