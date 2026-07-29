/**
 * Public type definitions of SmartFetch.
 *
 * This module gathers the contracts (interfaces and types) that describe how a
 * request is configured and what a response looks like. Keeping them apart from
 * the implementation lets consumers type their own code against the library
 * without coupling to its internals.
 *
 * @module types
 */

import type { BackoffStrategy } from './retry/backoff.js';

/**
 * HTTP methods supported by the client.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Format the response body should be read as.
 *
 * - `json`: parse the body as JSON (default).
 * - `text`: return the body as plain text.
 * - `blob`: return the body as a {@link Blob} (binary data).
 * - `arrayBuffer`: return the body as an {@link ArrayBuffer}.
 * - `formData`: return the body as {@link FormData}.
 */
export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData';

/**
 * Value accepted for a query-string parameter.
 *
 * `null` and `undefined` values are skipped when building the final URL.
 */
export type QueryParamValue = string | number | boolean | null | undefined;

/**
 * Query-string parameters appended to the URL.
 *
 * Each key holds either a single value or an array of values; in the latter case
 * one entry is emitted per element.
 *
 * @example
 * // { page: 2, tags: ['a', 'b'] }  ->  "?page=2&tags=a&tags=b"
 */
export type QueryParams = Record<string, QueryParamValue | QueryParamValue[]>;

/**
 * HTTP headers as plain string key/value pairs.
 */
export type HeadersInit = Record<string, string>;

/**
 * Predicate deciding whether a failed request should be retried.
 *
 * Receives the captured error and the retry number that would be attempted
 * (1-based), returning `true` to retry or `false` to propagate the error.
 * Customizes the retry policy through {@link RequestConfig.retryOn}; when
 * omitted, the library retries network errors and HTTP 5xx responses.
 *
 * @param error - Error captured on the failed attempt.
 * @param attempt - Retry number about to be performed (starting at `1`).
 * @returns `true` to retry; `false` to propagate the error.
 */
export type RetryPredicate = (error: unknown, attempt: number) => boolean;

/**
 * Configuration of an HTTP request.
 *
 * Every property is optional and can be set when creating the client (as
 * defaults) and/or per request, where it overrides the client-level value.
 */
export interface RequestConfig {
  /**
   * Base URL prepended to each request path.
   * @example "https://api.example.com/v1"
   */
  baseURL?: string;

  /** Path or URL of the requested resource (relative to {@link RequestConfig.baseURL}, or absolute). */
  url?: string;

  /** HTTP method to use. Defaults to `GET`. */
  method?: HttpMethod;

  /** HTTP headers to send with the request. */
  headers?: HeadersInit;

  /** Query-string parameters to append to the URL. */
  params?: QueryParams;

  /**
   * Request body. Plain objects are serialized as JSON; `GET` and `DELETE`
   * normally do not carry one.
   */
  body?: unknown;

  /**
   * Maximum time to wait, in milliseconds, before aborting the request.
   * `0` or `undefined` means no deadline.
   */
  timeout?: number;

  /**
   * Number of additional retries after a server (5xx) or network error.
   * Defaults to `0`, meaning a single attempt.
   */
  retries?: number;

  /**
   * Wait strategy between retries (Strategy pattern). When omitted, retries happen
   * immediately with no delay. Only has an effect when
   * {@link RequestConfig.retries} is greater than `0`.
   */
  backoff?: BackoffStrategy;

  /**
   * Predicate deciding whether a failed request should be retried. When omitted,
   * the default policy retries network errors and HTTP 5xx responses, but never
   * timeouts or client (4xx) errors.
   */
  retryOn?: RetryPredicate;

  /** Format the response body should be read as. Defaults to `json`. */
  responseType?: ResponseType;

  /**
   * Decides which HTTP status codes count as successful. Receives the status code
   * and returns `true` to accept it (resolving the promise) or `false` to reject
   * with an {@link HttpError}. When omitted, only the 2xx range is accepted
   * (equivalent to `Response.ok`).
   *
   * @example
   * // Treat 304 (Not Modified) as a success too:
   * validateStatus: (status) => (status >= 200 && status < 300) || status === 304
   */
  validateStatus?: (status: number) => boolean;

  /**
   * External abort signal, letting consumers cancel the request manually on top
   * of the `timeout` control.
   */
  signal?: AbortSignal;
}

/**
 * Normalized response returned by SmartFetch on a successful request.
 *
 * @typeParam T - Expected type of the parsed response body.
 */
export interface SmartFetchResponse<T = unknown> {
  /** Response body already parsed according to {@link RequestConfig.responseType}. */
  data: T;

  /** HTTP status code (for example, `200`). */
  status: number;

  /** Human-readable text of the HTTP status (for example, `"OK"`). */
  statusText: string;

  /** Response headers as key/value pairs. */
  headers: Record<string, string>;

  /** `true` when the status code falls in the 2xx range. */
  ok: boolean;

  /** Final URL the response came from (after redirects). */
  url: string;

  /** Effective configuration the request was performed with. */
  config: RequestConfig;

  /** Native {@link Response} object, for low-level access when needed. */
  raw: Response;
}

/**
 * Low-level adapter that performs the actual HTTP request.
 *
 * Abstracts the concrete dependency on `fetch` (Adapter pattern): by default the
 * client uses `globalThis.fetch`, but any compatible implementation can be
 * injected (a test double, or a polyfill).
 *
 * @param input - Final, fully built request URL.
 * @param init - Native request options (method, headers, body, signal, ...).
 * @returns The native {@link Response}.
 */
export type FetchAdapter = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Client-level options (as opposed to per-request ones).
 *
 * Passed when constructing a `SmartFetch` instance to configure its global
 * behaviour, unlike {@link RequestConfig}, which describes a single request.
 */
export interface SmartFetchOptions {
  /**
   * `fetch` implementation to use. Defaults to `globalThis.fetch`. Allows
   * injecting a custom adapter (Adapter pattern) or mocking the network in tests
   * without touching the global `fetch`.
   */
  fetch?: FetchAdapter;
}
