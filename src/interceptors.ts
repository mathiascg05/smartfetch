/**
 * Interceptores de SmartFetch (Programación Orientada a Aspectos).
 *
 * Un interceptor es un enganche (*hook*) que se ejecuta antes de enviar la
 * petición o después de recibir la respuesta, permitiendo tratar de forma
 * centralizada preocupaciones transversales (*cross-cutting concerns*) como el
 * registro (logging), la autenticación, la transformación de datos o la
 * recuperación ante errores, **sin** modificar el núcleo del cliente. Esta es la
 * pieza que materializa la Programación Orientada a Aspectos (AOP) en la librería.
 *
 * {@link InterceptorManager} administra la cadena de interceptores de un tipo
 * concreto (petición o respuesta) y es reutilizado por el cliente para ambos.
 *
 * @module interceptors
 */

/**
 * Función que se ejecuta cuando el valor interceptado está disponible.
 *
 * Recibe el valor (la configuración de la petición o la respuesta, según la
 * cadena) y devuelve el valor —posiblemente transformado— que continuará por la
 * cadena. Puede ser asíncrona.
 *
 * @typeParam V - Tipo del valor interceptado.
 * @param value - Valor actual que fluye por la cadena.
 * @returns El valor (transformado o no) que se pasará al siguiente eslabón.
 */
export type InterceptorFulfilled<V> = (value: V) => V | Promise<V>;

/**
 * Función que se ejecuta cuando un eslabón anterior de la cadena falla.
 *
 * Permite observar el error, transformarlo (relanzando otro) o **recuperarse**
 * de él devolviendo un valor válido, en cuyo caso la cadena continúa como si no
 * hubiera fallado.
 *
 * @param error - Error capturado en un eslabón previo.
 * @returns Un valor de recuperación, o el resultado de relanzar/propagar el error.
 */
export type InterceptorRejected = (error: unknown) => unknown;

/**
 * Par de manejadores que componen un interceptor: el de éxito y el de error.
 *
 * @typeParam V - Tipo del valor interceptado.
 */
export interface Interceptor<V> {
  /** Manejador que se ejecuta con el valor disponible. */
  fulfilled?: InterceptorFulfilled<V>;
  /** Manejador que se ejecuta ante un fallo en un eslabón previo. */
  rejected?: InterceptorRejected;
}

/**
 * Administra una cadena de interceptores de un mismo tipo (petición o respuesta).
 *
 * Modela una lista ordenada de enganches que el cliente recorre para envolver el
 * núcleo de la petición. Registrar un interceptor devuelve un identificador que
 * permite eliminarlo más tarde; la eliminación deja un hueco `null` en lugar de
 * reindexar, de modo que los identificadores ya entregados siguen siendo válidos
 * (mismo criterio que axios).
 *
 * @typeParam V - Tipo del valor que fluye por la cadena (config o respuesta).
 *
 * @example
 * const client = new SmartFetch({ baseURL: 'https://api.ejemplo.com' });
 * const id = client.interceptors.request.use((config) => {
 *   config.headers = { ...config.headers, Authorization: 'Bearer token' };
 *   return config;
 * });
 * // ...más tarde
 * client.interceptors.request.eject(id);
 */
export class InterceptorManager<V> {
  /** Interceptores registrados; un hueco `null` marca uno ya eliminado. */
  private handlers: Array<Interceptor<V> | null> = [];

  /**
   * Registra un interceptor en la cadena.
   *
   * @param fulfilled - Manejador que recibe el valor y devuelve el (posiblemente
   *   transformado) valor que continúa por la cadena.
   * @param rejected - Manejador opcional que atiende un fallo de un eslabón previo.
   * @returns Un identificador para eliminar el interceptor con {@link InterceptorManager.eject}.
   */
  use(fulfilled?: InterceptorFulfilled<V>, rejected?: InterceptorRejected): number {
    this.handlers.push({ fulfilled, rejected });
    return this.handlers.length - 1;
  }

  /**
   * Elimina el interceptor asociado al identificador dado.
   *
   * Deja un hueco `null` en lugar de reindexar, para no invalidar los
   * identificadores previamente entregados. Si el identificador no existe o ya
   * fue eliminado, la operación no tiene efecto.
   *
   * @param id - Identificador devuelto por {@link InterceptorManager.use}.
   */
  eject(id: number): void {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }

  /** Elimina todos los interceptores registrados. */
  clear(): void {
    this.handlers = [];
  }

  /**
   * Recorre los interceptores vivos en su orden de registro, omitiendo los que
   * ya fueron eliminados.
   *
   * @param fn - Función a aplicar a cada interceptor activo.
   */
  forEach(fn: (interceptor: Interceptor<V>) => void): void {
    for (const handler of this.handlers) {
      if (handler !== null) {
        fn(handler);
      }
    }
  }
}
