/**
 * Building the final request URL.
 *
 * This module concentrates the pure URL-resolution logic: it combines the
 * `baseURL` with the resource path and appends the query-string parameters
 * (`params`). Depending on neither `fetch` nor any state, it is trivial to test in
 * isolation.
 *
 * @module url
 */

import type { QueryParamValue, RequestConfig } from './types.js';

/** Detects whether a URL is absolute (carries an http/https scheme). */
const ABSOLUTE_URL = /^https?:\/\//i;

/**
 * Combines the `baseURL` with the resource `url`.
 *
 * - If `url` is absolute (starts with `http://` or `https://`), it is used as-is
 *   and `baseURL` is ignored.
 * - If there is no `baseURL`, `url` is returned (or an empty string).
 * - Otherwise both are joined, normalizing the slash so it is neither duplicated
 *   nor lost.
 */
function resolveURL(baseURL: string | undefined, url: string): string {
  if (ABSOLUTE_URL.test(url)) {
    return url;
  }
  if (!baseURL) {
    return url;
  }
  const base = baseURL.replace(/\/+$/, '');
  const path = url.replace(/^\/+/, '');
  if (!path) {
    return base;
  }
  return `${base}/${path}`;
}

/**
 * Appends a single parameter to the {@link URLSearchParams}, skipping
 * `null`/`undefined` and stringifying numbers and booleans.
 */
function appendParam(search: URLSearchParams, key: string, value: QueryParamValue): void {
  if (value === null || value === undefined) {
    return;
  }
  search.append(key, String(value));
}

/**
 * Builds the final request URL from its configuration.
 *
 * Combines {@link RequestConfig.baseURL} and {@link RequestConfig.url}, then
 * appends {@link RequestConfig.params} while preserving any query already present
 * in the URL. An array value emits one repeated entry per element;
 * `null`/`undefined` values are skipped.
 *
 * @example
 * buildURL({ baseURL: 'https://api.x.com/v1', url: '/users', params: { page: 2, tags: ['a', 'b'] } });
 * // -> "https://api.x.com/v1/users?page=2&tags=a&tags=b"
 */
export function buildURL(config: RequestConfig): string {
  const resolved = resolveURL(config.baseURL, config.url ?? '');

  if (!config.params) {
    return resolved;
  }

  // Splits off any query already present in the URL so it can be merged with `params`.
  const hashIndex = resolved.indexOf('#');
  const hash = hashIndex >= 0 ? resolved.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? resolved.slice(0, hashIndex) : resolved;

  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const existingQuery = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';

  const search = new URLSearchParams(existingQuery);
  for (const [key, value] of Object.entries(config.params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        appendParam(search, key, item);
      }
    } else {
      appendParam(search, key, value);
    }
  }

  const query = search.toString();
  return `${path}${query ? `?${query}` : ''}${hash}`;
}
