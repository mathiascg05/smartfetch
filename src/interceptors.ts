/**
 * SmartFetch interceptors (aspect-oriented programming).
 *
 * An interceptor is a hook that runs before the request is sent or after the
 * response arrives, letting cross-cutting concerns — logging, authentication,
 * data transformation, error recovery — be handled centrally **without** touching
 * the client core. This is the piece that realizes aspect-oriented programming
 * (AOP) in the library.
 *
 * {@link InterceptorManager} owns the chain for one kind of interceptor (request
 * or response) and is reused by the client for both.
 *
 * @module interceptors
 */

/**
 * Handler invoked once the intercepted value is available.
 *
 * Receives the value (the request configuration or the response, depending on the
 * chain) and returns the — possibly transformed — value that continues down the
 * chain. May be asynchronous.
 *
 * @typeParam V - Type of the intercepted value.
 * @param value - Current value flowing through the chain.
 * @returns The value, transformed or not, passed to the next link.
 */
export type InterceptorFulfilled<V> = (value: V) => V | Promise<V>;

/**
 * Handler invoked when an earlier link in the chain fails.
 *
 * Allows observing the error, transforming it (by throwing another) or
 * **recovering** from it by returning a valid value, in which case the chain
 * continues as though nothing had failed.
 *
 * @param error - Error captured in a previous link.
 * @returns A recovery value, or the result of rethrowing/propagating the error.
 */
export type InterceptorRejected = (error: unknown) => unknown;

/**
 * Pair of handlers making up an interceptor: the success one and the error one.
 *
 * @typeParam V - Type of the intercepted value.
 */
export interface Interceptor<V> {
  /** Handler invoked with the available value. */
  fulfilled?: InterceptorFulfilled<V>;
  /** Handler invoked when a previous link fails. */
  rejected?: InterceptorRejected;
}

/**
 * Manages a chain of interceptors of a single kind (request or response).
 *
 * Models the ordered list of hooks the client walks to wrap the request core.
 * Registering an interceptor returns an id that can be used to remove it later;
 * removal leaves a `null` hole rather than reindexing, so ids already handed out
 * stay valid (the same approach axios takes).
 *
 * @typeParam V - Type of the value flowing through the chain (config or response).
 *
 * @example
 * const client = new SmartFetch({ baseURL: 'https://api.example.com' });
 * const id = client.interceptors.request.use((config) => {
 *   config.headers = { ...config.headers, Authorization: 'Bearer token' };
 *   return config;
 * });
 * // ...later
 * client.interceptors.request.eject(id);
 */
export class InterceptorManager<V> {
  /** Registered interceptors; a `null` hole marks one that was removed. */
  private handlers: Array<Interceptor<V> | null> = [];

  /**
   * Registers an interceptor in the chain.
   *
   * @param fulfilled - Handler receiving the value and returning the (possibly
   *   transformed) value that continues down the chain.
   * @param rejected - Optional handler dealing with a failure in a previous link.
   * @returns An id for removing the interceptor with {@link InterceptorManager.eject}.
   */
  use(fulfilled?: InterceptorFulfilled<V>, rejected?: InterceptorRejected): number {
    this.handlers.push({ fulfilled, rejected });
    return this.handlers.length - 1;
  }

  /**
   * Removes the interceptor registered under the given id.
   *
   * Leaves a `null` hole rather than reindexing, so previously handed-out ids stay
   * valid. If the id does not exist or was already removed, this is a no-op.
   *
   * @param id - Id returned by {@link InterceptorManager.use}.
   */
  eject(id: number): void {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }

  /** Removes every registered interceptor. */
  clear(): void {
    this.handlers = [];
  }

  /**
   * Walks the live interceptors in registration order, skipping removed ones.
   *
   * @param fn - Function applied to each active interceptor.
   */
  forEach(fn: (interceptor: Interceptor<V>) => void): void {
    for (const handler of this.handlers) {
      if (handler !== null) {
        fn(handler);
      }
    }
  }
}
