/**
 * SmartFetch HTTP client.
 *
 * Defines the {@link SmartFetch} class, which wraps the native `fetch` API
 * following the Adapter pattern: every request goes through an injectable
 * {@link FetchAdapter} (`globalThis.fetch` by default). The central `request()`
 * method builds the URL, performs the call, parses the response and normalizes it
 * into a {@link SmartFetchResponse}, translating failures into the library's
 * typed error model. Around that core sit the timeout, the retry engine and the
 * interceptor chain, with `get`/`post`/`put`/`patch`/`delete` as thin wrappers
 * over it.
 *
 * @module client
 */

import {
  CancelledError,
  HttpError,
  NetworkError,
  ParseError,
  SmartFetchError,
  TimeoutError,
} from './errors.js';
import type {
  FetchAdapter,
  HeadersInit,
  HttpMethod,
  RequestConfig,
  ResponseType,
  SmartFetchOptions,
  SmartFetchResponse,
} from './types.js';
import { isAbortError, withTimeout } from './timeout.js';
import { defaultShouldRetry, withRetry } from './retry/retry.js';
import { InterceptorManager } from './interceptors.js';
import { buildURL } from './url.js';

/**
 * Whether a value is a plain object worth serializing as JSON (rules out the body
 * types `fetch` already knows how to handle natively).
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
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Whether a request body can be sent more than once.
 *
 * Retrying re-sends the same `RequestInit`, so the body must survive being read
 * again. Strings, plain objects (serialized to JSON), `URLSearchParams`, `Blob`,
 * `ArrayBuffer`, typed arrays and `FormData` all can: `fetch` re-reads them from
 * memory. A `ReadableStream` cannot — the first attempt drains it — and neither
 * can an async iterable.
 *
 * Rebuilding the `RequestInit` per attempt would not help: it reads `config.body`
 * again and hands over the very same, already-drained stream object.
 */
function isReplayableBody(body: unknown): boolean {
  if (body === undefined || body === null) {
    return true;
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return false;
  }
  // Async iterables (including Node streams) are single-pass too.
  return !(typeof body === 'object' && Symbol.asyncIterator in (body as Record<symbol, unknown>));
}

/**
 * Extracts every `Set-Cookie` header without collapsing repeats.
 *
 * A server may send `Set-Cookie` several times, and folding those into a flat
 * record keeps only the last one. `Headers.getSetCookie()` is the API designed for
 * exactly this and is used when available (Node 18.14+, modern browsers).
 *
 * The fallback returns whatever the single-value getter reports. Joined cookies
 * are deliberately **not** split on commas: `Expires` dates contain commas, so
 * splitting corrupts the values. Returning one entry is lossy but never wrong.
 */
function readSetCookie(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') {
    return withGetter.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single === null ? [] : [single];
}

/**
 * Native `RequestInit` options forwarded verbatim when the caller sets them.
 *
 * They are pure passthrough: SmartFetch neither interprets nor defaults them, so
 * a request without them behaves exactly like plain `fetch`.
 */
const PASSTHROUGH_OPTIONS = [
  'credentials',
  'mode',
  'cache',
  'redirect',
  'keepalive',
  'referrerPolicy',
  'integrity',
] as const satisfies readonly (keyof RequestConfig & keyof RequestInit)[];

/**
 * Methods that never carry a request body.
 *
 * `GET` and `HEAD` are body-less by specification; `OPTIONS` may technically carry
 * one, but doing so is so rarely supported by servers that sending it silently
 * would surprise more than it helps.
 */
const BODYLESS_REQUEST_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>([
  'GET',
  'HEAD',
  'OPTIONS',
]);

