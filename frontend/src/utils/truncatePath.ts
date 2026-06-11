const ELLIPSIS = '…';

export interface TruncatePathOptions {
  homeDir?: string;
  sep?: '/' | '\\';
}

interface ParsedPath {
  root: string;
  segments: string[];
  isUnc: boolean;
}

export function truncatePath(path: string, maxChars: number, options: TruncatePathOptions = {}): string {
  if (!path || maxChars <= 0) return '';

  const sep = options.sep ?? inferSeparator(path);
  const normalized = normalizeHomePath(path, options.homeDir, sep);

  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= ELLIPSIS.length + 1) return ELLIPSIS.slice(0, maxChars);

  const parsed = parsePath(normalized, sep);
  if (parsed.segments.length < 2) return truncateMiddle(normalized, maxChars);

  const preferredLeftCount = parsed.isUnc ? 0 : parsed.root === '/' ? 2 : 1;
  for (let leftCount = Math.min(preferredLeftCount, parsed.segments.length - 1); leftCount >= 0; leftCount -= 1) {
    for (const tailSize of [2, 1]) {
      const lastSegments = parsed.segments.slice(-tailSize);
      if (leftCount + lastSegments.length >= parsed.segments.length) continue;

      const singleHiddenCandidate = buildSingleHiddenSegmentCandidate(parsed, leftCount, lastSegments, maxChars, sep);
      if (singleHiddenCandidate) return singleHiddenCandidate;

      const candidate = buildPath(parsed.root, [
        ...parsed.segments.slice(0, leftCount),
        ELLIPSIS,
        ...lastSegments,
      ], sep);
      if (candidate.length <= maxChars) return candidate;
    }
  }

  return fallbackWithTruncatedSegment(parsed, maxChars, sep);
}

function inferSeparator(path: string): '/' | '\\' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

function normalizeHomePath(path: string, homeDir: string | undefined, sep: '/' | '\\'): string {
  if (!homeDir) return path;

  const trimmedHome = trimTrailingSeparators(homeDir);
  if (!trimmedHome) return path;

  const homePrefix = `${trimmedHome}${sep}`;
  if (path === trimmedHome) return '~';
  if (path.startsWith(homePrefix)) return `~${sep}${path.slice(homePrefix.length)}`;

  return path;
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function parsePath(path: string, sep: '/' | '\\'): ParsedPath {
  if (sep === '\\') return parseWindowsLikePath(path);
  return parsePosixLikePath(path);
}

function parsePosixLikePath(path: string): ParsedPath {
  if (path === '~') return { root: '~', segments: [], isUnc: false };
  if (path.startsWith('~/')) {
    return { root: '~/', segments: path.slice(2).split('/').filter(Boolean), isUnc: false };
  }
  if (path.startsWith('/')) {
    return { root: '/', segments: path.slice(1).split('/').filter(Boolean), isUnc: false };
  }
  return { root: '', segments: path.split('/').filter(Boolean), isUnc: false };
}

function parseWindowsLikePath(path: string): ParsedPath {
  if (path.startsWith('\\\\')) {
    const parts = path.slice(2).split('\\').filter(Boolean);
    if (parts.length >= 2) {
      return {
        root: `\\\\${parts[0]}\\${parts[1]}\\`,
        segments: parts.slice(2),
        isUnc: true,
      };
    }
  }

  if (path === '~') return { root: '~', segments: [], isUnc: false };
  if (path.startsWith('~\\')) {
    return { root: '~\\', segments: path.slice(2).split('\\').filter(Boolean), isUnc: false };
  }

  const driveMatch = /^([A-Za-z]:)(?:\\)?(.*)$/.exec(path);
  if (driveMatch) {
    return {
      root: `${driveMatch[1]}\\`,
      segments: driveMatch[2].split('\\').filter(Boolean),
      isUnc: false,
    };
  }

  return { root: '', segments: path.split('\\').filter(Boolean), isUnc: false };
}

function buildPath(root: string, segments: string[], sep: '/' | '\\'): string {
  if (segments.length === 0) return root;
  if (!root) return segments.join(sep);
  if (root.endsWith(sep)) return `${root}${segments.join(sep)}`;
  return `${root}${sep}${segments.join(sep)}`;
}

function buildSingleHiddenSegmentCandidate(
  parsed: ParsedPath,
  leftCount: number,
  lastSegments: string[],
  maxChars: number,
  sep: '/' | '\\',
): string | null {
  const hidden = parsed.segments.slice(leftCount, parsed.segments.length - lastSegments.length);
  if (hidden.length !== 1) return null;

  const prefixSegments = parsed.segments.slice(0, leftCount);
  const suffix = lastSegments.join(sep);
  const prefix = buildPath(parsed.root, prefixSegments, sep);
  const prefixWithSep = prefix ? `${prefix}${prefix.endsWith(sep) ? '' : sep}` : '';
  const suffixWithSep = suffix ? `${sep}${suffix}` : '';
  const hiddenBudget = maxChars - prefixWithSep.length - suffixWithSep.length;
  if (hiddenBudget <= ELLIPSIS.length) return null;

  const truncatedHidden = truncateMiddle(hidden[0], hiddenBudget > 8 ? hiddenBudget - 1 : hiddenBudget);
  const candidate = `${prefixWithSep}${truncatedHidden}${suffixWithSep}`;
  return candidate.length <= maxChars ? candidate : null;
}

function fallbackWithTruncatedSegment(parsed: ParsedPath, maxChars: number, sep: '/' | '\\'): string {
  const firstCount = parsed.isUnc ? 0 : Math.min(1, Math.max(parsed.segments.length - 2, 0));
  const first = parsed.segments.slice(0, firstCount);
  const last = parsed.segments[parsed.segments.length - 1];
  const middle = parsed.segments[firstCount] ?? parsed.segments[0] ?? '';

  const withoutMiddle = buildPath(parsed.root, [...first, '', last].filter((_, index, arr) => index !== 1 || arr.length > 2), sep);
  const middleBudget = Math.max(1, maxChars - withoutMiddle.length);
  const truncatedMiddle = truncateMiddle(middle, middleBudget > 8 ? middleBudget - 1 : middleBudget);
  const candidate = buildPath(parsed.root, [...first, truncatedMiddle, last], sep);

  return candidate.length <= maxChars ? candidate : truncateMiddle(candidate, maxChars);
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= ELLIPSIS.length) return ELLIPSIS;

  const remaining = maxChars - ELLIPSIS.length;
  const front = Math.max(1, Math.ceil(remaining * 0.6));
  const back = Math.max(1, remaining - front);

  return `${value.slice(0, front)}${ELLIPSIS}${value.slice(value.length - back)}`;
}
