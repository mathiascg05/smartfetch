/**
 * SmartFetch — wrapper avanzado y resiliente sobre la API nativa `fetch`.
 *
 * Punto de entrada público de la librería. A medida que avance el desarrollo,
 * aquí se re-exportarán el cliente, los tipos, los errores, los interceptores
 * y la instancia por defecto (Singleton).
 *
 * @packageDocumentation
 */

/** Versión actual de la librería. */
export const VERSION = '0.1.0';

// Cliente HTTP (núcleo de la librería).
export { SmartFetch } from './client.js';

// Estrategias de backoff para reintentos (patrón Strategy).
export { FixedBackoff, ExponentialBackoff } from './retry/backoff.js';
export type { BackoffStrategy } from './retry/backoff.js';

// Interceptores de petición/respuesta (Programación Orientada a Aspectos).
export { InterceptorManager } from './interceptors.js';
export type { Interceptor, InterceptorFulfilled, InterceptorRejected } from './interceptors.js';

// Contratos públicos (tipos e interfaces de configuración y respuesta).
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

// Modelo de errores controlados.
export {
  SmartFetchError,
  TimeoutError,
  NetworkError,
  HttpError,
} from './errors.js';

export type {
  SmartFetchErrorType,
  SmartFetchErrorOptions,
  TimeoutErrorOptions,
  NetworkErrorOptions,
  HttpErrorOptions,
} from './errors.js';
