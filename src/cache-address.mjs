// CacheAddr, from Chromium's net/disk_cache/blockfile/addr.h.
//
//   bit 31      initialized
//   bits 28-30  file type (0 = external f_XXXXXX file)
//   external:   bits 0-27  file number, the XXXXXX in f_XXXXXX
//   block file: bits 26-27 reserved (must be 0)
//               bits 24-25 number of blocks - 1
//               bits 16-23 block file number, the N in data_N
//               bits 0-15  first block

export const FILE_TYPE = Object.freeze({
  EXTERNAL: 0,
  RANKINGS: 1,
  BLOCK_256: 2,
  BLOCK_1K: 3,
  BLOCK_4K: 4,
  BLOCK_FILES: 5,
  BLOCK_ENTRIES: 6,
  BLOCK_EVICTED: 7,
});

/** The highest file type a stored address may carry (Chromium's Addr::SanityCheck). */
const LAST_STORED_FILE_TYPE = FILE_TYPE.BLOCK_4K;

export function decodeCacheAddress(value) {
  const address = value >>> 0;
  const initialized = (address & 0x80000000) !== 0;
  const fileType = (address >>> 28) & 0x7;
  if (fileType === FILE_TYPE.EXTERNAL) {
    return { value: address, initialized, fileType, external: true, fileNumber: address & 0x0fffffff };
  }
  return {
    value: address,
    initialized,
    fileType,
    external: false,
    fileNumber: (address >>> 16) & 0xff,
    numBlocks: ((address >>> 24) & 0x3) + 1,
    startBlock: address & 0xffff,
    reservedBits: (address >>> 26) & 0x3,
  };
}

/** Whether a decoded address can point at stored data at all. */
export function isUsableAddress(decoded) {
  if (!decoded.initialized) return false;
  if (decoded.external) return true;
  return decoded.fileType <= LAST_STORED_FILE_TYPE && decoded.reservedBits === 0;
}

export function externalFileName(fileNumber) {
  return `f_${fileNumber.toString(16).padStart(6, '0')}`;
}

export function blockFileName(fileNumber) {
  return `data_${fileNumber}`;
}

export function encodeExternalAddress(fileNumber) {
  return (0x80000000 | (fileNumber & 0x0fffffff)) >>> 0;
}

export function encodeBlockAddress({ fileType, fileNumber, numBlocks, startBlock }) {
  return (
    (0x80000000 |
      ((fileType & 0x7) << 28) |
      (((numBlocks - 1) & 0x3) << 24) |
      ((fileNumber & 0xff) << 16) |
      (startBlock & 0xffff)) >>>
    0
  );
}
