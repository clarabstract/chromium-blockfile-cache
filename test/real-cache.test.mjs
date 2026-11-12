// Reads a real cache when CHROMIUM_CACHE_FIXTURE names a folder holding
// `index` and `data_N` (and, unless CHROMIUM_CACHE_FIXTURE_EXTERNAL names
// another folder, the f_ files). Skipped when it's unset.
//
// Assertions only count things. Keys, headers and bodies never reach the
// output, so a failing run can't leak what the cache holds.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKIP_REASONS, openBlockfileCache } from '../src/index.mjs';

const blockDir = process.env.CHROMIUM_CACHE_FIXTURE;
const externalDir = process.env.CHROMIUM_CACHE_FIXTURE_EXTERNAL || blockDir;
const skip = blockDir ? false : 'set CHROMIUM_CACHE_FIXTURE to a cache folder to run';

test('lists entries from a real cache with few skips', { skip }, () => {
  const cache = openBlockfileCache({ blockDir, externalDir });
  const { entries, stats } = cache.listEntries();
  assert.ok(entries.length > 0, 'the cache has entries');
  assert.ok(
    Object.keys(stats.skipped).every((reason) => SKIP_REASONS.includes(reason)),
    'every skip has a known reason',
  );
  // Evicted and doomed entries stay in their bucket chains until Chromium
  // cleans them up; a long-running cache can hold thousands. They aren't
  // damage, so only the other reasons count toward the limit.
  const damaged = Object.entries(stats.skipped)
    .filter(([reason]) => reason !== 'inactive-state')
    .reduce((sum, [, count]) => sum + count, 0);
  const active = stats.walked - (stats.skipped['inactive-state'] ?? 0);
  assert.ok(damaged <= active * 0.1, `${damaged} of ${active} active entries skipped as damaged`);
  assert.ok(
    entries.every((entry) => typeof entry.key === 'string' && entry.key.length > 0 && entry.streams.length === 4),
    'every entry has a key and four streams',
  );
});

test('decodes responses from a real cache', { skip }, () => {
  const { responses, stats } = openBlockfileCache({ blockDir, externalDir }).readResponses();
  assert.ok(responses.length > 0, 'some responses decode');
  assert.ok(
    responses.every((response) => Number.isInteger(response.status) && Buffer.isBuffer(response.body)),
    'every response has a status and a body',
  );
  assert.equal(stats.skipped['decode-failed'] ?? 0, 0, 'no body failed to decode');
});
