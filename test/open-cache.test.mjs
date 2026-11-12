import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import zlib from 'node:zlib';
import {
  FILE_TYPE,
  decodeCacheAddress,
  encodeBlockAddress,
  externalFileName,
  openBlockfileCache,
  urlFromCacheKey,
} from '../src/index.mjs';
import { DEFAULT_CREATION_TIME, SyntheticCache, makeTempDir, pickleResponseInfo } from './synthetic-cache.mjs';

const json = (value) => Buffer.from(JSON.stringify(value));
const jsonHeaders = (encoding) => [
  ['content-type', 'application/json'],
  ...(encoding ? [['content-encoding', encoding]] : []),
];

const KEYS = {
  gzip: '1/0/_dk_https://example.com https://example.com https://example.com/api/items',
  brExternal: `https://example.com/long/${'a'.repeat(300)}`,
  longKey: `https://example.com/longer/${'b'.repeat(2000)}`,
  rangeOnly: 'Range_https://example.com/video.mp4:0-99',
};

/** Four entries: gzip body in a block file, br body in an f_ file, a long key, no stream 0. */
function buildMixedCache(options) {
  const cache = new SyntheticCache(options);
  const gzip = cache.addEntry({
    key: KEYS.gzip,
    streams: [pickleResponseInfo('HTTP/1.1 200', jsonHeaders('gzip')), zlib.gzipSync(json({ id: 1 }))],
  });
  const br = cache.addEntry({
    key: KEYS.brExternal,
    streams: [pickleResponseInfo('HTTP/1.1 200', jsonHeaders('br')), zlib.brotliCompressSync(json({ id: 2 }))],
    externalStreams: [1],
    creationTime: new Date('2026-11-12T10:00:00.000Z'),
  });
  const longKey = cache.addEntry({
    key: KEYS.longKey,
    streams: [pickleResponseInfo('HTTP/1.1 404 Not Found', jsonHeaders()), json({ id: 3 })],
  });
  const rangeOnly = cache.addEntry({ key: KEYS.rangeOnly, streams: [Buffer.alloc(0), Buffer.alloc(100, 7)] });
  return { cache, added: { gzip, br, longKey, rangeOnly } };
}

function open(t, cache, options = {}) {
  return openBlockfileCache({ blockDir: cache.writeTo(makeTempDir(t)), ...options });
}

function byKey(entries) {
  return Object.fromEntries(entries.map((entry) => [entry.key, entry]));
}

test('lists every entry with its key, creation time and streams', (t) => {
  const { cache, added } = buildMixedCache();
  const { entries, stats } = open(t, cache).listEntries();
  assert.deepEqual(stats, { walked: 4, listed: 4, skipped: {} });

  const entry = byKey(entries)[KEYS.brExternal];
  assert.equal(entry.address, added.br.address);
  assert.deepEqual(entry.creationTime, new Date('2026-11-12T10:00:00.000Z'));
  assert.equal(entry.streams.length, 4);
  assert.equal(decodeCacheAddress(entry.streams[1].address).external, true);
  assert.equal(entry.streams[2].size, 0);
  assert.equal(entry.streams[2].address, 0);
  assert.deepEqual(byKey(entries)[KEYS.gzip].creationTime, DEFAULT_CREATION_TIME);
  assert.ok(byKey(entries)[KEYS.longKey], 'long key read through long_key');
});

test('reads and decodes responses from block files and f_ files', (t) => {
  const { cache } = buildMixedCache();
  const reader = open(t, cache);
  const { responses, stats } = reader.readResponses();
  assert.deepEqual(stats, { walked: 4, listed: 4, skipped: { 'no-response-headers': 1 }, responses: 3 });

  const found = Object.fromEntries(responses.map((response) => [response.entry.key, response]));
  assert.equal(found[KEYS.gzip].status, 200);
  assert.equal(found[KEYS.gzip].headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(found[KEYS.gzip].body), { id: 1 });
  assert.deepEqual(JSON.parse(found[KEYS.brExternal].body), { id: 2 });
  assert.equal(found[KEYS.longKey].status, 404);
  assert.equal(found[KEYS.longKey].statusText, 'Not Found');

  const rangeOnly = reader.listEntries({ keyPattern: 'Range_' }).entries[0];
  assert.deepEqual(reader.readResponse(rangeOnly), { ok: false, reason: 'no-response-headers' });
  const body = reader.readStream(rangeOnly, 1);
  assert.equal(body.ok, true);
  assert.deepEqual(body.bytes, Buffer.alloc(100, 7));
});

