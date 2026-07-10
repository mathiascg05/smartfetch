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

import { HttpError, NetworkError, ParseError, SmartFetchError } from './errors.js';
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
   * @throws {HttpError} Si el servidor responde con un código de estado no aceptado.
   * @throws {NetworkError} Si la petición falla por un problema de red.
   * @throws {TimeoutError} Si la petición supera el tiempo máximo de espera.
   * @throws {ParseError} Si el cuerpo de una respuesta aceptada no puede parsearse.
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
   * @throws {HttpError} Si el servidor responde con un código de estado no aceptado.
   * @throws {NetworkError} Si la petición falla por un problema de red.
   * @throws {TimeoutError} Si la petición supera el tiempo máximo de espera.
   * @throws {ParseError} Si el cuerpo de una respuesta aceptada no puede parsearse.
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

    if (!this.isStatusAccepted(response.status, effective)) {
      throw new HttpError(response.status, response.statusText, {
        config: effective,
        response,
      });
    }

    return response;
  }

  /**
   * Determina si un código de estado HTTP debe considerarse satisfactorio.
   *
   * Usa {@link RequestConfig.validateStatus} si se proporcionó; de lo contrario,
   * acepta únicamente el rango 2xx (equivalente a `Response.ok`). Este mismo
   * criterio decide tanto el lanzamiento de {@link HttpError} como la lenidad del
   * parseo del cuerpo (un cuerpo ilegible solo lanza {@link ParseError} cuando la
   * respuesta se considera aceptada).
   *
   * @param status - Código de estado HTTP de la respuesta.
   * @param config - Configuración efectiva de la petición.
   */
  private isStatusAccepted(status: number, config: RequestConfig): boolean {
    return config.validateStatus
      ? config.validateStatus(status)
      : status >= 200 && status < 300;
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
    const data = (await this.parseBody(raw, config.responseType ?? 'json', config)) as T;

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

  /**
   * Códigos de estado que, por especificación, no llevan cuerpo. Su respuesta se
   * normaliza a `null` para todos los formatos, garantizando un comportamiento
   * uniforme (en lugar de devolver `''`, un `Blob` vacío, etc.).
   */
  private static readonly NULL_BODY_STATUSES = new Set([204, 205, 304]);

  /**
   * Interpreta el cuerpo de la respuesta según el formato solicitado.
   *
   * Los estados sin cuerpo (204/205/304) se normalizan a `null` para todos los
   * formatos. Para JSON y `formData`, un cuerpo ilegible en una respuesta
   * aceptada produce un {@link ParseError}; en una respuesta de error se tolera
   * (se devuelve el texto crudo o `null`) para que el {@link HttpError} prevalezca
   * y su cuerpo pueda inspeccionarse.
   *
   * @param raw - Respuesta nativa recibida de `fetch`.
   * @param responseType - Formato en el que interpretar el cuerpo.
   * @param config - Configuración efectiva (para decidir si el estado es aceptado).
   */
  private async parseBody(
    raw: Response,
    responseType: ResponseType,
    config: RequestConfig,
  ): Promise<unknown> {
    if (SmartFetch.NULL_BODY_STATUSES.has(raw.status)) {
      return null;
    }

    const accepted = this.isStatusAccepted(raw.status, config);

    switch (responseType) {
      case 'text':
        return raw.text();
      case 'blob':
        return raw.blob();
      case 'arrayBuffer':
        return raw.arrayBuffer();
      case 'formData':
        return this.parseGuarded(() => raw.formData(), 'formData', accepted, config);
      case 'json':
      default:
        return this.parseJson(raw, accepted, config);
    }
  }

  /**
   * Parsea el cuerpo como JSON tolerando cuerpos vacíos.
   *
   * - Cuerpo vacío → `null`.
   * - JSON válido → objeto parseado.
   * - JSON inválido en respuesta aceptada → {@link ParseError}.
   * - JSON inválido en respuesta no aceptada → se devuelve el texto crudo, de
   *   modo que el {@link HttpError} posterior prevalezca y conserve el cuerpo.
   *
   * @param raw - Respuesta nativa recibida de `fetch`.
   * @param accepted - Si el estado de la respuesta se considera satisfactorio.
   * @param config - Configuración efectiva (se adjunta al {@link ParseError}).
   */
  private async parseJson(
    raw: Response,
    accepted: boolean,
    config: RequestConfig,
  ): Promise<unknown> {
    const text = await raw.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      if (!accepted) {
        return text;
      }
      throw new ParseError('No se pudo parsear el cuerpo de la respuesta como JSON', {
        config,
        cause: error,
        responseType: 'json',
        text,
      });
    }
  }

  /**
   * Ejecuta una lectura de cuerpo que puede fallar (p. ej. `Response.formData()`)
   * y normaliza el fallo: en una respuesta aceptada lo traduce a {@link ParseError};
   * en una respuesta de error lo tolera devolviendo `null` (el cuerpo ya se ha
   * consumido y no es recuperable como texto), dejando que prevalezca el
   * {@link HttpError}.
   *
   * @param read - Operación de lectura del cuerpo.
   * @param responseType - Formato solicitado (para el {@link ParseError}).
   * @param accepted - Si el estado de la respuesta se considera satisfactorio.
   * @param config - Configuración efectiva (se adjunta al {@link ParseError}).
   */
  private async parseGuarded(
    read: () => Promise<unknown>,
    responseType: ResponseType,
    accepted: boolean,
    config: RequestConfig,
  ): Promise<unknown> {
    try {
      return await read();
    } catch (error) {
      if (!accepted) {
        return null;
      }
      throw new ParseError(
        `No se pudo parsear el cuerpo de la respuesta como ${responseType}`,
        { config, cause: error, responseType },
      );
    }
  }
}
