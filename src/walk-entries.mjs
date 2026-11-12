import { FILE_TYPE } from './cache-address.mjs';
import { CacheEntryProblem, countSkip, createSkipStats, skipOnProblem } from './cache-entry-problem.mjs';
import {
  ENTRY_KEY_OFFSET,
  ENTRY_SELF_HASH_OFFSET,
  ENTRY_STATE,
  baseTimeToDate,
  parseEntryStore,
} from './entry-store.mjs';
import { listBucketHeads } from './index-file.mjs';
import { superFastHash } from './super-fast-hash.mjs';

/** Longer keys than this are taken as a torn key_len. */
export const MAX_KEY_LENGTH = 256 * 1024;

/**
 * Walks every bucket chain in the index and returns the entries that read
 * cleanly. Torn or stale entries are counted in `stats.skipped`.
 */
export function walkEntries({ index, reader, keyPattern, verifyHashes = true }) {
  const stats = createSkipStats();
  const entries = [];
  const mask = index.header.tableLength - 1;
  const matches = keyMatcher(keyPattern);

  for (const head of listBucketHeads(index.bytes, index.header)) {
    const seen = new Set();
    let address = head.address;
    while (address !== 0) {
      if (seen.has(address)) {
        countSkip(stats, 'chain-loop');
        break;
      }
      seen.add(address);
      stats.walked++;

      const store = skipOnProblem(stats, () => readEntryStore(reader, address, verifyHashes));
      if (!store) break; // An unreadable block can't be trusted for `next` either.

      const entry = skipOnProblem(stats, () => toEntry({ reader, address, store, bucket: head.bucket, mask, verifyHashes }));
      if (entry && matches(entry.key)) {
        entries.push(entry);
        stats.listed++;
      }
      address = store.next;
    }
  }
  return { entries, stats };
}

function readEntryStore(reader, address, verifyHashes) {
  const { decoded, bytes } = reader.readBlocks(address);
  if (decoded.fileType !== FILE_TYPE.BLOCK_256) {
    throw new CacheEntryProblem('bad-address', `entry in file type ${decoded.fileType}`);
  }
  const store = parseEntryStore(bytes);
  if (verifyHashes && store.selfHash !== 0) {
    const computed = superFastHash(bytes.subarray(0, ENTRY_SELF_HASH_OFFSET));
    if (computed !== store.selfHash) throw new CacheEntryProblem('hash-mismatch', 'entry self_hash');
  }
  store.blockBytes = bytes;
  return store;
}

function toEntry({ reader, address, store, bucket, mask, verifyHashes }) {
  if (store.state !== ENTRY_STATE.NORMAL) throw new CacheEntryProblem('inactive-state', `state ${store.state}`);
  if (verifyHashes && (store.hash & mask) !== bucket) throw new CacheEntryProblem('hash-mismatch', 'wrong bucket');

  const keyBytes = readKeyBytes(reader, store);
  if (verifyHashes && superFastHash(keyBytes) !== store.hash) throw new CacheEntryProblem('hash-mismatch', 'key hash');
  if (keyBytes.includes(0)) throw new CacheEntryProblem('implausible-key-length', 'NUL inside key');

  return {
    key: keyBytes.toString('utf8'),
    address,
    hash: store.hash,
    creationTime: baseTimeToDate(store.creationTime),
    streams: store.dataSizes.map((size, stream) => ({ size, address: store.dataAddresses[stream] })),
  };
}

function readKeyBytes(reader, store) {
  const { keyLength, longKey, blockBytes } = store;
  if (keyLength <= 0 || keyLength > MAX_KEY_LENGTH) {
    throw new CacheEntryProblem('implausible-key-length', String(keyLength));
  }
  if (longKey !== 0) return reader.read(longKey, keyLength);
  // Inline keys are NUL-terminated inside the entry's own blocks.
  if (ENTRY_KEY_OFFSET + keyLength >= blockBytes.length) {
    throw new CacheEntryProblem('implausible-key-length', `${keyLength} bytes inline`);
  }
  return blockBytes.subarray(ENTRY_KEY_OFFSET, ENTRY_KEY_OFFSET + keyLength);
}

function keyMatcher(keyPattern) {
  if (keyPattern === undefined || keyPattern === null) return () => true;
  if (typeof keyPattern === 'string') return (key) => key.includes(keyPattern);
  if (keyPattern instanceof RegExp) {
    return (key) => {
      keyPattern.lastIndex = 0;
      return keyPattern.test(key);
    };
  }
  if (typeof keyPattern === 'function') return keyPattern;
  throw new TypeError('keyPattern must be a RegExp, a string or a function');
}
