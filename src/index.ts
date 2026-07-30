/**
 * SmartFetch — a resilient wrapper around the native `fetch` API.
 *
 * Public entry point of the library. Re-exports the whole public surface:
 *
 * - The {@link SmartFetch} client and its factories ({@link createClient},
 *   {@link SmartFetchBuilder}) plus the default {@link smartfetch} instance
 *   (Singleton, also the default export).
 * - The retry backoff strategies ({@link FixedBackoff}, {@link ExponentialBackoff})
 *   and the {@link InterceptorManager} (aspect-oriented hooks).
 * - The configuration/response contracts and the typed error model
 *   ({@link SmartFetchError} and its subtypes).
 *
 * @packageDocumentation
 */

/** Current library version. */
export const VERSION = '3.0.0';

// HTTP client (core of the library).
export { SmartFetch } from './client.js';

// Client creation: Factory (createClient) + Builder (SmartFetchBuilder).
import { createClient } from './factory.js';
export { createClient, SmartFetchBuilder } from './factory.js';

/**
 * Ready-to-use default instance (Singleton pattern).
 *
 * Lets you make requests without constructing an explicit client. To configure a
 * `baseURL`, headers, timeout or retries, create your own client with
 * {@link createClient} or {@link SmartFetchBuilder}.
 *
 * Constructing it is side-effect free even on a runtime without a global `fetch`:
 * the client resolves its adapter when a request is made, not when it is built.
 * Importing this library is therefore always safe — the failure only surfaces if
 * the default client is *used* with no `fetch` available.
 */
export const smartfetch = createClient();

// Default export: `import sf from '@mathiascg05/smartfetch'` yields the Singleton above.
export default smartfetch;

// Retry backoff strategies (Strategy pattern).
export { FixedBackoff, ExponentialBackoff } from './retry/backoff.js';
export type { BackoffStrategy, ExponentialBackoffOptions } from './retry/backoff.js';

// Request/response interceptors (aspect-oriented hooks).
export { InterceptorManager } from './interceptors.js';
export type { Interceptor, InterceptorFulfilled, InterceptorRejected } from './interceptors.js';

// Public contracts (configuration and response types and interfaces).
export type {
  HttpMethod,
  ResponseType,
  QueryParamValue,
  QueryParams,
  HeadersInit,
  RequestConfig,
  RetryPredicate,
  SmartFetchResponse,
  FetchAdapter,
  SmartFetchOptions,
} from './types.js';

// Typed error model.
export {
  SmartFetchError,
  TimeoutError,
  CancelledError,
  NetworkError,
  HttpError,
  ParseError,
} from './errors.js';

export type {
  SmartFetchErrorType,
  SmartFetchErrorOptions,
  TimeoutErrorOptions,
  CancelledErrorOptions,
  NetworkErrorOptions,
  HttpErrorOptions,
  ParseErrorOptions,
} from './errors.js';
