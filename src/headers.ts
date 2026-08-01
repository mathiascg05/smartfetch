/**
 * Normalization and merging of request headers.
 *
 * `fetch` accepts three shapes for headers — a `Headers` instance, an array of
 * `[name, value]` pairs, and a plain record — and so does SmartFetch. Everything
 * is normalized to **pairs** the moment it enters, and the rest of the library
 * only ever sees that one shape.
 *
 * Pairs are the internal representation because they preserve what the other two
 * cannot both express: order, the caller's capitalization, and a header repeated
 * on purpose (`Accept`, `Accept-Encoding`, `Link`). They are also assignable to
 * `RequestInit.headers` as-is, so nothing has to be converted back.
 *
 * @module headers
 */

import { SmartFetchError } from './errors.js';
import type { HeadersInit } from './types.js';

/** A header as an internal `[name, value]` pair. */
export type HeaderPair = [string, string];

/**
 * Fails with the library's error model instead of dropping headers silently.
 *
 * @param recibido - Short description of what arrived, for the message.
 */
function invalidHeaders(recibido: string): never {
  throw new SmartFetchError(
    `Invalid headers: expected a Headers instance, an array of [name, value] pairs ` +
      `or a plain object of string values, but got ${recibido}.`,
    { type: 'request' },
  );
}

/** Whether a value can be used as a header value once stringified. */
function isHeaderValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Normalizes any accepted header shape into pairs.
 *
 * Anything that is not one of the three shapes throws rather than being ignored:
 * headers vanishing without a word is exactly the failure mode this replaces. An
 * array of pairs used to be silently mangled into a header literally named `0`.
 *
 * @param input - Headers in any accepted shape, or `undefined` when absent.
 * @returns The headers as pairs, in the order given.
 * @throws {SmartFetchError} With `type: 'request'` on an unusable shape.
 */
export function normalizeHeaders(input?: HeadersInit): HeaderPair[] {
  if (input === undefined) {
    return [];
  }

  if (input instanceof Headers) {
    const pairs: HeaderPair[] = [];
    input.forEach((value, name) => pairs.push([name, value]));
    return pairs;
  }

  if (Array.isArray(input)) {
    return input.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) {
        return invalidHeaders('an array whose entries are not [name, value] pairs');
      }
      const [name, value] = entry as [unknown, unknown];
      if (typeof name !== 'string' || !isHeaderValue(value)) {
        return invalidHeaders('an array pair with a non-string name or a non-primitive value');
      }
      return [name, String(value)];
    });
  }

  if (typeof input !== 'object' || input === null) {
    return invalidHeaders(input === null ? 'null' : typeof input);
  }

  return Object.entries(input).map(([name, value]: [string, unknown]) => {
    if (!isHeaderValue(value)) {
      return invalidHeaders(`an object whose "${name}" value is ${typeof value}`);
    }
    return [name, String(value)];
  });
}

/** Looks up a header by name among pairs, case-insensitively. */
export function hasHeader(headers: readonly HeaderPair[], name: string): boolean {
  const target = name.toLowerCase();
  return headers.some(([key]) => key.toLowerCase() === target);
}

/**
 * Merges two header sets, normalizing both first.
 *
 * HTTP header names are case-insensitive, so `content-type` and `Content-Type`
 * are the same header; a plain object spread would keep both and `fetch` would
 * send them joined by a comma, which is almost never what the caller meant.
 *
 * **Replacement is per name, not per pair.** Every value `override` supplies for
 * a name replaces *all* of `base`'s values for that name, so a client default
 * cannot leak into a request that deliberately set the header. Duplicates
 * *within* one side are kept — that is how a multi-value header is expressed —
 * and each header goes out with the capitalization the winning side wrote.
 *
 * @param base - Lower-precedence headers (the client defaults).
 * @param override - Higher-precedence headers (the request's own).
 */
export function mergeHeaders(base?: HeadersInit, override?: HeadersInit): HeaderPair[] {
  const overridePairs = normalizeHeaders(override);
  const replaced = new Set(overridePairs.map(([name]) => name.toLowerCase()));

  const kept = normalizeHeaders(base).filter(([name]) => !replaced.has(name.toLowerCase()));

  return [...kept, ...overridePairs];
}

/**
 * Renders normalized pairs as the narrowest shape `fetch` accepts without loss.
 *
 * A plain record is returned whenever every header name is unique, and the pairs
 * are kept only when a name repeats — which a record cannot express. Both are
 * valid `RequestInit.headers` and neither drops anything, so the choice is purely
 * about handing back the most familiar shape: existing callers that inspect the
 * outgoing `init.headers` as an object keep working, and only a genuinely
 * multi-valued request sees the array.
 *
 * @param pairs - Headers already normalized and merged.
 */
export function toRequestHeaders(pairs: HeaderPair[]): HeaderPair[] | Record<string, string> {
  const seen = new Set<string>();
  for (const [name] of pairs) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) {
      return pairs;
    }
    seen.add(lower);
  }
  return Object.fromEntries(pairs);
}
