import fs from 'node:fs';
import path from 'node:path';
import { areBlocksAllocated, blockOffset } from './block-file-header.mjs';
import { decodeCacheAddress, externalFileName, isUsableAddress } from './cache-address.mjs';
import { CacheEntryProblem } from './cache-entry-problem.mjs';

/**
 * Reads the bytes a CacheAddr points at: from the in-memory block files, or
 * from an f_XXXXXX file in `externalDir`. Problems throw CacheEntryProblem.
 *
 * External files are opened read-only and closed straight away. libuv opens
 * files with FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, so the
 * browser can still delete or rewrite them while one is open.
 */
export function createAddressReader({ blockFiles, externalDir }) {
  function blockRange(address, length) {
    const decoded = decodeCacheAddress(address);
    if (!isUsableAddress(decoded) || decoded.external) {
      throw new CacheEntryProblem('bad-address', `0x${decoded.value.toString(16)}`);
    }
    const file = blockFiles.get(decoded.fileNumber);
    if (!file) throw new CacheEntryProblem('missing-file', `data_${decoded.fileNumber}`);
    const capacity = decoded.numBlocks * file.header.entrySize;
    const wanted = length ?? capacity;
    if (wanted < 0 || wanted > capacity) {
      throw new CacheEntryProblem('out-of-range', `${wanted} bytes in ${decoded.numBlocks} blocks`);
    }
    const start = blockOffset(file.header.entrySize, decoded.startBlock);
    if (start + capacity > file.bytes.length) {
      throw new CacheEntryProblem('out-of-range', `${file.name} block ${decoded.startBlock}`);
    }
    if (!areBlocksAllocated(file.bytes, decoded.startBlock, decoded.numBlocks)) {
      throw new CacheEntryProblem('unallocated-block', `${file.name} block ${decoded.startBlock}`);
    }
    return { decoded, file, start, length: wanted };
  }

  function readExternal(decoded, length) {
    const name = externalFileName(decoded.fileNumber);
    let fd;
    try {
      fd = fs.openSync(path.join(externalDir, name), 'r');
    } catch (error) {
      if (error.code === 'ENOENT') throw new CacheEntryProblem('missing-file', name);
      throw error;
    }
    try {
      const { size } = fs.fstatSync(fd);
      if (length < 0 || length > size) throw new CacheEntryProblem('out-of-range', `${length} bytes in ${name}`);
      const bytes = Buffer.alloc(length);
      let done = 0;
      while (done < length) {
        const read = fs.readSync(fd, bytes, done, length - done, done);
        if (read === 0) throw new CacheEntryProblem('out-of-range', `${name} ended early`);
        done += read;
      }
      return bytes;
    } finally {
      fs.closeSync(fd);
    }
  }

  return {
    /** All the blocks an address covers, with its decoded form. */
    readBlocks(address) {
      const range = blockRange(address);
      return { decoded: range.decoded, bytes: range.file.bytes.subarray(range.start, range.start + range.length) };
    },

    /** `length` bytes from the start of whatever the address points at. */
    read(address, length) {
      const decoded = decodeCacheAddress(address);
      if (!isUsableAddress(decoded)) throw new CacheEntryProblem('bad-address', `0x${decoded.value.toString(16)}`);
      if (decoded.external) return readExternal(decoded, length);
      const range = blockRange(address, length);
      return Buffer.from(range.file.bytes.subarray(range.start, range.start + range.length));
    },
  };
}
