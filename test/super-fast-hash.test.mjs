import assert from 'node:assert/strict';
import { test } from 'node:test';
import { superFastHash } from '../src/index.mjs';

// Regression values. The implementation was checked against a real cache:
// every entry's key hash and self_hash written by Chromium matched.
test('hashes every remainder length the same way as before', () => {
  const cases = {
    '': 0x0,
    a: 0x115ea782,
    ab: 0x516b8b44,
    abc: 0xd2be198a,
    abcd: 0xdad8b8db,
    'hello world': 0xa68c6882,
    'https://example.com/a': 0xd3eeb383,
  };
  for (const [text, expected] of Object.entries(cases)) {
    assert.equal(superFastHash(Buffer.from(text)), expected, JSON.stringify(text));
  }
});

test('trailing bytes are signed, as in the C original', () => {
  assert.equal(superFastHash(Buffer.from([0x41, 0x42, 0xff])), 0xf6616e27);
  assert.equal(superFastHash(Buffer.from([0xff])), 0); // 1 + (signed char)-1 = 0
});