/** Looks up a header by name, case-insensitively. */
function hasHeader(headers: HeadersInit, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

/**
 * Merges two header sets case-insensitively.
 *
 * HTTP header names are case-insensitive, so `content-type` and `Content-Type`
 * are the same header. A plain object spread would keep both keys and `fetch`
 * would send them as a single comma-joined value, which is almost never what the
 * caller meant.
 *
 * `override` wins, and the header is emitted **with the capitalization the winning
 * side wrote** rather than being canonicalized: it is the least surprising
 * behaviour and keeps working against servers that expect a particular spelling.
 *
 * @param base - Lower-precedence headers (the client defaults).
 * @param override - Higher-precedence headers (the request's own).
 */
function mergeHeaders(base: HeadersInit = {}, override: HeadersInit = {}): HeadersInit {
  const merged: HeadersInit = {};
  /** Maps the lowercase name to the key currently emitted for it. */
  const emittedFor = new Map<string, string>();

  const put = (name: string, value: string): void => {
    const lower = name.toLowerCase();
    const previous = emittedFor.get(lower);
    if (previous !== undefined) {
      delete merged[previous];
    }
    emittedFor.set(lower, name);
    merged[name] = value;
  };

  for (const [name, value] of Object.entries(base)) {
    put(name, value);
  }
  for (const [name, value] of Object.entries(override)) {
    put(name, value);
  }

  return merged;
}

/**
 * Checks that what came out of the request interceptor chain is still a usable
 * configuration.
 *
 * Forgetting the `return` in a request interceptor is the easiest mistake to make,
 * and without this guard it surfaced as a bare `TypeError` from the internals
 * ("Cannot read properties of undefined") — outside the library's error model and
 * with no hint of what to fix.
 *
 * @param value - Value produced by the last request interceptor.
 * @throws {SmartFetchError} With `type: 'request'` when the contract was broken.
 */
function assertRequestConfig(value: unknown): RequestConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SmartFetchError(
      'A request interceptor must return the config object it received ' +
        `(got ${value === null ? 'null' : typeof value}). Did you forget the return statement?`,
      { type: 'request' },
    );
  }
  return value;
}

/**
 * High-level HTTP client built on top of the native `fetch`.
 *
 * @example
 * const client = new SmartFetch({ baseURL: 'https://api.example.com' });
 * const { data } = await client.get<User[]>('/users');
 */
export class SmartFetch {
  /** Default configuration applied to every request. */
  private readonly defaults: RequestConfig;

  /**
   * Adapter injected by the caller, if any (Adapter pattern). When absent, the
   * global `fetch` is resolved per request by {@link SmartFetch.resolveAdapter}.
   */
  private readonly injectedFetch?: FetchAdapter;

  /**
   * Request and response interceptors (aspect-oriented hooks).
   *
   * - `request`: transform the {@link RequestConfig} **before** the URL is built
   *   and the request is sent (adding auth headers, for instance).
   * - `response`: transform the {@link SmartFetchResponse} once received, and
   *   their error handlers can observe or **recover from** a failure.
   *
   * @example
   * client.interceptors.request.use((config) => {
   *   config.headers = { ...config.headers, Authorization: 'Bearer token' };
   *   return config;
   * });
   */
  readonly interceptors = {
    /** Chain applied to the {@link RequestConfig} before the request is sent. */
    request: new InterceptorManager<RequestConfig>(),
    /** Chain applied to the {@link SmartFetchResponse} once it arrives. */
    response: new InterceptorManager<SmartFetchResponse>(),
  };

  /**
   * @param defaults - Default configuration merged into every request.
   * @param options - Client-level options (the `fetch` to inject, for instance).
   */
  constructor(defaults: RequestConfig = {}, options: SmartFetchOptions = {}) {
    this.defaults = defaults;
    this.injectedFetch = options.fetch;
  }

  /**
   * Resolves the adapter to use for a request.
   *
   * The global `fetch` is looked up **per request**, not in the constructor, so
   * that merely constructing a client — including the default {@link smartfetch}
   * singleton built when this library is imported — never throws on a runtime
   * without a global `fetch`. That runtime is precisely where a caller would want
   * to inject their own adapter, and an eager check never gave them the chance.
   * A late-loaded polyfill is picked up for the same reason.
   *
   * @throws {SmartFetchError} With `type: 'request'` when no `fetch` is available.
   */
  private resolveAdapter(): FetchAdapter {
    if (this.injectedFetch) {
      return this.injectedFetch;
    }
    const globalFetch = globalThis.fetch as FetchAdapter | undefined;
    if (typeof globalFetch !== 'function') {
      throw new SmartFetchError(
        'No fetch implementation available. Use Node 18+ or inject one via options.fetch.',
        { type: 'request' },
      );
    }
    // Bind the global fetch to globalThis to avoid "Illegal invocation".
    return globalFetch.bind(globalThis);
  }

