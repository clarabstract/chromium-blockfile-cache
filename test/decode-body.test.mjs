import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { CacheEntryProblem, decodeBody } from '../src/index.mjs';

const text = Buffer.from('{"ok":true,"items":[1,2,3]}');

function problemReason(run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof CacheEntryProblem, String(error));
    return error.reason;
  }
  assert.fail('expected a CacheEntryProblem');
}

test('no content-encoding and identity return the bytes as they are', () => {
  assert.deepEqual(decodeBody(text, undefined), text);
  assert.deepEqual(decodeBody(text, 'identity'), text);
});

test('gzip, br and deflate (zlib-wrapped or raw) decode', () => {
  assert.deepEqual(decodeBody(zlib.gzipSync(text), 'gzip'), text);
  assert.deepEqual(decodeBody(zlib.gzipSync(text), 'x-gzip'), text);
  assert.deepEqual(decodeBody(zlib.brotliCompressSync(text), 'BR'), text);
  assert.deepEqual(decodeBody(zlib.deflateSync(text), 'deflate'), text);
  assert.deepEqual(decodeBody(zlib.deflateRawSync(text), 'deflate'), text);
});

test('zstd decodes where Node supports it', { skip: typeof zlib.zstdCompressSync !== 'function' }, () => {
  assert.deepEqual(decodeBody(zlib.zstdCompressSync(text), 'zstd'), text);
});

test('stacked encodings are undone last-applied first', () => {
  const encoded = zlib.brotliCompressSync(zlib.gzipSync(text));
  assert.deepEqual(decodeBody(encoded, 'gzip, br'), text);
});

test('an unknown encoding or a corrupt body is a problem with a reason', () => {
  assert.equal(problemReason(() => decodeBody(text, 'compress')), 'unsupported-encoding');
  assert.equal(problemReason(() => decodeBody(text, 'br')), 'decode-failed');
  const truncated = zlib.gzipSync(text).subarray(0, 12);
  assert.equal(problemReason(() => decodeBody(truncated, 'gzip')), 'decode-failed');
});
