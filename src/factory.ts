/**
 * Fábrica y constructor fluido de clientes SmartFetch.
 *
 * Este módulo materializa dos patrones de diseño valorados por el proyecto:
 *
 * - **Factory** — {@link createClient} crea instancias de {@link SmartFetch} sin
 *   que quien la consume tenga que usar `new` ni conocer el orden de argumentos
 *   del constructor.
 * - **Builder** — {@link SmartFetchBuilder} permite componer la configuración
 *   de un cliente paso a paso mediante una interfaz encadenable (fluent API) y
 *   materializarla al final con {@link SmartFetchBuilder.build}.
 *
 * Ninguno de los dos reimplementa la fusión de configuración: se limitan a armar
 * el {@link RequestConfig} por defecto y las {@link SmartFetchOptions} que recibe
 * el constructor de {@link SmartFetch}; el propio cliente ya fusiona esos valores
 * por defecto con los de cada petición.
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
 * Crea un cliente {@link SmartFetch} con una configuración por defecto.
 *
 * Envoltura fina sobre el constructor (patrón Factory): evita el uso directo de
 * `new` y da un punto de creación único y estable para la librería.
 *
 * @param defaults - Configuración por defecto aplicada a todas las peticiones del cliente.
 * @param options - Opciones a nivel de cliente (por ejemplo, un `fetch` inyectado).
 * @returns Una nueva instancia de {@link SmartFetch}.
 *
 * @example
 * ```ts
 * const api = createClient({ baseURL: 'https://api.ejemplo.com', timeout: 5000 });
 * const { data } = await api.get('/usuarios');
 * ```
 */
export function createClient(
  defaults: RequestConfig = {},
  options: SmartFetchOptions = {},
): SmartFetch {
  return new SmartFetch(defaults, options);
}

/**
 * Constructor fluido de clientes {@link SmartFetch} (patrón Builder).
 *
 * Acumula, mediante métodos encadenables, la configuración por defecto y las
 * opciones del cliente, y produce la instancia final al llamar a {@link build}.
 * Cada método devuelve `this`, de modo que las llamadas pueden encadenarse.
 *
 * @example
 * ```ts
 * const api = new SmartFetchBuilder()
 *   .baseURL('https://api.ejemplo.com')
 *   .header('Authorization', 'Bearer token')
 *   .timeout(5000)
 *   .retries(2)
 *   .backoff(new ExponentialBackoff())
 *   .build();
 * ```
 */
export class SmartFetchBuilder {
  /** Configuración por defecto acumulada para el cliente. */
  private readonly config: RequestConfig = {};

  /** Opciones a nivel de cliente acumuladas. */
  private readonly options: SmartFetchOptions = {};

  /**
   * Fija la URL base que se antepondrá a la ruta de cada petición.
   *
   * @param url - URL base (por ejemplo, `"https://api.ejemplo.com/v1"`).
   * @returns El propio builder, para encadenar.
   */
  baseURL(url: string): this {
    this.config.baseURL = url;
    return this;
  }

  /**
   * Añade (o sobrescribe) una única cabecera por defecto.
   *
   * @param name - Nombre de la cabecera.
   * @param value - Valor de la cabecera.
   * @returns El propio builder, para encadenar.
   */
  header(name: string, value: string): this {
    this.config.headers = { ...this.config.headers, [name]: value };
    return this;
  }

  /**
   * Fusiona un conjunto de cabeceras por defecto con las ya acumuladas.
   *
   * @param headers - Cabeceras a fusionar (las claves repetidas se sobrescriben).
   * @returns El propio builder, para encadenar.
   */
  headers(headers: HeadersInit): this {
    this.config.headers = { ...this.config.headers, ...headers };
    return this;
  }

  /**
   * Fija el tiempo máximo de espera, en milisegundos, antes de cancelar la petición.
   *
   * @param ms - Milisegundos de timeout (`0` significa sin límite).
   * @returns El propio builder, para encadenar.
   */
  timeout(ms: number): this {
    this.config.timeout = ms;
    return this;
  }

  /**
   * Fija el número de reintentos adicionales ante errores de red o HTTP 5xx.
   *
   * @param count - Número de reintentos (`0` = un único intento).
   * @returns El propio builder, para encadenar.
   */
  retries(count: number): this {
    this.config.retries = count;
    return this;
  }

  /**
   * Fija la estrategia de espera entre reintentos (patrón Strategy).
   *
   * @param strategy - Estrategia de backoff a utilizar.
   * @returns El propio builder, para encadenar.
   */
  backoff(strategy: BackoffStrategy): this {
    this.config.backoff = strategy;
    return this;
  }

  /**
   * Fija el predicado que decide, ante un error, si la petición debe reintentarse.
   *
   * @param predicate - Predicado de reintento.
   * @returns El propio builder, para encadenar.
   */
  retryOn(predicate: RetryPredicate): this {
    this.config.retryOn = predicate;
    return this;
  }

  /**
   * Fija el formato en el que se interpretará el cuerpo de la respuesta.
   *
   * @param type - Tipo de respuesta (`json`, `text`, `blob`, etc.).
   * @returns El propio builder, para encadenar.
   */
  responseType(type: ResponseType): this {
    this.config.responseType = type;
    return this;
  }

  /**
   * Fija la función que decide qué códigos de estado HTTP se consideran válidos.
   *
   * @param fn - Recibe el código de estado y devuelve `true` para aceptarlo.
   * @returns El propio builder, para encadenar.
   */
  validateStatus(fn: (status: number) => boolean): this {
    this.config.validateStatus = fn;
    return this;
  }

  /**
   * Inyecta una implementación de `fetch` propia (patrón Adapter).
   *
   * Útil para polyfills o para mockear la red en pruebas sin tocar el `fetch` global.
   *
   * @param fetchImpl - Implementación de `fetch` a utilizar.
   * @returns El propio builder, para encadenar.
   */
  adapter(fetchImpl: FetchAdapter): this {
    this.options.fetch = fetchImpl;
    return this;
  }

  /**
   * Materializa la configuración acumulada en una instancia de {@link SmartFetch}.
   *
   * @returns El cliente construido.
   */
  build(): SmartFetch {
    return createClient(this.config, this.options);
  }
}
