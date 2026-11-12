# chromium-blockfile-cache

![AI-DECLARATION: auto](https://img.shields.io/badge/䷼%20AI--DECLARATION-auto-ede9fe?labelColor=ede9fe)

> **Status: vibecoded with very little review.** Written by Claude, an AI
> coding agent, from a short brief; no human has read the code. It has unit
> tests and has been checked against real caches, but treat it as unaudited,
> especially on untrusted input. Details in [AI-DECLARATION.md](AI-DECLARATION.md).

Reads Chromium's **blockfile** disk cache, the format with `index`,
`data_0`…`data_N` and `f_XXXXXX` files that Chrome and Electron apps use
on Windows, and returns the cached HTTP responses with their bodies
decoded. Read-only and dependency-free.

It knows the file format and nothing about which app wrote the cache or
what the responses mean.

## Usage

```js
import { openBlockfileCache, urlFromCacheKey } from 'chromium-blockfile-cache';

const cache = openBlockfileCache({
  blockDir: 'C:\\snapshots\\app-cache',       // index, data_N
  externalDir: 'C:\\Users\\me\\AppData\\Roaming\\App\\Cache\\Cache_Data', // f_XXXXXX
});

const { responses, stats } = cache.readResponses({ keyPattern: /\/api\/v\d+\/items/ });
for (const { entry, status, headers, body } of responses) {
  console.log(urlFromCacheKey(entry.key), status, headers['content-type'], body.length);
}
console.log(stats); // { walked, listed, skipped: { reason: count }, responses }
```

### Two directories

A running browser keeps `index` and `data_N` locked, so they usually
come from a copy taken elsewhere (a shadow-copy snapshot, say), while
`f_XXXXXX` files are not locked and can be read where they are.

- `blockDir` holds `index` and `data_N`. They are all read into memory
  when the cache is opened, so the reader works from one consistent set
  and holds no handles on the folder afterwards.
- `externalDir` holds the `f_XXXXXX` files and defaults to `blockDir`.
  Each one is opened read-only when needed and closed straight away.
  Node (libuv) opens files with `FILE_SHARE_READ | FILE_SHARE_WRITE |
  FILE_SHARE_DELETE`, so the browser can still evict or rewrite a file
  while it is being read.

## API

### `openBlockfileCache({ blockDir, externalDir = blockDir, verifyHashes = true })`

Throws only when `blockDir` isn't a readable blockfile cache (missing
`index`, wrong magic, short headers). Returns:

| Method | Returns |
| --- | --- |
| `listEntries({ keyPattern? })` | `{ entries, stats }` |
| `readResponse(entry)` | `{ ok: true, status, statusText, headers, body }` or `{ ok: false, reason }` |
| `readResponses({ keyPattern? })` | `{ responses: [{ entry, status, statusText, headers, body }], stats }` |
| `readStream(entry, stream)` | `{ ok: true, bytes }` or `{ ok: false, reason }` |
| `indexHeader` | `{ version, numEntries, lastFile, tableLength, createTime }` |

`keyPattern` is a `RegExp`, a substring, or a `(key) => boolean`.

An **entry** is:

```js
{
  key: '1/0/_dk_https://site.example https://site.example https://site.example/path',
  address: 0xa0010003,       // its CacheAddr
  hash: 0x1234abcd,          // SuperFastHash of the key
  creationTime: Date,        // or null when unset
  streams: [{ size, address }, …], // 4 streams; 0 = response info, 1 = body
}
```

Entries come in hash-table order, which is arbitrary. `headers` has
lower-case names, with repeated headers joined by `, `. `body` is a
`Buffer`, decoded according to `content-encoding`.

**Stats** count what was walked and why things were skipped:

```js
{ walked: 120, listed: 117, skipped: { 'hash-mismatch': 1, 'inactive-state': 2 }, responses: 110 }
```

`listed` counts entries that read cleanly and matched `keyPattern`;
`responses` (from `readResponses` only) counts the ones whose response
decoded.

### Skip reasons

Torn and stale entries are normal in a copy taken while the browser
runs. They are skipped and counted, never thrown.

| Reason | Meaning |
| --- | --- |
| `bad-address` | The CacheAddr is uninitialized, has reserved bits set, or has a file type that can't hold data. |
| `unallocated-block` | The address points at blocks the file's allocation map marks free. |
| `out-of-range` | The read runs past the blocks, the block file or the `f_` file. |
| `missing-file` | The `data_N` or `f_XXXXXX` file isn't there (often evicted since the copy). |
| `implausible-key-length` | `key_len` is out of range or the key contains a NUL. |
| `hash-mismatch` | The key's hash, the entry's `self_hash` or its bucket doesn't match. Off with `verifyHashes: false`. |
| `inactive-state` | The entry is marked evicted or doomed. |
| `chain-loop` | A bucket chain links back to an entry already visited. |
| `no-response-headers` | Stream 0 holds no HTTP status line. Some entries never have one, e.g. `Range_`-keyed media entries. |
| `unsupported-encoding` | A `content-encoding` this Node can't decode. |
| `decode-failed` | The body didn't decompress, usually a truncated or stale body. |

