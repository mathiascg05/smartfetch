/**
 * Modelo de errores de SmartFetch.
 *
 * Define una jerarquía de errores controlados que permite a quien consume la
 * librería distinguir con claridad la causa de un fallo (tiempo de espera
 * agotado, problema de red o respuesta HTTP no satisfactoria) y reaccionar en
 * consecuencia. Todos los errores heredan de {@link SmartFetchError}, por lo
 * que pueden capturarse de forma genérica o específica.
 *
 * @module errors
 */

import type { RequestConfig, SmartFetchResponse } from './types.js';

/**
 * Categoría a la que pertenece un {@link SmartFetchError}.
 *
 * - `timeout`: la petición superó el tiempo máximo de espera.
 * - `network`: hubo un fallo de red (servidor inalcanzable, sin conexión, etc.).
 * - `http`: el servidor respondió con un código de estado de error.
 * - `request`: la petición no pudo construirse o configurarse correctamente.
 * - `unknown`: causa no clasificada.
 */
export type SmartFetchErrorType = 'timeout' | 'network' | 'http' | 'request' | 'unknown';

/**
 * Opciones comunes para construir un {@link SmartFetchError}.
 */
export interface SmartFetchErrorOptions {
  /** Categoría del error. Por defecto `"unknown"`. */
  type?: SmartFetchErrorType;
  /** Configuración con la que se realizaba la petición cuando ocurrió el error. */
  config?: RequestConfig;
  /** Error o valor original que provocó este error (para encadenar causas). */
  cause?: unknown;
}

/**
 * Error base de la librería. Todos los demás errores controlados heredan de él.
 *
 * Captura la categoría del fallo y, opcionalmente, la configuración de la
 * petición y la causa original, manteniendo la cadena de prototipos correcta
 * para que `instanceof` funcione tanto con la clase base como con las derivadas.
 *
 * @example
 * try {
 *   await client.get('/usuarios');
 * } catch (error) {
 *   if (error instanceof SmartFetchError) {
 *     console.error(error.type, error.message);
 *   }
 * }
 */
export class SmartFetchError extends Error {
  /** Categoría del error. */
  readonly type: SmartFetchErrorType;

  /** Configuración de la petición asociada al error, si está disponible. */
  readonly config?: RequestConfig;

  /** Causa original del error, si la hubo. */
  readonly cause?: unknown;

  /**
   * @param message - Mensaje descriptivo del error.
   * @param options - Metadatos opcionales del error (categoría, configuración y causa).
   */
  constructor(message: string, options: SmartFetchErrorOptions = {}) {
    super(message);
    this.name = 'SmartFetchError';
    this.type = options.type ?? 'unknown';
    this.config = options.config;
    this.cause = options.cause;

    // Restaura la cadena de prototipos: necesario al extender Error en TypeScript
    // para que `instanceof` siga funcionando con la subclase real instanciada.
    Object.setPrototypeOf(this, new.target.prototype);

    // Genera una traza de pila limpia en los entornos que lo soportan (V8/Node).
    const captureStackTrace = (Error as unknown as {
      captureStackTrace?: (target: object, ctor: Function) => void;
    }).captureStackTrace;
    if (typeof captureStackTrace === 'function') {
      captureStackTrace(this, new.target);
    }
  }

  /** Indica si el error se debe a que se agotó el tiempo de espera. */
  isTimeout(): this is TimeoutError {
    return this.type === 'timeout';
  }

  /** Indica si el error se debe a un problema de red. */
  isNetwork(): this is NetworkError {
    return this.type === 'network';
  }

  /** Indica si el error se debe a una respuesta HTTP no satisfactoria. */
  isHttp(): this is HttpError {
    return this.type === 'http';
  }
}

/**
 * Opciones para construir un {@link TimeoutError}.
 */
export interface TimeoutErrorOptions {
  /** Configuración de la petición que excedió el tiempo de espera. */
  config?: RequestConfig;
  /** Causa original (por ejemplo, el `AbortError` subyacente). */
  cause?: unknown;
}

/**
 * Error lanzado cuando una petición supera el tiempo máximo de espera y es
 * cancelada automáticamente.
 */
export class TimeoutError extends SmartFetchError {
  /** Tiempo máximo de espera (en milisegundos) que se excedió. */
  readonly timeout: number;

  /**
   * @param timeout - Tiempo máximo de espera, en milisegundos, que se superó.
   * @param options - Metadatos opcionales del error.
   */
  constructor(timeout: number, options: TimeoutErrorOptions = {}) {
    super(`La petición excedió el tiempo máximo de espera de ${timeout} ms`, {
      type: 'timeout',
      config: options.config,
      cause: options.cause,
    });
    this.name = 'TimeoutError';
    this.timeout = timeout;
  }
}

/**
 * Opciones para construir un {@link NetworkError}.
 */
export interface NetworkErrorOptions {
  /** Configuración de la petición que falló por red. */
  config?: RequestConfig;
  /** Causa original (por ejemplo, el `TypeError` que lanza `fetch` ante un fallo de red). */
  cause?: unknown;
}

/**
 * Error lanzado cuando la petición no puede completarse por un problema de red
 * (servidor inalcanzable, sin conexión, DNS, etc.).
 */
export class NetworkError extends SmartFetchError {
  /**
   * @param message - Mensaje descriptivo del fallo de red.
   * @param options - Metadatos opcionales del error.
   */
  constructor(
    message = 'Error de red al intentar realizar la petición',
    options: NetworkErrorOptions = {},
  ) {
    super(message, {
      type: 'network',
      config: options.config,
      cause: options.cause,
    });
    this.name = 'NetworkError';
  }
}

/**
 * Opciones para construir un {@link HttpError}.
 */
export interface HttpErrorOptions {
  /** Configuración de la petición que produjo la respuesta de error. */
  config?: RequestConfig;
  /** Respuesta normalizada asociada al error, si está disponible. */
  response?: SmartFetchResponse;
  /** Causa original, si la hubo. */
  cause?: unknown;
}

/**
 * Error lanzado cuando el servidor responde con un código de estado HTTP que no
 * pertenece al rango de éxito (2xx), por ejemplo 404 o 500.
 */
export class HttpError extends SmartFetchError {
  /** Código de estado HTTP devuelto por el servidor. */
  readonly status: number;

  /** Texto descriptivo del estado HTTP. */
  readonly statusText: string;

  /** Respuesta normalizada asociada al error, si está disponible. */
  readonly response?: SmartFetchResponse;

  /**
   * @param status - Código de estado HTTP devuelto por el servidor.
   * @param statusText - Texto descriptivo del estado HTTP.
   * @param options - Metadatos opcionales del error (configuración, respuesta y causa).
   */
  constructor(status: number, statusText: string, options: HttpErrorOptions = {}) {
    super(`La petición falló con el código de estado HTTP ${status} (${statusText})`, {
      type: 'http',
      config: options.config,
      cause: options.cause,
    });
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.response = options.response;
  }
}
