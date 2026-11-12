import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHttpResponseInfo, parseRawHeaders } from '../src/index.mjs';
import { pickleResponseInfo } from './synthetic-cache.mjs';

test('reads the status and headers out of a pickled HttpResponseInfo', () => {
  const info = parseHttpResponseInfo(
    pickleResponseInfo('HTTP/1.1 200', [
      ['Content-Type', 'application/json'],
      ['content-encoding', 'br'],
      ['Vary', 'Accept'],
      ['vary', 'Origin'],
    ]),
  );
  assert.deepEqual(info, {
    status: 200,
    statusText: '',
    headers: { 'content-type': 'application/json', 'content-encoding': 'br', vary: 'Accept, Origin' },
  });
});

test('keeps the reason phrase when there is one', () => {
  const info = parseHttpResponseInfo(pickleResponseInfo('HTTP/1.0 404 Not Found'));
  assert.equal(info.status, 404);
  assert.equal(info.statusText, 'Not Found');
});

test('falls back to the double NUL when the length prefix is wrong', () => {
  const bytes = pickleResponseInfo('HTTP/1.1 206', [['content-range', 'bytes 0-9/10']]);
  const at = bytes.indexOf('HTTP/');
  bytes.writeInt32LE(0x7fffffff, at - 4);
  assert.deepEqual(parseHttpResponseInfo(bytes).headers, { 'content-range': 'bytes 0-9/10' });
});

test('returns null without a status line', () => {
  assert.equal(parseHttpResponseInfo(Buffer.alloc(0)), null);
  assert.equal(parseHttpResponseInfo(Buffer.from('\x10\0\0\0not a response')), null);
  assert.equal(parseRawHeaders('garbage\0x: y\0\0'), null);
});