`SKIP_REASONS` exports the list.

### Lower-level exports

`decodeCacheAddress`, `encodeBlockAddress`, `encodeExternalAddress`,
`externalFileName`, `isUsableAddress`, `FILE_TYPE`,
`parseBlockFileHeader`, `areBlocksAllocated`, `parseIndexHeader`,
`listBucketHeads`, `parseEntryStore`, `baseTimeToDate`, `superFastHash`,
`parseHttpResponseInfo`, `parseRawHeaders`, `decodeBody` (throws
`CacheEntryProblem` with a `reason`), `urlFromCacheKey`.

## Format notes

From Chromium's
[`net/disk_cache/blockfile/disk_format.h`](https://source.chromium.org/chromium/chromium/src/+/main:net/disk_cache/blockfile/disk_format.h),
[`disk_format_base.h`](https://source.chromium.org/chromium/chromium/src/+/main:net/disk_cache/blockfile/disk_format_base.h)
and [`addr.h`](https://source.chromium.org/chromium/chromium/src/+/main:net/disk_cache/blockfile/addr.h).
All integers are little-endian.

**`index`**: a 368-byte header, then a hash table of CacheAddr. The
table length is the int32 at offset 28 (0 means 0x10000); magic
`0xC103CAC3` at 0. A key lives in bucket `hash & (table_len - 1)`, and
each bucket heads a chain linked through the entries' `next` field.

**Block files (`data_N`)**: an 8192-byte header; magic `0xC104CAC3` at
0, `entry_size` (the block size) as an int32 at offset 12, and an
allocation bitmap from offset 80, one bit per block, low bit first.
Block `n` starts at `8192 + n × entry_size`. The block size always
comes from the header, never from a table keyed by file type. Usually
`data_0` = 36 (rankings), `data_1` = 256 (entries), `data_2` = 1024,
`data_3` = 4096, and a full file chains to `data_4` and up.

**CacheAddr** (uint32):

| Bits | Meaning |
| --- | --- |
| 31 | initialized |
| 28–30 | file type: 0 external, 1 rankings, 2 = 256-byte blocks, 3 = 1K, 4 = 4K |
| 0–27 (external) | file number; the file is `f_%06x` |
| 26–27 (block) | reserved, must be 0 |
| 24–25 (block) | number of blocks − 1 (1 to 4) |
| 16–23 (block) | block file number N of `data_N` |
| 0–15 (block) | first block |

**EntryStore**: 1 to 4 blocks in a 256-byte block file.

| Offset | Field |
| --- | --- |
| 0 | `hash`: SuperFastHash of the key |
| 4 | `next`: next entry in the bucket chain |
| 20 | `state`: 0 normal, 1 evicted, 2 doomed |
| 24 | `creation_time`: µs since 1601-01-01 UTC |
| 32 | `key_len` |
| 36 | `long_key`: CacheAddr of the key when it doesn't fit inline, else 0 |
| 40 | `data_size[4]` |
| 56 | `data_addr[4]` |
| 92 | `self_hash`: SuperFastHash of bytes 0–91 (0 = unset) |
| 96 | inline key, NUL-terminated; up to 160 bytes in one block, 927 in four |

**Streams**: stream 0 is a pickled `HttpResponseInfo`. The response
headers sit in it as a pickled string (int32 length, then
`HTTP/1.1 200\0name: value\0…\0\0`); the parser finds that string
rather than walking every field, since the fields before it vary by
Chromium version. Stream 1 is the body as it came off the wire, still
content-encoded. Streams over 16 KB usually live in `f_` files.

**Hashes**: Chromium hashes keys and `self_hash` with Paul Hsieh's
SuperFastHash, reading trailing bytes as signed char.

### What was checked against a real cache

On 2026-11-12, a copy of an idle Electron app's cache (50 entries,
index version 3.0, block files version 2.0, a 131,072-bucket table):
`entry_size` read 36, 256, 1024 and 4096 from the four headers; every
entry passed the key-hash, `self_hash`, bucket and allocation checks;
42 responses decoded (identity, gzip and br, 24 bodies from `f_` files),
and the other 8 were `Range_`-keyed entries with an empty stream 0.

## Limits

- An `f_` file that the browser deleted and later recreated under the
  same number can't be told apart from the original, except when its
  size no longer fits or its body fails to decode.
- Sparse (range) entries' child entries are listed like any other entry,
  but their data isn't stitched together.
- The rankings (`data_0`), eviction lists and stats block are not read.
- zstd bodies need a Node with `zlib.zstdDecompressSync` (22.15 or
  later); elsewhere they are skipped as `unsupported-encoding`.

## Tests

```bash
npm test
```

Unit tests build tiny caches byte by byte (`test/synthetic-cache.mjs`)
and cover address decoding, header parsing, body decoding and each skip
reason. Tests against a real cache run only when `CHROMIUM_CACHE_FIXTURE`
names a folder with `index` and `data_N` (set
`CHROMIUM_CACHE_FIXTURE_EXTERNAL` if the `f_` files are elsewhere).
Those tests assert counts only, so keys and bodies never reach the
output. Never commit a real cache.
