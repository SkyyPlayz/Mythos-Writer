// Strict integer parser for user-facing number inputs.
//
// `parseInt` silently accepts partial/garbage input: `parseInt('1e3', 10)` is
// `1`, `parseInt('12abc', 10)` is `12`, and `parseInt('  5 ', 10)` is `5`. For
// editable fields (day, daily goal, word count) that means a typo can be saved
// as a plausible-but-wrong number with no error (GH#624/#625/#627).
//
// This helper only accepts a string that is *entirely* an optionally-signed
// base-10 integer (after trimming surrounding whitespace). Anything else —
// empty, decimals, exponent notation, trailing letters — returns null so the
// caller can reject it instead of persisting a corrupted value.
export function parseStrictInt(input: string): number | null {
  const trimmed = input.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}
