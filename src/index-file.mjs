// The `index` file, from Chromium's net/disk_cache/blockfile/disk_format.h:
// a 368-byte IndexHeader, then a hash table of CacheAddr, one per bucket.
// Each bucket heads a chain of entries linked through EntryStore.next.
//
//   @0 uint32 magic      @16 int32 last_file   @28 int32 table_len (0 = 0x10000)
//   @4 uint32 version    @20 int32 this_id     @40 uint64 create_time
//   @8 int32 num_entries @24 CacheAddr stats

export const INDEX_MAGIC = 0xc103cac3;
export const INDEX_HEADER_SIZE = 368;
export const DEFAULT_TABLE_LENGTH = 0x10000;

export function parseIndexHeader(bytes) {
  if (bytes.length < INDEX_HEADER_SIZE) {
    throw new Error(`index file is ${bytes.length} bytes, shorter than its ${INDEX_HEADER_SIZE}-byte header`);
  }
  const magic = bytes.readUInt32LE(0);
  if (magic !== INDEX_MAGIC) {
    throw new Error(`index magic is 0x${magic.toString(16)}, expected 0x${INDEX_MAGIC.toString(16)}`);
  }
  const tableLength = bytes.readInt32LE(28) || DEFAULT_TABLE_LENGTH;
  if (tableLength < 0 || (tableLength & (tableLength - 1)) !== 0) {
    throw new Error(`index table_len ${tableLength} is not a power of two`);
  }
  if (bytes.length < INDEX_HEADER_SIZE + tableLength * 4) {
    throw new Error(`index file is too short for a table of ${tableLength} buckets`);
  }
  return {
    version: bytes.readUInt32LE(4),
    numEntries: bytes.readInt32LE(8),
    lastFile: bytes.readInt32LE(16),
    tableLength,
    createTime: bytes.readBigUInt64LE(40),
  };
}

/** The non-empty buckets, as [{ bucket, address }]. */
export function listBucketHeads(bytes, header) {
  const heads = [];
  for (let bucket = 0; bucket < header.tableLength; bucket++) {
    const address = bytes.readUInt32LE(INDEX_HEADER_SIZE + bucket * 4);
    if (address !== 0) heads.push({ bucket, address });
  }
  return heads;
}
