/**
 * Why an entry or a stream was skipped. Torn and stale entries are normal
 * in a cache copied while the browser runs, so they are counted, not thrown.
 */
export const SKIP_REASONS = Object.freeze([
  'bad-address',
  'unallocated-block',
  'out-of-range',
  'missing-file',
  'implausible-key-length',
  'hash-mismatch',
  'inactive-state',
  'chain-loop',
  'no-response-headers',
  'unsupported-encoding',
  'decode-failed',
]);

/** Raised inside the reader for a torn or stale entry; caught at the API boundary. */
export class CacheEntryProblem extends Error {
  constructor(reason, detail) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'CacheEntryProblem';
    this.reason = reason;
  }
}

export function createSkipStats() {
  return { walked: 0, listed: 0, skipped: {} };
}

export function countSkip(stats, reason) {
  stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
}

/** Runs `read`; returns its value, or counts the problem and returns undefined. */
export function skipOnProblem(stats, read) {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof CacheEntryProblem)) throw error;
    countSkip(stats, error.reason);
    return undefined;
  }
}
