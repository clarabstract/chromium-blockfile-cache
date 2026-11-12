// Paul Hsieh's SuperFastHash, as in Chromium's base/third_party/superfasthash.
// Chromium hashes cache keys and EntryStore self_hash with it.
// Trailing bytes are read as signed char, like the C original.

const get16 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);
const signed8 = (byte) => (byte << 24) >> 24;

export function superFastHash(bytes) {
  const length = bytes.length;
  if (length === 0) return 0;
  let hash = length >>> 0;
  let at = 0;
  for (let rounds = length >>> 2; rounds > 0; rounds--) {
    hash = (hash + get16(bytes, at)) >>> 0;
    const tmp = ((get16(bytes, at + 2) << 11) ^ hash) >>> 0;
    hash = ((hash << 16) ^ tmp) >>> 0;
    at += 4;
    hash = (hash + (hash >>> 11)) >>> 0;
  }
  switch (length & 3) {
    case 3:
      hash = (hash + get16(bytes, at)) >>> 0;
      hash = (hash ^ (hash << 16)) >>> 0;
      hash = (hash ^ (signed8(bytes[at + 2]) << 18)) >>> 0;
      hash = (hash + (hash >>> 11)) >>> 0;
      break;
    case 2:
      hash = (hash + get16(bytes, at)) >>> 0;
      hash = (hash ^ (hash << 11)) >>> 0;
      hash = (hash + (hash >>> 17)) >>> 0;
      break;
    case 1:
      hash = (hash + signed8(bytes[at])) >>> 0;
      hash = (hash ^ (hash << 10)) >>> 0;
      hash = (hash + (hash >>> 1)) >>> 0;
      break;
  }
  hash = (hash ^ (hash << 3)) >>> 0;
  hash = (hash + (hash >>> 5)) >>> 0;
  hash = (hash ^ (hash << 4)) >>> 0;
  hash = (hash + (hash >>> 17)) >>> 0;
  hash = (hash ^ (hash << 25)) >>> 0;
  hash = (hash + (hash >>> 6)) >>> 0;
  return hash;
}
