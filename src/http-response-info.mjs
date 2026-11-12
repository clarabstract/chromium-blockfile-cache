// Stream 0 of an HTTP cache entry is a base::Pickle of net::HttpResponseInfo:
// a uint32 payload size, then flags, timestamps and, among other fields
// whose layout varies by Chromium version, the response headers as a
// pickled string: int32 length, then "HTTP/1.1 200\0name: value\0...\0\0".
// This parser looks for that string instead of walking every field, so it
// keeps working when Chromium adds fields before it.

const STATUS_LINE_START = Buffer.from('HTTP/', 'latin1');
const STATUS_LINE = /^HTTP\/\d+(?:\.\d+)?\s+(\d{3})(?:\s+(.*))?$/;

export function parseHttpResponseInfo(bytes) {
  const raw = findRawHeaders(bytes);
  if (raw === null) return null;
  return parseRawHeaders(raw);
}

/** Parses "status line\0name: value\0...\0" into { status, statusText, headers }. */
export function parseRawHeaders(raw) {
  const lines = raw.split('\0').filter((line) => line.length > 0);
  const statusMatch = STATUS_LINE.exec(lines[0] ?? '');
  if (!statusMatch) return null;
  const headers = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
  }
  return { status: Number(statusMatch[1]), statusText: statusMatch[2] ?? '', headers };
}

function findRawHeaders(bytes) {
  let firstCandidate = -1;
  for (let at = bytes.indexOf(STATUS_LINE_START, 4); at !== -1; at = bytes.indexOf(STATUS_LINE_START, at + 1)) {
    if (firstCandidate === -1) firstCandidate = at;
    // A pickled string carries its int32 length just before it.
    const length = at >= 4 ? bytes.readInt32LE(at - 4) : -1;
    if (length > STATUS_LINE_START.length && at + length <= bytes.length) {
      return bytes.toString('latin1', at, at + length);
    }
  }
  if (firstCandidate === -1) return null;
  const end = bytes.indexOf(Buffer.from([0, 0]), firstCandidate);
  return bytes.toString('latin1', firstCandidate, end === -1 ? bytes.length : end);
}
