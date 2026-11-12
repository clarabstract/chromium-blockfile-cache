// HTTP cache keys put the URL last, after an optional prefix such as
// "1/0/_dk_https://site.example https://site.example " for the network
// isolation key. The URL itself has no spaces.

export function urlFromCacheKey(key) {
  const lastSpace = key.lastIndexOf(' ');
  return lastSpace === -1 ? key : key.slice(lastSpace + 1);
}
