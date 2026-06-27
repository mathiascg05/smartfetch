/**
 * Definiciones de tipos públicos de SmartFetch.
 *
 * Este módulo concentra los contratos (interfaces y tipos) que describen cómo
 * se configura una petición y qué forma tiene la respuesta. Al estar separados
 * de la implementación, otros desarrolladores pueden importarlos para tipar su
 * propio código sin acoplarse a los detalles internos de la librería.
 *
 * @module types
 */

/**
 * Métodos HTTP soportados por el cliente.
 *
 * El proyecto exige, como mínimo, los métodos GET, POST, PUT, PATCH y DELETE.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Formato en el que se desea interpretar el cuerpo de la respuesta.
 *
 * - `json`: parsea la respuesta como JSON (valor por defecto).
 * - `text`: devuelve la respuesta como texto plano.
 * - `blob`: devuelve la respuesta como un {@link Blob} (datos binarios).
 * - `arrayBuffer`: devuelve la respuesta como un {@link ArrayBuffer}.
 */
export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer';

/**
 * Valor admitido para un parámetro de consulta (query string).
 *
 * Los valores `null` y `undefined` se omiten al construir la URL final.
 */
export type QueryParamValue = string | number | boolean | null | undefined;

/**
 * Conjunto de parámetros de consulta que se anexan a la URL.
 *
 * Cada clave puede ser un valor simple o un arreglo de valores; en el segundo
 * caso se genera una entrada repetida por cada elemento del arreglo.
 *
 * @example
 * // { page: 2, tags: ['a', 'b'] }  ->  "?page=2&tags=a&tags=b"
 */
export type QueryParams = Record<string, QueryParamValue | QueryParamValue[]>;

/**
 * Cabeceras HTTP representadas como pares clave/valor de texto.
 */
export type HeadersInit = Record<string, string>;

/**
 * Configuración de una petición HTTP.
 *
 * Todas las propiedades son opcionales: pueden definirse al crear el cliente
 * (como valores por defecto) y/o al realizar cada petición individual, donde
 * sobrescriben a los valores por defecto.
 */
export interface RequestConfig {
  /**
   * URL base que se antepone a la ruta de cada petición.
   * @example "https://api.ejemplo.com/v1"
   */
  baseURL?: string;

  /** Ruta o URL del recurso solicitado (relativa a {@link RequestConfig.baseURL} o absoluta). */
  url?: string;

  /** Método HTTP a utilizar. Por defecto `GET`. */
  method?: HttpMethod;

  /** Cabeceras HTTP a enviar con la petición. */
  headers?: HeadersInit;

  /** Parámetros de consulta a anexar a la URL. */
  params?: QueryParams;

  /**
   * Cuerpo de la petición. Si es un objeto plano se serializa como JSON;
   * los métodos `GET` y `DELETE` normalmente no lo utilizan.
   */
  body?: unknown;

  /**
   * Tiempo máximo de espera en milisegundos antes de cancelar la petición.
   * Un valor de `0` o `undefined` significa "sin límite de tiempo".
   */
  timeout?: number;

  /**
   * Número de reintentos adicionales ante errores del servidor (5xx) o de red.
   * Por defecto es `0`, es decir, la librería realiza un único intento.
   */
  retries?: number;

  /** Formato en el que se interpretará el cuerpo de la respuesta. Por defecto `json`. */
  responseType?: ResponseType;

  /**
   * Señal de aborto externa para permitir que quien consume la librería pueda
   * cancelar manualmente la petición, además del control por `timeout`.
   */
  signal?: AbortSignal;
}

/**
 * Respuesta normalizada que devuelve SmartFetch tras una petición exitosa.
 *
 * @typeParam T - Tipo esperado del cuerpo de la respuesta ya parseado.
 */
export interface SmartFetchResponse<T = unknown> {
  /** Cuerpo de la respuesta ya parseado según {@link RequestConfig.responseType}. */
  data: T;

  /** Código de estado HTTP (por ejemplo, `200`). */
  status: number;

  /** Texto descriptivo del estado HTTP (por ejemplo, `"OK"`). */
  statusText: string;

  /** Cabeceras de la respuesta como pares clave/valor. */
  headers: Record<string, string>;

  /** `true` si el código de estado está en el rango 2xx. */
  ok: boolean;

  /** URL final desde la que se obtuvo la respuesta (tras redirecciones). */
  url: string;

  /** Configuración efectiva con la que se realizó la petición. */
  config: RequestConfig;

  /** Objeto {@link Response} nativo, por si se necesita acceso de bajo nivel. */
  raw: Response;
}

/**
 * Adaptador de bajo nivel que realiza la petición HTTP real.
 *
 * Abstrae la dependencia concreta de `fetch` (patrón Adapter): por defecto el
 * cliente usa `globalThis.fetch`, pero puede inyectarse otra implementación
 * compatible (por ejemplo, un `fetch` de prueba en los tests, o un polyfill).
 *
 * @param input - URL final ya construida de la petición.
 * @param init - Opciones nativas de la petición (método, cabeceras, cuerpo, señal, etc.).
 * @returns El {@link Response} nativo resultante.
 */
export type FetchAdapter = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Opciones a nivel de cliente (no de una petición individual).
 *
 * Se pasan al construir una instancia de `SmartFetch` y configuran su
 * comportamiento global, a diferencia de {@link RequestConfig}, que describe
 * una petición concreta.
 */
export interface SmartFetchOptions {
  /**
   * Implementación de `fetch` a utilizar. Por defecto `globalThis.fetch`.
   * Permite inyectar un adaptador propio (patrón Adapter) o mockear la red
   * en los tests sin alterar el `fetch` global.
   */
  fetch?: FetchAdapter;
}
