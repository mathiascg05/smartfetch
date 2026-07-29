/**
 * Parsing of the `Retry-After` HTTP header.
 *
 * When a server answers 429 or 503 it may state how long to wait before trying
 * again. That instruction beats any client-side guess, so the retry engine gives
 * it precedence over the configured backoff.
 *
 * RFC 9110 §10.2.3 allows two forms, and both are supported: a delay in seconds
 * (`"120"`) and an absolute HTTP date (`"Wed, 21 Oct 2026 07:28:00 GMT"`).
 *
 * @module retry/retry-after
 */

/** Status codes where `Retry-After` means "wait this long before retrying". */
export const RETRY_AFTER_STATUSES: ReadonlySet<number> = new Set([429, 503]);

/** Default cap applied to a server-provided delay, in milliseconds. */
export const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;

/**
 * Parses a `Retry-After` header value into a delay in milliseconds.
 *
 * A date already in the past yields `0` (retry immediately) rather than a
 * negative wait. Anything unparseable — including negative second counts — yields
 * `null` so the caller can fall back to its configured backoff.
 *
 * @param value - Raw header value, or `null` when the header is absent.
 * @returns Milliseconds to wait, or `null` when the value cannot be interpreted.
 */
export function parseRetryAfter(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  // Delay-seconds form: a non-negative integer.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // Every HTTP-date carries letters (day name, month name, "GMT"). Requiring one
  // stops `Date.parse` from loosely accepting junk like "-5" or "3.5" — which it
  // reads as a date in the past, silently turning a malformed header into a
  // zero wait instead of falling back to the configured backoff.
  if (!/[a-z]/i.test(trimmed)) {
    return null;
  }

  // HTTP-date form.
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return Math.max(0, timestamp - Date.now());
}

/**
 * Computes the wait a failed attempt asks for through `Retry-After`, if any.
 *
 * @param status - HTTP status of the failed response.
 * @param headerValue - Raw `Retry-After` value from that response.
 * @param maxMs - Upper bound applied to the server's request.
 * @returns Milliseconds to wait, or `null` when the header does not apply.
 */
export function retryAfterDelay(
  status: number,
  headerValue: string | null | undefined,
  maxMs: number = DEFAULT_MAX_RETRY_AFTER_MS,
): number | null {
  if (!RETRY_AFTER_STATUSES.has(status)) {
    return null;
  }
  const parsed = parseRetryAfter(headerValue);
  return parsed === null ? null : Math.min(parsed, maxMs);
}
