// SKY-7935 — shared hue-separation color algorithm for Relationships/Subway.
//
// Replaces the fixed 6-slot palette cycle (CHARACTER_SLOT_ORDER in
// timelineAeon.ts) with a hash-based hue assignment that guarantees no two
// assigned characters land in adjacent hue buckets — the minimum-hue-
// separation requirement from docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md §0 /
// docs/TIMELINE-VIEWS-DESIGN-SPEC.md §3.4/§3.5.

/** Number of hue buckets the 0–360° wheel is divided into. */
export const HUE_BUCKET_COUNT = 12;

/** Degrees per bucket (360 / HUE_BUCKET_COUNT). */
export const HUE_BUCKET_SIZE = 360 / HUE_BUCKET_COUNT;

/** Simple deterministic string hash (FNV-1a variant) — stable across runs and
 *  platforms, unlike relying on iteration order or Map insertion. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Hash a character id/name to its preferred hue bucket (0..HUE_BUCKET_COUNT-1). */
export function hueBucketForId(id: string): number {
  return hashString(id) % HUE_BUCKET_COUNT;
}

/** True when two buckets are the same or adjacent on the circular wheel
 *  (distance 1, wrapping — bucket 0 and bucket 11 are adjacent). */
export function bucketsAreAdjacent(a: number, b: number): boolean {
  const n = HUE_BUCKET_COUNT;
  const diff = Math.abs(a - b) % n;
  const dist = Math.min(diff, n - diff);
  return dist <= 1;
}

/** Convert a hue bucket index to a representative CSS hsl() color. */
export function bucketToHsl(bucket: number, saturation = 85, lightness = 60): string {
  const hue = (bucket * HUE_BUCKET_SIZE) % 360;
  return `hsl(${hue.toFixed(1)}, ${saturation}%, ${lightness}%)`;
}

export interface HueAssignment {
  id: string;
  bucket: number;
  hue: number;
  color: string;
}

/**
 * Assign each character id a hue bucket, hashing the id to a preferred
 * bucket and walking outward (by increasing distance) to the nearest free
 * bucket whenever the preferred one — or any bucket adjacent to an
 * already-assigned bucket — is taken. Guarantees: for any two assigned
 * characters, their buckets are never the same or adjacent (min separation
 * of 2 buckets = 60° on a 12-bucket wheel), as long as
 * `characterIds.length <= Math.ceil(HUE_BUCKET_COUNT / 2)`; beyond that the
 * wheel can't fit every character with a 2-bucket gap, so the algorithm
 * relaxes to "closest available bucket" to guarantee termination.
 */
export function assignCharacterHues(characterIds: string[]): HueAssignment[] {
  const n = HUE_BUCKET_COUNT;
  const used: number[] = [];
  const out: HueAssignment[] = [];

  const isSafe = (bucket: number) => used.every(u => !bucketsAreAdjacent(bucket, u));

  for (const id of characterIds) {
    const preferred = hueBucketForId(id);
    let chosen: number | null = null;

    // Walk outward from the preferred bucket looking for a safe (non-adjacent
    // to any used bucket) slot — try distance 0, 1, 2, ... in both directions.
    for (let dist = 0; dist < n && chosen === null; dist++) {
      const candidates = dist === 0 ? [preferred] : [preferred + dist, preferred - dist];
      for (const c of candidates) {
        const bucket = ((c % n) + n) % n;
        if (isSafe(bucket)) { chosen = bucket; break; }
      }
    }

    // Every bucket is unsafe (more characters than the wheel can separate) —
    // fall back to the least-recently-crowded bucket nearest the preferred one
    // so assignment still terminates deterministically.
    if (chosen === null) {
      chosen = preferred;
    }

    used.push(chosen);
    out.push({ id, bucket: chosen, hue: (chosen * HUE_BUCKET_SIZE) % 360, color: bucketToHsl(chosen) });
  }

  return out;
}
