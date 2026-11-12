import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCK_FILE_HEADER_SIZE,
  BLOCK_FILE_MAGIC,
  INDEX_HEADER_SIZE,
  INDEX_MAGIC,
  areBlocksAllocated,
  listBucketHeads,
  parseBlockFileHeader,
  parseIndexHeader,
} from '../src/index.mjs';

function blockFileHeader({ entrySize, magic = BLOCK_FILE_MAGIC }) {
  const bytes = Buffer.alloc(BLOCK_FILE_HEADER_SIZE);
  bytes.writeUInt32LE(magic, 0);
  bytes.writeUInt32LE(0x30000, 4);
  bytes.writeInt16LE(2, 8);
  bytes.writeInt16LE(5, 10);
  bytes.writeInt32LE(entrySize, 12);
  bytes.writeInt32LE(7, 16);
  bytes.writeInt32LE(1024, 20);
  return bytes;
}

test('the block size comes from the header, whatever the file number', () => {
  const header = parseBlockFileHeader(blockFileHeader({ entrySize: 1000 }));
  assert.equal(header.entrySize, 1000);
  assert.equal(header.thisFile, 2);
  assert.equal(header.nextFile, 5);
  assert.equal(header.numEntries, 7);
  assert.equal(header.maxEntries, 1024);
});

test('a block file with the wrong magic or a short header is rejected', () => {
  assert.throws(() => parseBlockFileHeader(blockFileHeader({ entrySize: 256, magic: 0x12345678 })), /magic/);
  assert.throws(() => parseBlockFileHeader(Buffer.alloc(100)), /shorter/);
  assert.throws(() => parseBlockFileHeader(blockFileHeader({ entrySize: 0 })), /entry_size/);
});

test('the allocation map has one bit per block, low bit first', () => {
  const bytes = blockFileHeader({ entrySize: 256 });
  bytes.writeUInt32LE(0b1110, 80); // blocks 1-3
  bytes.writeUInt32LE(0x1, 84); // block 32
  assert.equal(areBlocksAllocated(bytes, 0, 1), false);
  assert.equal(areBlocksAllocated(bytes, 1, 3), true);
  assert.equal(areBlocksAllocated(bytes, 2, 3), false);
  assert.equal(areBlocksAllocated(bytes, 32, 1), true);
});

test('the index header gives the table length; 0 means 0x10000', () => {
  const bytes = Buffer.alloc(INDEX_HEADER_SIZE + 8 * 4);
  bytes.writeUInt32LE(INDEX_MAGIC, 0);
  bytes.writeUInt32LE(0x30000, 4);
  bytes.writeInt32LE(2, 8);
  bytes.writeInt32LE(8, 28);
  bytes.writeUInt32LE(0xa0010000, INDEX_HEADER_SIZE + 3 * 4);
  const header = parseIndexHeader(bytes);
  assert.equal(header.tableLength, 8);
  assert.equal(header.numEntries, 2);
  assert.deepEqual(listBucketHeads(bytes, header), [{ bucket: 3, address: 0xa0010000 }]);

  bytes.writeInt32LE(0, 28);
  assert.throws(() => parseIndexHeader(bytes), /too short/);
  bytes.writeInt32LE(6, 28);
  assert.throws(() => parseIndexHeader(bytes), /power of two/);
});
