import { CacheEntryProblem, skipOnProblem } from './cache-entry-problem.mjs';
import { decodeBody } from './decode-body.mjs';
import { parseHttpResponseInfo } from './http-response-info.mjs';
import { loadBlockFiles } from './load-block-files.mjs';
import { createAddressReader } from './read-cache-address.mjs';
import { walkEntries } from './walk-entries.mjs';

const RESPONSE_INFO_STREAM = 0;
const BODY_STREAM = 1;
/** Bigger streams than this are taken as a torn data_size. */
const MAX_STREAM_SIZE = 512 * 1024 * 1024;

/**
 * Opens a Chromium blockfile disk cache.
 *
 * `blockDir` holds `index` and `data_N` (they are read into memory now);
 * `externalDir` holds the `f_XXXXXX` files (read on demand). They are the
 * same folder unless the block files are a copy taken elsewhere.
 *
 * Throws only when `blockDir` isn't a readable blockfile cache. After that,
 * torn or stale entries are skipped and counted, never thrown.
 */
export function openBlockfileCache({ blockDir, externalDir = blockDir, verifyHashes = true }) {
  const { index, blockFiles } = loadBlockFiles(blockDir);
  const reader = createAddressReader({ blockFiles, externalDir });

  function readStreamBytes(entry, stream) {
    const { size, address } = entry.streams[stream] ?? {};
    if (size === undefined) throw new RangeError(`stream ${stream} does not exist`);
    if (size === 0) return Buffer.alloc(0);
    if (size < 0 || size > MAX_STREAM_SIZE) throw new CacheEntryProblem('out-of-range', `stream size ${size}`);
    return reader.read(address, size);
  }

  function readResponseOrThrow(entry) {
    const info = parseHttpResponseInfo(readStreamBytes(entry, RESPONSE_INFO_STREAM));
    if (!info) throw new CacheEntryProblem('no-response-headers');
    const body = decodeBody(readStreamBytes(entry, BODY_STREAM), info.headers['content-encoding']);
    return { status: info.status, statusText: info.statusText, headers: info.headers, body };
  }

  function asResult(read) {
    try {
      return { ok: true, ...read() };
    } catch (error) {
      if (!(error instanceof CacheEntryProblem)) throw error;
      return { ok: false, reason: error.reason };
    }
  }

  return {
    indexHeader: index.header,

    /** Entries whose key matches `keyPattern` (RegExp, substring or predicate): { entries, stats }. */
    listEntries({ keyPattern } = {}) {
      return walkEntries({ index, reader, keyPattern, verifyHashes });
    },

    /** The raw bytes of one stream: { ok: true, bytes } or { ok: false, reason }. */
    readStream(entry, stream) {
      return asResult(() => ({ bytes: readStreamBytes(entry, stream) }));
    },

    /** { ok: true, status, statusText, headers, body } or { ok: false, reason }. */
    readResponse(entry) {
      return asResult(() => readResponseOrThrow(entry));
    },

    /** Every matching entry's response, decoded: { responses: [{ entry, ...response }], stats }. */
    readResponses({ keyPattern } = {}) {
      const { entries, stats } = walkEntries({ index, reader, keyPattern, verifyHashes });
      const responses = [];
      for (const entry of entries) {
        const response = skipOnProblem(stats, () => readResponseOrThrow(entry));
        if (response) responses.push({ entry, ...response });
      }
      stats.responses = responses.length;
      return { responses, stats };
    },
  };
}