  /**
   * Performs an arbitrary HTTP request and returns the normalized response.
   *
   * @typeParam T - Expected type of the parsed response body.
   * @param config - Request configuration (merged with the client defaults).
   * @throws {HttpError} If the server responds with a status code that is not accepted.
   * @throws {NetworkError} If the request fails at the transport level.
   * @throws {TimeoutError} If the request exceeds its deadline.
   * @throws {ParseError} If the body of an accepted response cannot be parsed.
   */
  async request<T = unknown>(config: RequestConfig): Promise<SmartFetchResponse<T>> {
    const effective = this.mergeConfig(config);

    // Builds the aspect-oriented chain:
    //   [request interceptors] -> core (dispatch) -> [response interceptors]
    // Each link is an [onFulfilled, onRejected] pair chained with `.then(...)`,
    // just like axios. This way interceptors wrap the core without the core ever
    // knowing they exist.
    const chain: Array<[unknown, unknown]> = [];

    // Request interceptors run in REVERSE registration order (LIFO): the last one
    // registered is the first to transform the config.
    this.interceptors.request.forEach((interceptor) => {
      chain.unshift([interceptor.fulfilled, interceptor.rejected]);
    });

    // Request core: receives the intercepted config and returns the response. The
    // config is validated here, at the boundary between caller-supplied
    // interceptors and the internals, so a broken interceptor fails inside the
    // library's error model instead of as a TypeError deeper down.
    chain.push([
      (cfg: unknown): Promise<SmartFetchResponse<T>> => this.dispatch<T>(assertRequestConfig(cfg)),
      undefined,
    ]);

    // Response interceptors run in registration order (FIFO).
    this.interceptors.response.forEach((interceptor) => {
      chain.push([interceptor.fulfilled, interceptor.rejected]);
    });

    // The value flowing through the chain changes type (RequestConfig -> response)
    // as it passes through the core, so an untyped promise is threaded through and
    // the final type is reasserted on return (same approach axios takes).
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
   * Merges the client defaults with a specific request configuration, giving the
   * latter precedence and combining the headers of both.
   *
   * @param config - Request-specific configuration.
   * @returns The effective configuration the request will run with.
   */
  private mergeConfig(config: RequestConfig): RequestConfig {
    const merged: RequestConfig = {
      ...this.defaults,
      ...config,
      method: config.method ?? this.defaults.method ?? 'GET',
      // `headers` and `params` are the only fields merged in depth; a plain spread
      // would drop client-level defaults (an API key in `params`, for instance)
      // the moment a request brought its own.
      headers: mergeHeaders(this.defaults.headers, config.headers),
    };

    if (this.defaults.params ?? config.params) {
      merged.params = { ...this.defaults.params, ...config.params };
    }

    return merged;
  }

  /**
   * Request core: builds the URL and the native options once, then runs the
   * attempt (with retries and timeout). This is the central link interceptors
   * wrap around.
   *
   * @typeParam T - Expected type of the parsed response body.
   * @param effective - Effective configuration (already merged and intercepted).
   */
  private dispatch<T>(effective: RequestConfig): Promise<SmartFetchResponse<T>> {
    const retries = effective.retries ?? 0;

    // A single-pass body cannot survive a second attempt, and the failure would
    // otherwise show up as an opaque runtime error on the retry — or worse, as a
    // silently empty body. Refusing up front, before touching the network, is the
    // only honest option.
    if (retries > 0 && !isReplayableBody(effective.body)) {
      return Promise.reject(
        new SmartFetchError(
          'A stream body cannot be retried: the first attempt consumes it. ' +
            'Set retries to 0 for this request, or buffer the stream into a string, ' +
            'Blob or ArrayBuffer first.',
          { type: 'request', config: effective },
        ),
      );
    }

    const totalTimeout = effective.totalTimeout ?? 0;
    if (totalTimeout <= 0) {
      return this.runAttempts<T>(effective, retries);
    }

    // A global deadline needs its own controller so that it can cut the operation
    // at any point — mid-attempt or mid-backoff — rather than only bounding each
    // attempt the way `timeout` does.
    const controller = new AbortController();

    // The deadline aborts with a sentinel of its own instead of setting a flag. A
    // flag only says "the timer fired", not "the timer caused this error", so a
    // real failure arriving after the deadline got relabelled as a timeout with the
    // genuine error buried in `cause`.
    //
    // Ownership is then read off our own controller — `signal.reason` is whatever
    // aborted it first — rather than off the error's `cause`. That keeps the check
    // independent of the adapter: a custom `fetch` that rejects with an AbortError
    // of its own making, instead of propagating `signal.reason` the way the spec
    // requires, would break a cause-based check.
    //
    // The sentinel is still named `AbortError` so that a spec-compliant adapter
    // rejecting with it lands in `isAbortError` as a cancellation, not a transport
    // failure.
    const deadlineReason = Object.assign(new Error(`totalTimeout of ${totalTimeout} ms elapsed`), {
      name: 'AbortError',
    });

    const onExternalAbort = () => controller.abort(effective.signal?.reason);
    if (effective.signal) {
      if (effective.signal.aborted) {
        controller.abort(effective.signal.reason);
      } else {
        effective.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    const timer = setTimeout(() => controller.abort(deadlineReason), totalTimeout);

    // The composed signal replaces the original for the whole run, so both the
    // per-attempt timeout and the backoff waits honour the global deadline.
    return this.runAttempts<T>({ ...effective, signal: controller.signal }, retries)
      .catch((error: unknown) => {
        // Only a cancellation this deadline actually caused becomes a
        // TimeoutError. Anything else — an HTTP error, a transport failure, an
        // external cancellation — propagates untouched.
        // Both halves matter: the deadline must have been what aborted the
        // controller, *and* the error must be a cancellation. A 404 that arrives
        // after the deadline satisfies the first but not the second.
        if (controller.signal.reason === deadlineReason && error instanceof CancelledError) {
          throw new TimeoutError(totalTimeout, { config: effective, cause: error });
        }
        throw error;
      })
      .finally(() => {
        clearTimeout(timer);
        if (effective.signal) {
          effective.signal.removeEventListener('abort', onExternalAbort);
        }
      });
  }

  /**
   * Runs the attempt loop for an already-prepared configuration.
   *
   * Split out of {@link SmartFetch.dispatch} so that the global-deadline path can
   * reuse it with a composed signal.
   *
   * @typeParam T - Expected type of the parsed response body.
   * @param effective - Effective configuration, with its final `signal`.
   * @param retries - Retry budget for this request.
   */
  private runAttempts<T>(
    effective: RequestConfig,
    retries: number,
  ): Promise<SmartFetchResponse<T>> {
    // URL and native options are built once and reused across attempts (the retry
    // engine re-runs performAttempt, not this).
    const url = buildURL(effective);
    const init = this.buildRequestInit(effective);
    const adapter = this.resolveAdapter();

    return withRetry(
      (): Promise<SmartFetchResponse<T>> => this.performAttempt<T>(adapter, url, init, effective),
      {
        retries,
        backoff: effective.backoff,
        shouldRetry: effective.retryOn ?? defaultShouldRetry,
        signal: effective.signal,
        maxRetryAfterMs: effective.maxRetryAfterMs,
      },
    );
  }

  /**
   * Runs a single attempt of the request: performs the call (with the timeout and
   * external signal combined), normalizes the response and translates failures
   * into the library's error model. The retry engine ({@link withRetry}) invokes
   * it one or more times according to the configured policy.
   *
   * @throws {HttpError} If the server responds with a status code that is not accepted.
   * @throws {NetworkError} If the request fails at the transport level.
   * @throws {TimeoutError} If the request exceeds its deadline.
   * @throws {ParseError} If the body of an accepted response cannot be parsed.
   */
  private async performAttempt<T>(
    adapter: FetchAdapter,
    url: string,
    init: RequestInit,
    effective: RequestConfig,
  ): Promise<SmartFetchResponse<T>> {
    let raw: Response;
    try {
      // The timeout (and the external signal) are handled by withTimeout, which
      // injects the combined signal into the request init and translates an
      // expired deadline into a typed TimeoutError.
      raw = await withTimeout(
        effective.timeout,
        effective.signal,
        (signal) => adapter(url, signal ? { ...init, signal } : init),
        effective,
      );
    } catch (error) {
      // A deadline that expired already arrived here as a TimeoutError.
      if (error instanceof SmartFetchError) {
        throw error;
      }
      // Any remaining abort is caller-driven: the external signal fired. It is a
      // cancellation, not a transport failure, so it must not be retried.
      if (isAbortError(error)) {
        throw new CancelledError(undefined, { config: effective, cause: error });
      }
      throw new NetworkError('Network error while performing the request', {
        config: effective,
        cause: error,
      });
    }

    // Reading the body is a second trip over the network and can fail on its own:
    // a socket cut mid-response rejects here, not above. Without this guard that
    // failure escaped as a bare `TypeError: terminated`, outside the error model
    // and invisible to the retry policy — even though a truncated response is
    // exactly the kind of transient fault worth retrying.
    let response: SmartFetchResponse<T>;
    try {
      response = await this.buildResponse<T>(raw, url, effective);
    } catch (error) {
      // A ParseError raised by parseBody is already part of the model.
      if (error instanceof SmartFetchError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new CancelledError(undefined, { config: effective, cause: error });
      }
      throw new NetworkError('The connection closed before the response body was fully read', {
        config: effective,
        cause: error,
      });
    }

    if (!this.isStatusAccepted(response.status, effective)) {
      throw new HttpError(response.status, response.statusText, {
        config: effective,
        response,
      });
    }

    return response;
  }

  /**
   * Decides whether an HTTP status code counts as successful.
   *
   * Uses {@link RequestConfig.validateStatus} when provided; otherwise accepts
   * only the 2xx range (equivalent to `Response.ok`). The same criterion drives
   * both throwing {@link HttpError} and how lenient body parsing is — an
   * unreadable body only throws {@link ParseError} when the response is accepted.
   *
   * @param status - HTTP status code of the response.
   * @param config - Effective request configuration.
   */
  private isStatusAccepted(status: number, config: RequestConfig): boolean {
    return config.validateStatus ? config.validateStatus(status) : status >= 200 && status < 300;
  }

  /**
   * Performs a `GET` request.
   *
   * @typeParam T - Expected type of the parsed response body.
   * @param url - Path or URL of the resource.
   * @param config - Extra request configuration.
   */
  get<T = unknown>(url: string, config: RequestConfig = {}): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  /**
   * Performs a `POST` request.
   *
   * @typeParam T - Expected type of the parsed response body.
   * @param url - Path or URL of the resource.
   * @param body - Payload to send. Plain objects are serialized as JSON and the
   *   `Content-Type: application/json` header is added unless one is already set.
   * @param config - Extra request configuration.
   */
  post<T = unknown>(
    url: string,
    body?: unknown,
    config: RequestConfig = {},
  ): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, body });
  }

