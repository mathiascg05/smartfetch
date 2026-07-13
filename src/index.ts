/**
 * SmartFetch — wrapper avanzado y resiliente sobre la API nativa `fetch`.
 *
 * Punto de entrada público de la librería. Re-exporta toda la superficie
 * pública:
 *
 * - El cliente {@link SmartFetch} y sus fábricas ({@link createClient},
 *   {@link SmartFetchBuilder}) más la instancia por defecto {@link smartfetch}
 *   (Singleton, también export por defecto).
 * - Las estrategias de backoff para reintentos ({@link FixedBackoff},
 *   {@link ExponentialBackoff}) y el {@link InterceptorManager} (AOP).
 * - Los contratos de configuración/respuesta y el modelo de errores controlados
 *   ({@link SmartFetchError} y sus subtipos).
 *
 * @packageDocumentation
 */

/** Versión actual de la librería. */
export const VERSION = '1.0.0';

// Cliente HTTP (núcleo de la librería).
export { SmartFetch } from './client.js';

// Creación de clientes: Factory (createClient) + Builder (SmartFetchBuilder).
import { createClient } from './factory.js';
export { createClient, SmartFetchBuilder } from './factory.js';

/**
 * Instancia por defecto lista para usar (patrón Singleton).
 *
 * Permite hacer peticiones sin construir un cliente explícito. Para configurar
 * `baseURL`, cabeceras, timeout o reintentos, crea un cliente propio con
 * {@link createClient} o {@link SmartFetchBuilder}.
 */
export const smartfetch = createClient();

// Export por defecto: `import sf from 'smartfetch'` usa el Singleton anterior.
export default smartfetch;

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
  ParseError,
} from './errors.js';

export type {
  SmartFetchErrorType,
  SmartFetchErrorOptions,
  TimeoutErrorOptions,
  NetworkErrorOptions,
  HttpErrorOptions,
  ParseErrorOptions,
} from './errors.js';