test('keyPattern takes a RegExp, a substring or a predicate', (t) => {
  const { cache } = buildMixedCache();
  const reader = open(t, cache);
  const keysFor = (keyPattern) => reader.listEntries({ keyPattern }).entries.map((entry) => entry.key).sort();
  assert.deepEqual(keysFor(/\/api\/items$/g), [KEYS.gzip]);
  assert.deepEqual(keysFor(/\/api\/items$/g), [KEYS.gzip], 'a global RegExp is reset between keys');
  assert.deepEqual(keysFor('/long/'), [KEYS.brExternal]);
  assert.deepEqual(keysFor((key) => key.length > 1000), [KEYS.longKey]);
  assert.equal(urlFromCacheKey(KEYS.gzip), 'https://example.com/api/items');
  assert.equal(urlFromCacheKey(KEYS.brExternal), KEYS.brExternal);
});

test('block sizes come from each file header, not from the address type', (t) => {
  const cache = new SyntheticCache({ entrySizes: [36, 256, 2048, 4096] });
  const body = Buffer.alloc(3000, 'x');
  const { store } = cache.addEntry({ key: 'https://example.com/big', streams: [pickleResponseInfo('HTTP/1.1 200'), body] });
  const bodyAddress = decodeCacheAddress(store.readUInt32LE(60));
  assert.equal(bodyAddress.fileNumber, 2);
  assert.equal(bodyAddress.numBlocks, 2, 'two 2048-byte blocks, where a 1K table would need three');

  const reader = open(t, cache);
  const [entry] = reader.listEntries().entries;
  assert.deepEqual(reader.readResponse(entry).body, body);
});

test('block files and f_ files can live in different folders', (t) => {
  const { cache } = buildMixedCache();
  const blockDir = cache.writeTo(makeTempDir(t));
  const externalDir = makeTempDir(t);
  for (const name of fs.readdirSync(blockDir).filter((file) => file.startsWith('f_'))) {
    fs.renameSync(path.join(blockDir, name), path.join(externalDir, name));
  }
  assert.equal(openBlockfileCache({ blockDir }).readResponses().stats.skipped['missing-file'], 1);
  assert.equal(openBlockfileCache({ blockDir, externalDir }).readResponses().stats.responses, 3);
});

test('opening a folder that is not a blockfile cache throws', (t) => {
  const dir = makeTempDir(t);
  assert.throws(() => openBlockfileCache({ blockDir: dir }), { code: 'ENOENT' });
  fs.writeFileSync(path.join(dir, 'index'), Buffer.alloc(400));
  assert.throws(() => openBlockfileCache({ blockDir: dir }), /index magic/);
});

// Torn and stale entries: each is skipped with a reason, and nothing throws.

function oneEntryCache(edit) {
  const cache = new SyntheticCache();
  const added = cache.addEntry({
    key: 'https://example.com/one',
    streams: [pickleResponseInfo('HTTP/1.1 200', jsonHeaders('gzip')), zlib.gzipSync(json({ id: 1 }))],
  });
  const external = cache.addEntry({
    key: 'https://example.com/two',
    streams: [pickleResponseInfo('HTTP/1.1 200'), Buffer.from('x')],
    externalStreams: [1],
  });
  edit(cache, added, external);
  return cache;
}

function listSkips(t, edit, options) {
  return open(t, oneEntryCache(edit), options).listEntries().stats;
}

function responseSkips(t, edit) {
  return open(t, oneEntryCache(edit)).readResponses().stats;
}

test('a key that does not match its stored hash is skipped', (t) => {
  const stats = listSkips(t, (cache, { store }) => {
    store[96] ^= 0x01;
  });
  assert.deepEqual(stats, { walked: 2, listed: 1, skipped: { 'hash-mismatch': 1 } });
});

test('an entry whose self_hash is stale is skipped, unless hashes are not checked', (t) => {
  const edit = (cache, { store }) => store.writeInt32LE(5, 12); // reuse_count, without resealing
  assert.deepEqual(listSkips(t, edit).skipped, { 'hash-mismatch': 1 });
  assert.deepEqual(listSkips(t, edit, { verifyHashes: false }), { walked: 2, listed: 2, skipped: {} });
});