  /**
   * Performs a `PUT` request.
   *
   * @typeParam T - Expected type of the parsed response body.
   * @param url - Path or URL of the resource.
   * @param body - Payload to send. Plain objects are serialized as JSON and the
   *   `Content-Type: application/json` header is added unless one is already set.
   * @param config - Extra request configuration.
   */
  put<T = unknown>(
    url: string,
    body?: unknown,
    config: RequestConfig = {},
  ): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, body });
  }

  /**
   * Performs a `PATCH` request.
   *
   * @typeParam T - Expected type of the parsed response body.
   * @param url - Path or URL of the resource.
   * @param body - Payload to send. Plain objects are serialized as JSON and the
   *   `Content-Type: application/json` header is added unless one is already set.
   * @param config - Extra request configuration.
   */
  patch<T = unknown>(
    url: string,
    body?: unknown,
    config: RequestConfig = {},
  ): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'PATCH', url, body });
  }

  /**
   * Performs a `DELETE` request.
   *
   * Takes no positional body, as is customary for this verb; if one is needed it
   * can be passed through `config.body`.
   *
   * @typeParam T - Expected type of the parsed response body.
   * @param url - Path or URL of the resource.
   * @param config - Extra request configuration.
   */
  delete<T = unknown>(url: string, config: RequestConfig = {}): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }

  /**
   * Performs a `HEAD` request.
   *
   * A `HEAD` response carries headers but never a body, so `data` is always
   * `null` regardless of {@link RequestConfig.responseType}.
   *
   * @param url - Path or URL of the resource.
   * @param config - Extra request configuration.
   */
  head(url: string, config: RequestConfig = {}): Promise<SmartFetchResponse<null>> {
    return this.request<null>({ ...config, method: 'HEAD', url });
  }

  /**
   * Performs an `OPTIONS` request.
   *
   * Unlike `HEAD`, an `OPTIONS` response may carry a body, so it is parsed like
   * any other. The request itself never carries one.
   *
   * @typeParam T - Expected type of the parsed response body.
   * @param url - Path or URL of the resource.
   * @param config - Extra request configuration.
   */
  options<T = unknown>(url: string, config: RequestConfig = {}): Promise<SmartFetchResponse<T>> {
    return this.request<T>({ ...config, method: 'OPTIONS', url });
  }

  /** Builds the native options (`RequestInit`) from the effective configuration. */
  private buildRequestInit(config: RequestConfig): RequestInit {
    const headers: HeadersInit = { ...config.headers };
    const init: RequestInit = {
      method: config.method,
      headers,
    };

    // The signal (timeout + external signal combined) is injected by withTimeout
    // when the request runs; `init.signal` is deliberately left untouched here.

    // Native RequestInit options are forwarded only when the caller set them.
    // Copying them unconditionally would pin defaults of our own on top of the
    // ones `fetch` already defines, changing behaviour nobody asked us to change.
    for (const option of PASSTHROUGH_OPTIONS) {
      const value = config[option];
      if (value !== undefined) {
        Object.assign(init, { [option]: value });
      }
    }

    // GET, HEAD and OPTIONS never carry a request body. `mergeConfig` always sets
    // `method`, so no fallback is needed here; a `Set.has(undefined)` would be
    // `false` anyway, matching the previous behaviour.
    if (config.body !== undefined && !BODYLESS_REQUEST_METHODS.has(config.method as HttpMethod)) {
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

  /** Normalizes a native {@link Response} into a {@link SmartFetchResponse}. */
  private async buildResponse<T>(
    raw: Response,
    url: string,
    config: RequestConfig,
  ): Promise<SmartFetchResponse<T>> {
    const data = (await this.parseBody(raw, config.responseType ?? 'json', config)) as T;

    const headers: Record<string, string> = {};
    raw.headers.forEach((value, key) => {
      // `set-cookie` is deliberately left out: a flat record cannot represent a
      // header sent more than once, and folding it would quietly hand back only
      // the last cookie. An absent key is better than one that lies — the full
      // list lives in `setCookie`.
      if (key.toLowerCase() !== 'set-cookie') {
        headers[key] = value;
      }
    });

    return {
      data,
      status: raw.status,
      statusText: raw.statusText,
      headers,
      setCookie: readSetCookie(raw.headers),
      ok: raw.ok,
      url: raw.url || url,
      config,
      raw,
    };
  }

  /**
   * Status codes that carry no body by specification. Their response is normalized
   * to `null` across every format, guaranteeing uniform behaviour instead of
   * returning `''`, an empty `Blob`, and so on.
   */
  private static readonly NULL_BODY_STATUSES = new Set([204, 205, 304]);

  /**
   * Reads the response body in the requested format.
   *
   * Body-less statuses (204/205/304) normalize to `null` across every format. For
   * JSON and `formData`, an unreadable body on an accepted response raises a
   * {@link ParseError}; on an error response it is tolerated (the raw text or
   * `null` is returned) so that the {@link HttpError} prevails and its body stays
   * inspectable.
   *
   * @param raw - Native response received from `fetch`.
   * @param responseType - Format to read the body as.
   * @param config - Effective configuration (used to decide whether the status is accepted).
   */
  private async parseBody(
    raw: Response,
    responseType: ResponseType,
    config: RequestConfig,
  ): Promise<unknown> {
    // A HEAD response carries headers but no body, whatever its status says. This
    // has to key off the method, not the status: a HEAD answering 200 with a
    // Content-Length would otherwise take the normal path — which happens to work
    // for JSON (an empty text parses to null) but would yield an empty Blob for
    // `blob` and a ParseError for `formData`.
    if (config.method === 'HEAD' || SmartFetch.NULL_BODY_STATUSES.has(raw.status)) {
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
   * Parses the body as JSON, tolerating empty bodies.
   *
   * - Empty body → `null`.
   * - Valid JSON → parsed object.
   * - Invalid JSON on an accepted response → {@link ParseError}.
   * - Invalid JSON on a rejected response → the raw text is returned, so that the
   *   {@link HttpError} that follows prevails and keeps the body.
   *
   * @param raw - Native response received from `fetch`.
   * @param accepted - Whether the response status counts as successful.
   * @param config - Effective configuration (attached to the {@link ParseError}).
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
      throw new ParseError('Could not parse the response body as JSON', {
        config,
        cause: error,
        responseType: 'json',
        text,
      });
    }
  }

  /**
   * Runs a body read that may fail (`Response.formData()`, for instance) and
   * normalizes the failure: on an accepted response it becomes a
   * {@link ParseError}; on an error response it is tolerated by returning `null`
   * (the body has already been consumed and is not recoverable as text), letting
   * the {@link HttpError} prevail.
   *
   * @param read - Body read operation.
   * @param responseType - Requested format (for the {@link ParseError}).
   * @param accepted - Whether the response status counts as successful.
   * @param config - Effective configuration (attached to the {@link ParseError}).
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
      throw new ParseError(`Could not parse the response body as ${responseType}`, {
        config,
        cause: error,
        responseType,
      });
    }
  }
}
