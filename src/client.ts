/**
 * Cliente HTTP de SmartFetch.
 *
 * Define la clase {@link SmartFetch}, que envuelve la API nativa `fetch`
 * siguiendo el patrón Adapter: toda petición pasa por un {@link FetchAdapter}
 * inyectable (por defecto `globalThis.fetch`). El método central `request()`
 * construye la URL, realiza la llamada, parsea la respuesta y la normaliza en un
 * {@link SmartFetchResponse}, traduciendo los fallos al modelo de errores
 * controlados de la librería. En este incremento se expone el método `get()`;
 * el resto de verbos, el timeout y los reintentos se añaden en incrementos
 * posteriores.
 *
 * @module client
 */

import { HttpError, NetworkError, SmartFetchError } from './errors.js';
import type {
  FetchAdapter,
  HeadersInit,
  RequestConfig,
  ResponseType,
  SmartFetchOptions,
  SmartFetchResponse,
} from './types.js';
import { withTimeout } from './timeout.js';
import { defaultShouldRetry, withRetry } from './retry/retry.js';
import { InterceptorManager } from './interceptors.js';
import { buildURL } from './url.js';

/**
 * Indica si un valor es un objeto plano susceptible de serializarse como JSON
 * (descarta tipos de cuerpo que `fetch` ya sabe manejar de forma nativa).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (
    value instanceof FormData ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    value instanceof URLSearchParams ||
    ArrayBuffer.isView(value)
  ) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Busca una cabecera por nombre sin distinguir mayúsculas/minúsculas. */
