// Builds small blockfile caches byte by byte, for tests. Every field is
// written from the format notes, not from the reader's own parsing code.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BLOCK_FILE_HEADER_SIZE, BLOCK_FILE_MAGIC, blockOffset, markBlocksAllocated } from '../src/block-file-header.mjs';
import { FILE_TYPE, decodeCacheAddress, encodeBlockAddress, encodeExternalAddress, externalFileName } from '../src/cache-address.mjs';
import { ENTRY_KEY_OFFSET, ENTRY_SELF_HASH_OFFSET, ENTRY_STORE_SIZE, dateToBaseTime } from '../src/entry-store.mjs';
import { INDEX_HEADER_SIZE, INDEX_MAGIC } from '../src/index-file.mjs';
import { superFastHash } from '../src/super-fast-hash.mjs';

const FILE_TYPE_BY_NUMBER = [FILE_TYPE.RANKINGS, FILE_TYPE.BLOCK_256, FILE_TYPE.BLOCK_1K, FILE_TYPE.BLOCK_4K];
const BLOCKS_PER_FILE = 64;
const MAX_INLINE_KEY = 4 * ENTRY_STORE_SIZE - ENTRY_KEY_OFFSET - 1;

export const DEFAULT_CREATION_TIME = new Date('2026-01-02T03:04:05.678Z');

export class SyntheticCache {
  constructor({ tableLength = 16, entrySizes = [36, 256, 1024, 4096] } = {}) {
    this.tableLength = tableLength;
    this.table = new Array(tableLength).fill(0);
    this.blockFiles = entrySizes.map((entrySize, fileNumber) => {
      const bytes = Buffer.alloc(BLOCK_FILE_HEADER_SIZE + BLOCKS_PER_FILE * entrySize);
      bytes.writeUInt32LE(BLOCK_FILE_MAGIC, 0);
      bytes.writeUInt32LE(0x30000, 4);
      bytes.writeInt16LE(fileNumber, 8);
      bytes.writeInt32LE(entrySize, 12);
      bytes.writeInt32LE(BLOCKS_PER_FILE, 20);
      return { bytes, entrySize, nextBlock: 0 };
    });
    this.externals = new Map();
    this.nextExternal = 1;
    this.entryCount = 0;
  }

  allocateBlocks(fileNumber, numBlocks) {
    const file = this.blockFiles[fileNumber];
    if ((file.nextBlock % 4) + numBlocks > 4) file.nextBlock = Math.ceil(file.nextBlock / 4) * 4;
    const startBlock = file.nextBlock;
    file.nextBlock += numBlocks;
    markBlocksAllocated(file.bytes, startBlock, numBlocks);
    file.bytes.writeInt32LE(file.bytes.readInt32LE(16) + 1, 16);
    const fileType = FILE_TYPE_BY_NUMBER[fileNumber];
    return encodeBlockAddress({ fileType, fileNumber, numBlocks, startBlock });
  }

  /** The bytes an address covers, writable, for planting corruption. */
  bytesAt(address) {
    const decoded = decodeCacheAddress(address);
    if (decoded.external) return this.externals.get(decoded.fileNumber);
    const file = this.blockFiles[decoded.fileNumber];
    const start = blockOffset(file.entrySize, decoded.startBlock);
    return file.bytes.subarray(start, start + decoded.numBlocks * file.entrySize);
  }

  /** Stores data in the smallest block file it fits in, or in an f_ file. */
  writeData(data, { external = false } = {}) {
    if (data.length === 0) return 0;
    if (!external) {
      for (const fileNumber of [1, 2, 3]) {
        const { entrySize } = this.blockFiles[fileNumber];
        if (data.length <= entrySize * 4) {
          const address = this.allocateBlocks(fileNumber, Math.ceil(data.length / entrySize));
          data.copy(this.bytesAt(address));
          return address;
        }
      }
    }
    const fileNumber = this.nextExternal++;
    this.externals.set(fileNumber, Buffer.from(data));
    return encodeExternalAddress(fileNumber);
  }

