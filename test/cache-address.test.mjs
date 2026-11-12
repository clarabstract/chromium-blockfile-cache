import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FILE_TYPE,
  decodeCacheAddress,
  encodeBlockAddress,
  encodeExternalAddress,
  externalFileName,
  isUsableAddress,
} from '../src/index.mjs';

test('a block address carries file number, block count and first block', () => {
  // 1 010 00 01 00000010 0000000000000111
  const decoded = decodeCacheAddress(0xa1020007);
  assert.deepEqual(decoded, {
    value: 0xa1020007,
    initialized: true,
    fileType: FILE_TYPE.BLOCK_256,
    external: false,
    fileNumber: 2,
    numBlocks: 2,
    startBlock: 7,
    reservedBits: 0,
  });
  assert.equal(isUsableAddress(decoded), true);
});

test('four blocks is the most an address can cover', () => {
  assert.equal(decodeCacheAddress(0xb3030000).numBlocks, 4);
  assert.equal(decodeCacheAddress(0xb3030000).fileType, FILE_TYPE.BLOCK_1K);
});

test('an external address names an f_ file by its low 28 bits in hex', () => {
  const decoded = decodeCacheAddress(0x8000a1b2);
  assert.equal(decoded.external, true);
  assert.equal(decoded.fileNumber, 0xa1b2);
  assert.equal(externalFileName(decoded.fileNumber), 'f_00a1b2');
  assert.equal(isUsableAddress(decoded), true);
});

test('uninitialized, reserved-bit and non-storage addresses are unusable', () => {
  assert.equal(isUsableAddress(decodeCacheAddress(0)), false);
  assert.equal(isUsableAddress(decodeCacheAddress(0x20010000)), false, 'bit 31 clear');
  assert.equal(isUsableAddress(decodeCacheAddress(0xa4010000)), false, 'reserved bit 26 set');
  assert.equal(isUsableAddress(decodeCacheAddress(0xd0010000)), false, 'file type 5');
});

test('encoding and decoding round-trip', () => {
  const fields = { fileType: FILE_TYPE.BLOCK_4K, fileNumber: 3, numBlocks: 3, startBlock: 0xfffe };
  const decoded = decodeCacheAddress(encodeBlockAddress(fields));
  assert.deepEqual(
    { fileType: decoded.fileType, fileNumber: decoded.fileNumber, numBlocks: decoded.numBlocks, startBlock: decoded.startBlock },
    fields,
  );
  assert.equal(decodeCacheAddress(encodeExternalAddress(0xfffffff)).fileNumber, 0xfffffff);
});