test('an entry filed under the wrong bucket is skipped', (t) => {
  const stats = listSkips(t, (cache, { address, bucket }) => {
    cache.table[bucket] = 0;
    cache.table[(bucket + 1) % cache.tableLength] = address;
  });
  assert.equal(stats.skipped['hash-mismatch'], 1);
});

test('an entry in freed blocks is skipped', (t) => {
  const stats = listSkips(t, (cache, { address }) => {
    const { startBlock } = decodeCacheAddress(address);
    const data1 = cache.blockFiles[1].bytes;
    const at = 80 + (startBlock >>> 5) * 4;
    data1.writeUInt32LE((data1.readUInt32LE(at) & ~(1 << (startBlock & 31))) >>> 0, at);
  });
  assert.equal(stats.skipped['unallocated-block'], 1);
});

test('a bucket pointing at a missing block file or past its end is skipped', (t) => {
  const missing = listSkips(t, (cache) => {
    cache.table[0] = encodeBlockAddress({ fileType: FILE_TYPE.BLOCK_256, fileNumber: 7, numBlocks: 1, startBlock: 0 });
  });
  assert.equal(missing.skipped['missing-file'], 1);
  const pastEnd = listSkips(t, (cache) => {
    cache.table[0] = encodeBlockAddress({ fileType: FILE_TYPE.BLOCK_256, fileNumber: 1, numBlocks: 1, startBlock: 0xffff });
  });
  assert.equal(pastEnd.skipped['out-of-range'], 1);
});

test('a chain that loops back on itself stops', (t) => {
  const stats = listSkips(t, (cache, { address, store }) => {
    store.writeUInt32LE(address, 4);
    cache.seal(address);
  });
  assert.equal(stats.skipped['chain-loop'], 1);
});

test('an implausible key length or an inactive state is skipped', (t) => {
  const tooLong = listSkips(t, (cache, { address, store }) => {
    store.writeInt32LE(0x7fffffff, 32);
    cache.seal(address);
  });
  assert.equal(tooLong.skipped['implausible-key-length'], 1);
  const pastBlock = listSkips(t, (cache, { address, store }) => {
    store.writeInt32LE(200, 32); // inline, but longer than the entry's one block
    cache.seal(address);
  });
  assert.equal(pastBlock.skipped['implausible-key-length'], 1);
  const doomed = listSkips(t, (cache, { address, store }) => {
    store.writeInt32LE(2, 20);
    cache.seal(address);
  });
  assert.equal(doomed.skipped['inactive-state'], 1);
});

test('a bad stream address, an oversized stream or a missing f_ file skips the response', (t) => {
  const badAddress = responseSkips(t, (cache, { address, store }) => {
    store.writeUInt32LE((store.readUInt32LE(60) | 0x04000000) >>> 0, 60); // reserved bit
    cache.seal(address);
  });
  assert.deepEqual(badAddress.skipped, { 'bad-address': 1 });
  const oversized = responseSkips(t, (cache, { address, store }) => {
    store.writeInt32LE(5000, 44); // body size, beyond its blocks
    cache.seal(address);
  });
  assert.deepEqual(oversized.skipped, { 'out-of-range': 1 });

  const cache = oneEntryCache(() => {});
  const dir = cache.writeTo(makeTempDir(t));
  fs.rmSync(path.join(dir, externalFileName(1)));
  const reader = openBlockfileCache({ blockDir: dir });
  const entry = reader.listEntries({ keyPattern: '/two' }).entries[0];
  assert.deepEqual(reader.readResponse(entry), { ok: false, reason: 'missing-file' });
  assert.deepEqual(reader.readStream(entry, 1), { ok: false, reason: 'missing-file' });
});

test('an f_ file shorter than the stored size is out of range', (t) => {
  const cache = oneEntryCache(() => {});
  const dir = cache.writeTo(makeTempDir(t));
  fs.writeFileSync(path.join(dir, externalFileName(1)), Buffer.alloc(0));
  assert.deepEqual(openBlockfileCache({ blockDir: dir }).readResponses().stats.skipped, { 'out-of-range': 1 });
});

test('a body that fails to decode is skipped', (t) => {
  const stats = responseSkips(t, (cache, { store }) => {
    const body = cache.bytesAt(store.readUInt32LE(60));
    body.fill(0xee, 0, 10);
  });
  assert.deepEqual(stats.skipped, { 'decode-failed': 1 });
});
