/**
 * @returns {string}
 */
export function ensureRunId(): string;
/**
 * Case-insensitive on win32 and darwin. Pure string compare; callers pass realpaths.
 * @param {string} a
 * @param {string} b
 * @param {string} [platform]
 * @returns {boolean}
 */
export function sameDir(a: string, b: string, platform?: string): boolean;
/**
 * @param {string} name
 * @returns {string}
 */
export function makeTestTmp(name: string): string;
/**
 * @param {string} p
 * @returns {void}
 */
export function removeRecorded(p: string): void;
/**
 * Remove every recorded directory. One AggregateError if any remove fails.
 * An empty record set is a no-op (R20).
 * @returns {void}
 */
export function cleanupTestTmp(): void;