  /** Adds an entry; `streams` are Buffers (stream 0 = response info, 1 = body). */
  addEntry({ key, streams = [], externalStreams = [], creationTime = DEFAULT_CREATION_TIME, state = 0 }) {
    const keyBytes = Buffer.from(key, 'utf8');
    const inline = keyBytes.length <= MAX_INLINE_KEY;
    const numBlocks = inline ? Math.ceil((ENTRY_KEY_OFFSET + keyBytes.length + 1) / ENTRY_STORE_SIZE) : 1;
    const address = this.allocateBlocks(1, numBlocks);
    const store = this.bytesAt(address);
    const hash = superFastHash(keyBytes);
    const bucket = hash & (this.tableLength - 1);

    store.writeUInt32LE(hash, 0);
    store.writeUInt32LE(this.table[bucket], 4);
    store.writeInt32LE(state, 20);
    store.writeBigUInt64LE(dateToBaseTime(creationTime), 24);
    store.writeInt32LE(keyBytes.length, 32);
    if (inline) keyBytes.copy(store, ENTRY_KEY_OFFSET);
    else store.writeUInt32LE(this.writeData(Buffer.concat([keyBytes, Buffer.from([0])])), 36);
    for (let stream = 0; stream < 4; stream++) {
      const data = streams[stream] ?? Buffer.alloc(0);
      store.writeInt32LE(data.length, 40 + stream * 4);
      store.writeUInt32LE(this.writeData(data, { external: externalStreams.includes(stream) }), 56 + stream * 4);
    }
    this.seal(address);

    this.table[bucket] = address;
    this.entryCount++;
    return { address, bucket, store };
  }

  /** Recomputes an entry's self_hash after a test edits its fields. */
  seal(address) {
    const store = this.bytesAt(address);
    store.writeUInt32LE(superFastHash(store.subarray(0, ENTRY_SELF_HASH_OFFSET)), ENTRY_SELF_HASH_OFFSET);
  }

  writeTo(dir) {
    const index = Buffer.alloc(INDEX_HEADER_SIZE + this.tableLength * 4);
    index.writeUInt32LE(INDEX_MAGIC, 0);
    index.writeUInt32LE(0x30000, 4);
    index.writeInt32LE(this.entryCount, 8);
    index.writeInt32LE(this.nextExternal - 1, 16);
    index.writeInt32LE(this.tableLength, 28);
    this.table.forEach((address, bucket) => index.writeUInt32LE(address, INDEX_HEADER_SIZE + bucket * 4));
    fs.writeFileSync(path.join(dir, 'index'), index);
    this.blockFiles.forEach((file, fileNumber) => fs.writeFileSync(path.join(dir, `data_${fileNumber}`), file.bytes));
    for (const [fileNumber, data] of this.externals) fs.writeFileSync(path.join(dir, externalFileName(fileNumber)), data);
    return dir;
  }
}

/** Stream 0 as Chromium pickles HttpResponseInfo: payload size, flags, times, headers string. */
export function pickleResponseInfo(statusLine, headers = []) {
  const raw = Buffer.from(`${statusLine}\0${headers.map(([name, value]) => `${name}: ${value}\0`).join('')}\0`, 'latin1');
  const padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4);
  raw.copy(padded);
  const fields = Buffer.alloc(4 + 8 + 8 + 4);
  fields.writeInt32LE(3, 0); // flags: RESPONSE_INFO_VERSION
  fields.writeBigInt64LE(13400000000000000n, 4); // request_time
  fields.writeBigInt64LE(13400000000500000n, 12); // response_time
  fields.writeInt32LE(raw.length, 20);
  const payload = Buffer.concat([fields, padded]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length, 0);
  return Buffer.concat([size, payload]);
}

export function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockfile-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
