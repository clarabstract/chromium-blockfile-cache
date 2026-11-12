// BlockFileHeader, from Chromium's net/disk_cache/blockfile/disk_format_base.h.
//
//   @0  uint32 magic        @16 int32 num_entries
//   @4  uint32 version      @20 int32 max_entries
//   @8  int16  this_file    @24 int32 empty[4]
//   @10 int16  next_file    @40 int32 hints[4]
//   @12 int32  entry_size   @56 int32 updating
//                           @80 uint32 allocation_map[]  one bit per block
//
// The header is 8192 bytes; block n starts at 8192 + n * entry_size.

export const BLOCK_FILE_MAGIC = 0xc104cac3;
export const BLOCK_FILE_HEADER_SIZE = 8192;
const ALLOCATION_MAP_OFFSET = 80;
export const MAX_BLOCKS = (BLOCK_FILE_HEADER_SIZE - ALLOCATION_MAP_OFFSET) * 8;

export function parseBlockFileHeader(bytes) {
  if (bytes.length < BLOCK_FILE_HEADER_SIZE) {
    throw new Error(`block file is ${bytes.length} bytes, shorter than its ${BLOCK_FILE_HEADER_SIZE}-byte header`);
  }
  const magic = bytes.readUInt32LE(0);
  if (magic !== BLOCK_FILE_MAGIC) {
    throw new Error(`block file magic is 0x${magic.toString(16)}, expected 0x${BLOCK_FILE_MAGIC.toString(16)}`);
  }
  const entrySize = bytes.readInt32LE(12);
  if (entrySize <= 0) throw new Error(`block file entry_size is ${entrySize}`);
  return {
    version: bytes.readUInt32LE(4),
    thisFile: bytes.readInt16LE(8),
    nextFile: bytes.readInt16LE(10),
    entrySize,
    numEntries: bytes.readInt32LE(16),
    maxEntries: bytes.readInt32LE(20),
    updating: bytes.readInt32LE(56),
  };
}

export function blockOffset(entrySize, block) {
  return BLOCK_FILE_HEADER_SIZE + block * entrySize;
}

/** Whether every block in [startBlock, startBlock + numBlocks) is marked used. */
export function areBlocksAllocated(bytes, startBlock, numBlocks) {
  for (let block = startBlock; block < startBlock + numBlocks; block++) {
    if (block >= MAX_BLOCKS) return false;
    const word = bytes.readUInt32LE(ALLOCATION_MAP_OFFSET + (block >>> 5) * 4);
    if (((word >>> (block & 31)) & 1) === 0) return false;
  }
  return true;
}

export function markBlocksAllocated(bytes, startBlock, numBlocks) {
  for (let block = startBlock; block < startBlock + numBlocks; block++) {
    const at = ALLOCATION_MAP_OFFSET + (block >>> 5) * 4;
    bytes.writeUInt32LE((bytes.readUInt32LE(at) | (1 << (block & 31))) >>> 0, at);
  }
}
