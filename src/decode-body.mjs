import zlib from 'node:zlib';
import { CacheEntryProblem } from './cache-entry-problem.mjs';

// The HTTP cache stores bodies as they came off the wire, so they are still
// content-encoded. zstd needs a Node with zlib.zstdDecompressSync (22.15+).

function inflateEitherWay(bytes) {
  try {
    return zlib.inflateSync(bytes);
  } catch {
    return zlib.inflateRawSync(bytes); // Some servers send raw deflate.
  }
}

const DECODERS = {
  identity: (bytes) => bytes,
  gzip: (bytes) => zlib.gunzipSync(bytes),
  'x-gzip': (bytes) => zlib.gunzipSync(bytes),
  deflate: inflateEitherWay,
  br: (bytes) => zlib.brotliDecompressSync(bytes),
  ...(typeof zlib.zstdDecompressSync === 'function' ? { zstd: (bytes) => zlib.zstdDecompressSync(bytes) } : {}),
};

export const SUPPORTED_CONTENT_ENCODINGS = Object.freeze(Object.keys(DECODERS));

/**
 * Undoes a Content-Encoding header value such as "br" or "gzip, br".
 * Throws CacheEntryProblem with 'unsupported-encoding' or 'decode-failed'.
 */
export function decodeBody(bytes, contentEncoding) {
  const codings = String(contentEncoding ?? '')
    .split(',')
    .map((coding) => coding.trim().toLowerCase())
    .filter(Boolean)
    .reverse();
  let decoded = bytes;
  for (const coding of codings) {
    const decode = DECODERS[coding];
    if (!decode) throw new CacheEntryProblem('unsupported-encoding', coding);
    try {
      decoded = decode(decoded);
    } catch (error) {
      throw new CacheEntryProblem('decode-failed', `${coding}: ${error.code ?? error.message}`);
    }
  }
  return decoded;
}
