/**
 * Factory and fluent builder for SmartFetch clients.
 *
 * This module realizes two creation patterns:
 *
 * - **Factory** — {@link createClient} produces {@link SmartFetch} instances
 *   without the caller needing `new` or knowing the constructor's argument order.
 * - **Builder** — {@link SmartFetchBuilder} composes a client's configuration
 *   step by step through a chainable (fluent) API, materializing it at the end
 *   with {@link SmartFetchBuilder.build}.
 *
 * Neither reimplements configuration merging: they only assemble the default
 * {@link RequestConfig} and the {@link SmartFetchOptions} handed to the
 * {@link SmartFetch} constructor; the client itself merges those defaults with
 * each request's own configuration.
 *
 * @module factory
 */

import { SmartFetch } from './client.js';
import type { BackoffStrategy } from './retry/backoff.js';
import type {
  FetchAdapter,
  HeadersInit,
  RequestConfig,
  ResponseType,
  RetryPredicate,
  SmartFetchOptions,
} from './types.js';

/**
 * Creates a {@link SmartFetch} client with a default configuration.
 *
 * Thin wrapper over the constructor (Factory pattern): avoids direct use of `new`
 * and gives the library a single, stable creation point.
 *
 * @param defaults - Default configuration applied to every request of the client.
 * @param options - Client-level options (an injected `fetch`, for instance).
 * @returns A new {@link SmartFetch} instance.
 *
 * @example
 * ```ts
 * const api = createClient({ baseURL: 'https://api.example.com', timeout: 5000 });
 * const { data } = await api.get('/users');
 * ```
 */
export function createClient(
  defaults: RequestConfig = {},
  options: SmartFetchOptions = {},
): SmartFetch {
  return new SmartFetch(defaults, options);
}

/**
 * Fluent builder for {@link SmartFetch} clients (Builder pattern).
 *
 * Accumulates the default configuration and the client options through chainable
 * methods, producing the final instance on {@link build}. Every method returns
 * `this`, so calls can be chained.
 *
 * @example
 * ```ts
 * const api = new SmartFetchBuilder()
 *   .baseURL('https://api.example.com')
 *   .header('Authorization', 'Bearer token')
 *   .timeout(5000)
 *   .retries(2)
 *   .backoff(new ExponentialBackoff())
 *   .build();
 * ```
 */
export class SmartFetchBuilder {
  /** Default configuration accumulated for the client. */
  private readonly config: RequestConfig = {};

  /** Client-level options accumulated so far. */
  private readonly options: SmartFetchOptions = {};

  /**
   * Sets the base URL prepended to each request path.
   *
   * @param url - Base URL (for example, `"https://api.example.com/v1"`).
   * @returns The builder itself, for chaining.
   */
  baseURL(url: string): this {
    this.config.baseURL = url;
    return this;
  }

  /**
   * Adds (or overwrites) a single default header.
   *
   * @param name - Header name.
   * @param value - Header value.
   * @returns The builder itself, for chaining.
   */
  header(name: string, value: string): this {
    this.config.headers = { ...this.config.headers, [name]: value };
    return this;
  }

  /**
   * Merges a set of default headers into the ones accumulated so far.
   *
   * @param headers - Headers to merge (repeated keys are overwritten).
   * @returns The builder itself, for chaining.
   */
  headers(headers: HeadersInit): this {
    this.config.headers = { ...this.config.headers, ...headers };
    return this;
  }

  /**
   * Sets the maximum wait, in milliseconds, before aborting the request.
   *
   * @param ms - Timeout in milliseconds (`0` means no deadline).
   * @returns The builder itself, for chaining.
   */
  timeout(ms: number): this {
    this.config.timeout = ms;
    return this;
  }

  /**
   * Sets the number of additional retries on network or HTTP 5xx errors.
   *
   * @param count - Number of retries (`0` = a single attempt).
   * @returns The builder itself, for chaining.
   */
  retries(count: number): this {
    this.config.retries = count;
    return this;
  }

  /**
   * Sets the wait strategy between retries (Strategy pattern).
   *
   * @param strategy - Backoff strategy to use.
   * @returns The builder itself, for chaining.
   */
  backoff(strategy: BackoffStrategy): this {
    this.config.backoff = strategy;
    return this;
  }

  /**
   * Sets the predicate deciding whether a failed request should be retried.
   *
   * @param predicate - Retry predicate.
   * @returns The builder itself, for chaining.
   */
  retryOn(predicate: RetryPredicate): this {
    this.config.retryOn = predicate;
    return this;
  }

  /**
   * Sets the format the response body should be read as.
   *
   * @param type - Response type (`json`, `text`, `blob`, ...).
   * @returns The builder itself, for chaining.
   */
  responseType(type: ResponseType): this {
    this.config.responseType = type;
    return this;
  }

  /**
   * Sets the function deciding which HTTP status codes count as successful.
   *
   * @param fn - Receives the status code and returns `true` to accept it.
   * @returns The builder itself, for chaining.
   */
  validateStatus(fn: (status: number) => boolean): this {
    this.config.validateStatus = fn;
    return this;
  }

  /**
   * Injects a custom `fetch` implementation (Adapter pattern).
   *
   * Useful for polyfills, or for mocking the network in tests without touching
   * the global `fetch`.
   *
   * @param fetchImpl - `fetch` implementation to use.
   * @returns The builder itself, for chaining.
   */
  adapter(fetchImpl: FetchAdapter): this {
    this.options.fetch = fetchImpl;
    return this;
  }

  /**
   * Materializes the accumulated configuration into a {@link SmartFetch} instance.
   *
   * @returns The built client.
   */
  build(): SmartFetch {
    return createClient(this.config, this.options);
  }
}