function hasHeader(headers: HeadersInit, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

/**
 * Cliente HTTP de alto nivel construido sobre `fetch` nativo.
 *
 * @example
 * const client = new SmartFetch({ baseURL: 'https://api.ejemplo.com' });
 * const { data } = await client.get<Usuario[]>('/usuarios');
 */
export class SmartFetch {
  /** Configuración por defecto aplicada a cada petición. */
  private readonly defaults: RequestConfig;

  /** Adaptador de bajo nivel que ejecuta la petición real (patrón Adapter). */
  private readonly adapter: FetchAdapter;

  /**
   * Interceptores de petición y respuesta (Programación Orientada a Aspectos).
   *
   * - `request`: transforman la {@link RequestConfig} **antes** de construir la
   *   URL y enviar la petición (p. ej. añadir cabeceras de autenticación).
   * - `response`: transforman la {@link SmartFetchResponse} tras recibirla, y sus
   *   manejadores de error pueden observar o **recuperarse** de un fallo.
   *
   * @example
   * client.interceptors.request.use((config) => {
   *   config.headers = { ...config.headers, Authorization: 'Bearer token' };
   *   return config;
   * });
   */
  readonly interceptors = {
    request: new InterceptorManager<RequestConfig>(),
    response: new InterceptorManager<SmartFetchResponse>(),
  };

  /**
   * @param defaults - Configuración por defecto que se fusiona con la de cada petición.
   * @param options - Opciones a nivel de cliente (por ejemplo, el `fetch` a inyectar).
   */
  constructor(defaults: RequestConfig = {}, options: SmartFetchOptions = {}) {
    this.defaults = defaults;

    const adapter = options.fetch ?? (globalThis.fetch as FetchAdapter | undefined);
    if (typeof adapter !== 'function') {
      throw new SmartFetchError(
        'No hay una implementación de fetch disponible. Usa Node 18+ o inyecta una vía options.fetch.',
        { type: 'request' },
      );
    }
    // Enlaza el fetch global a globalThis para evitar "Illegal invocation".
    this.adapter = options.fetch ? options.fetch : adapter.bind(globalThis);
  }

  /**
   * Realiza una petición HTTP arbitraria y devuelve la respuesta normalizada.
   *
   * @typeParam T - Tipo esperado del cuerpo de la respuesta ya parseado.
   * @param config - Configuración de la petición (se fusiona con los valores por defecto).
   * @throws {HttpError} Si el servidor responde con un código fuera del rango 2xx.
   * @throws {NetworkError} Si la petición falla por un problema de red.
   * @throws {TimeoutError} Si la petición supera el tiempo máximo de espera.
   */
  async request<T = unknown>(config: RequestConfig): Promise<SmartFetchResponse<T>> {
    const effective = this.mergeConfig(config);

    // Se construye la cadena de la Programación Orientada a Aspectos (AOP):
    //   [interceptores de request] -> núcleo (dispatch) -> [interceptores de response]
    // Cada eslabón es un par [onFulfilled, onRejected] que se encadena con
    // `.then(...)`, igual que en axios. Así los interceptores envuelven el núcleo
    // sin que este conozca su existencia.
    const chain: Array<[unknown, unknown]> = [];

    // Los interceptores de request se ejecutan en orden INVERSO al de registro
    // (LIFO): el último en registrarse es el primero en transformar la config.
    this.interceptors.request.forEach((interceptor) => {
      chain.unshift([interceptor.fulfilled, interceptor.rejected]);
    });

    // Núcleo de la petición: recibe la config ya interceptada y devuelve la respuesta.
    chain.push([(cfg: RequestConfig): Promise<SmartFetchResponse<T>> => this.dispatch<T>(cfg), undefined]);

    // Los interceptores de response se ejecutan en orden de registro (FIFO).
    this.interceptors.response.forEach((interceptor) => {
      chain.push([interceptor.fulfilled, interceptor.rejected]);
    });

    // El valor que fluye por la cadena cambia de tipo (RequestConfig -> respuesta)
    // al pasar por el núcleo, por lo que se opera sobre una promesa sin tipar y se
    // reafirma el tipo final al devolverla (mismo enfoque que axios).
    let promise: Promise<unknown> = Promise.resolve(effective);
    for (const [onFulfilled, onRejected] of chain) {
      promise = promise.then(
        onFulfilled as (value: unknown) => unknown,
        onRejected as ((reason: unknown) => unknown) | undefined,
      );
    }
    return promise as Promise<SmartFetchResponse<T>>;
  }

  /**
   * Fusiona la configuración por defecto del cliente con la de una petición
   * concreta, dando prioridad a esta última y combinando las cabeceras.
   *
   * @param config - Configuración específica de la petición.
   * @returns La configuración efectiva con la que se realizará la petición.
   */
  private mergeConfig(config: RequestConfig): RequestConfig {
    return {
      ...this.defaults,
      ...config,
      method: config.method ?? this.defaults.method ?? 'GET',
      headers: { ...this.defaults.headers, ...config.headers },
    };
  }

  /**
   * Núcleo de la petición: construye la URL y las opciones nativas una sola vez
   * y ejecuta el intento (con reintentos y timeout). Es el eslabón central que
   * los interceptores envuelven.
   *
   * @typeParam T - Tipo esperado del cuerpo de la respuesta ya parseado.
   * @param effective - Configuración efectiva (ya fusionada e interceptada).
   */
  private dispatch<T>(effective: RequestConfig): Promise<SmartFetchResponse<T>> {
    // La URL y las opciones nativas se construyen una sola vez y se reutilizan en
    // cada intento (el motor de reintentos vuelve a ejecutar performAttempt).
    const url = buildURL(effective);
    const init = this.buildRequestInit(effective);

    return withRetry((): Promise<SmartFetchResponse<T>> => this.performAttempt<T>(url, init, effective), {
      retries: effective.retries ?? 0,
      backoff: effective.backoff,
      shouldRetry: effective.retryOn ?? defaultShouldRetry,
      signal: effective.signal,
    });
  }

  /**
   * Ejecuta un único intento de la petición: realiza la llamada (con timeout y
   * señal externa combinados), normaliza la respuesta y traduce los fallos al
   * modelo de errores de la librería. El motor de reintentos ({@link withRetry})
   * lo invoca una o varias veces según la política configurada.
   *
   * @throws {HttpError} Si el servidor responde con un código fuera del rango 2xx.
   * @throws {NetworkError} Si la petición falla por un problema de red.
   * @throws {TimeoutError} Si la petición supera el tiempo máximo de espera.
   */
  private async performAttempt<T>(
    url: string,
    init: RequestInit,
    effective: RequestConfig,
  ): Promise<SmartFetchResponse<T>> {
    let raw: Response;
    try {
      // El timeout (y la señal externa) se gestionan en withTimeout, que inyecta
      // la señal combinada al init de la petición y traduce un plazo agotado a un
      // TimeoutError controlado.
      raw = await withTimeout(
        effective.timeout,
        effective.signal,
        (signal) => this.adapter(url, signal ? { ...init, signal } : init),
        effective,
      );
    } catch (error) {
      if (error instanceof SmartFetchError) {
        throw error;
      }
      throw new NetworkError('Error de red al intentar realizar la petición', {
        config: effective,
        cause: error,
      });
    }

    const response = await this.buildResponse<T>(raw, url, effective);

    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, {
        config: effective,
        response,
      });
    }

    return response;
  }

  /**
   * Realiza una petición `GET`.
   *
   * @typeParam T - Tipo esperado del cuerpo de la respuesta ya parseado.
   * @param url - Ruta o URL del recurso.
   * @param config - Configuración adicional de la petición.
   */
  get<T = unknown>(url: string, config: RequestConfig = {}): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  /**
   * Realiza una petición `POST`.
   *
   * @typeParam T - Tipo esperado del cuerpo de la respuesta ya parseado.
   * @param url - Ruta o URL del recurso.
   * @param body - Cuerpo a enviar. Si es un objeto plano se serializa como JSON
   *   y se añade la cabecera `Content-Type: application/json` (salvo que ya exista).
   * @param config - Configuración adicional de la petición.
   */
  post<T = unknown>(
    url: string,
    body?: unknown,
    config: RequestConfig = {},
  ): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, body });
  }

  /**
   * Realiza una petición `PUT`.
   *
   * @typeParam T - Tipo esperado del cuerpo de la respuesta ya parseado.
   * @param url - Ruta o URL del recurso.
   * @param body - Cuerpo a enviar. Si es un objeto plano se serializa como JSON
   *   y se añade la cabecera `Content-Type: application/json` (salvo que ya exista).
   * @param config - Configuración adicional de la petición.
   */
  put<T = unknown>(
    url: string,
    body?: unknown,
    config: RequestConfig = {},
  ): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, body });
  }

  /**
   * Realiza una petición `PATCH`.
   *
   * @typeParam T - Tipo esperado del cuerpo de la respuesta ya parseado.
   * @param url - Ruta o URL del recurso.
   * @param body - Cuerpo a enviar. Si es un objeto plano se serializa como JSON
   *   y se añade la cabecera `Content-Type: application/json` (salvo que ya exista).
   * @param config - Configuración adicional de la petición.
   */
  patch<T = unknown>(
    url: string,
    body?: unknown,
    config: RequestConfig = {},
  ): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'PATCH', url, body });
  }

  /**
   * Realiza una petición `DELETE`.
   *
   * No recibe cuerpo de forma posicional (lo habitual en este verbo); si se
   * necesitara enviar uno, puede pasarse mediante `config.body`.
   *
   * @typeParam T - Tipo esperado del cuerpo de la respuesta ya parseado.
   * @param url - Ruta o URL del recurso.
   * @param config - Configuración adicional de la petición.
   */
  delete<T = unknown>(url: string, config: RequestConfig = {}): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }

  /** Construye las opciones nativas (`RequestInit`) a partir de la configuración efectiva. */
  private buildRequestInit(config: RequestConfig): RequestInit {
    const headers: HeadersInit = { ...config.headers };
    const init: RequestInit = {
      method: config.method,
      headers,
    };

    // La señal (timeout + señal externa combinadas) la inyecta withTimeout al
    // ejecutar la petición; aquí no se toca `init.signal`.

    if (config.body !== undefined && config.method !== 'GET') {
      if (isPlainObject(config.body)) {
        init.body = JSON.stringify(config.body);
        if (!hasHeader(headers, 'content-type')) {
          headers['Content-Type'] = 'application/json';
        }
      } else {
        init.body = config.body as BodyInit;
      }
    }

    return init;
  }

  /** Normaliza un {@link Response} nativo en un {@link SmartFetchResponse}. */
  private async buildResponse<T>(
    raw: Response,
    url: string,
    config: RequestConfig,
  ): Promise<SmartFetchResponse<T>> {
    const data = (await this.parseBody(raw, config.responseType ?? 'json')) as T;

    const headers: Record<string, string> = {};
    raw.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      data,
      status: raw.status,
      statusText: raw.statusText,
      headers,
      ok: raw.ok,
      url: raw.url || url,
      config,
      raw,
    };
  }

  /** Interpreta el cuerpo de la respuesta según el formato solicitado. */
  private async parseBody(raw: Response, responseType: ResponseType): Promise<unknown> {
    switch (responseType) {
      case 'text':
        return raw.text();
      case 'blob':
        return raw.blob();
      case 'arrayBuffer':
        return raw.arrayBuffer();
      case 'json':
      default: {
        // Se lee como texto para tolerar cuerpos vacíos (p. ej. 204) sin que
        // `Response.json()` lance al encontrar una cadena vacía.
        const text = await raw.text();
        return text ? JSON.parse(text) : null;
      }
    }
  }
}
