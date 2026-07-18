// Beta 4 M22 — Axis engine: lane color palette + alpha helper.
// Prototype `tlLanePal` (6038) with the Neon Classic slot colors (3973) and
// `hexA` (4591).

/** Prototype tlLanePal resolved against the Neon Classic theme slots. */
export const LANE_PALETTE: readonly string[] = [
  '#00f0ff', '#9b5fff', '#ff4dff', '#ff9a3d', '#2fe6c8', '#3d9bff',
  '#ffd319', '#3d9bff', '#2fe6c8',
];

/** Prototype `laneCol` (6039): palette lookup, safe for any integer. */
export function laneColor(index: number | null | undefined): string {
  const i = Number.isFinite(index as number) ? Math.trunc(index as number) : 0;
  return LANE_PALETTE[((i % LANE_PALETTE.length) + LANE_PALETTE.length) % LANE_PALETTE.length];
}

/** Prototype `hexA` (4591): #rrggbb → rgba(r,g,b,a). */
export function hexA(hex: string, alpha: number): string {
  const h = (hex || '').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return `rgba(255,255,255,${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
  }
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}
