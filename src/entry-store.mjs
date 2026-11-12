// EntryStore, from Chromium's net/disk_cache/blockfile/disk_format.h.
// One to four 256-byte blocks in a BLOCK_256 file (data_1).
//
//   @0  uint32 hash           @32 int32 key_len
//   @4  CacheAddr next        @36 CacheAddr long_key  (0 = key is inline)
//   @8  CacheAddr rankings    @40 int32 data_size[4]
//   @12 int32 reuse_count     @56 CacheAddr data_addr[4]
//   @16 int32 refetch_count   @72 uint32 flags
//   @20 int32 state           @92 uint32 self_hash  (hash of bytes 0-91, 0 = unset)
//   @24 uint64 creation_time  @96 char key[]  (inline, NUL-terminated)

export const ENTRY_STORE_SIZE = 256;
export const ENTRY_KEY_OFFSET = 96;
export const ENTRY_SELF_HASH_OFFSET = 92;
export const STREAM_COUNT = 4;

export const ENTRY_STATE = Object.freeze({ NORMAL: 0, EVICTED: 1, DOOMED: 2 });

/** Microseconds between 1601-01-01 (base::Time's epoch) and 1970-01-01. */
const WINDOWS_TO_UNIX_EPOCH_US = 11644473600000000n;

export function parseEntryStore(bytes) {
  const dataSizes = [];
  const dataAddresses = [];
  for (let stream = 0; stream < STREAM_COUNT; stream++) {
    dataSizes.push(bytes.readInt32LE(40 + stream * 4));
    dataAddresses.push(bytes.readUInt32LE(56 + stream * 4));
  }
  return {
    hash: bytes.readUInt32LE(0),
    next: bytes.readUInt32LE(4),
    rankingsNode: bytes.readUInt32LE(8),
    reuseCount: bytes.readInt32LE(12),
    refetchCount: bytes.readInt32LE(16),
    state: bytes.readInt32LE(20),
    creationTime: bytes.readBigUInt64LE(24),
    keyLength: bytes.readInt32LE(32),
    longKey: bytes.readUInt32LE(36),
    dataSizes,
    dataAddresses,
    flags: bytes.readUInt32LE(72),
    selfHash: bytes.readUInt32LE(ENTRY_SELF_HASH_OFFSET),
  };
}

/** base::Time's internal value (µs since 1601) as a Date, or null when unset. */
export function baseTimeToDate(microseconds) {
  if (microseconds === 0n) return null;
  return new Date(Number((microseconds - WINDOWS_TO_UNIX_EPOCH_US) / 1000n));
}

export function dateToBaseTime(date) {
  return BigInt(date.getTime()) * 1000n + WINDOWS_TO_UNIX_EPOCH_US;
}
