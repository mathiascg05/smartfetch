/**
 * SmartFetch error model.
 *
 * Defines a hierarchy of typed errors that lets consumers tell precisely why a
 * request failed — the deadline expired, the network was unreachable, the server
 * answered with an unsuccessful status, or the body could not be parsed — and
 * react accordingly. Every error extends {@link SmartFetchError}, so they can be
 * caught generically or narrowed to a specific case.
 *
 * @module errors
 */

import type { RequestConfig, ResponseType, SmartFetchResponse } from './types.js';

/**
 * Category a {@link SmartFetchError} belongs to.
 *
 * - `timeout`: the request exceeded its deadline.
 * - `network`: a transport failure (unreachable server, offline, DNS, ...).
 * - `http`: the server responded with an unsuccessful status code.
 * - `parse`: the body of a successful response could not be read in the requested
 *   format (malformed JSON, for instance).
 * - `request`: the request could not be built or configured.
 * - `unknown`: unclassified cause.
 */
export type SmartFetchErrorType = 'timeout' | 'network' | 'http' | 'parse' | 'request' | 'unknown';

/**
 * Options shared by every {@link SmartFetchError}.
 */
export interface SmartFetchErrorOptions {
  /** Error category. Defaults to `"unknown"`. */
  type?: SmartFetchErrorType;
  /** Configuration the request was using when the error occurred. */
  config?: RequestConfig;
  /** Original error or value that caused this one (preserves the cause chain). */
  cause?: unknown;
}

/**
 * Base error of the library. Every other typed error extends it.
 *
 * Captures the failure category and, optionally, the request configuration and
 * the original cause, keeping the prototype chain intact so that `instanceof`
 * works against both the base class and its subclasses.
 *
 * @example
 * try {
 *   await client.get('/users');
 * } catch (error) {
 *   if (error instanceof SmartFetchError) {
 *     console.error(error.type, error.message);
 *   }
 * }
 */
export class SmartFetchError extends Error {
  /** Error category. */
  readonly type: SmartFetchErrorType;

  /** Configuration of the request tied to this error, when available. */
  readonly config?: RequestConfig;

  /** Original cause of the error, if any. */
  readonly cause?: unknown;

  /**
   * @param message - Human-readable description of the failure.
   * @param options - Optional error metadata (category, configuration and cause).
   */
  constructor(message: string, options: SmartFetchErrorOptions = {}) {
    super(message);
    this.name = 'SmartFetchError';
    this.type = options.type ?? 'unknown';
    this.config = options.config;
    this.cause = options.cause;

    // Restore the prototype chain: required when extending Error in TypeScript so
    // that `instanceof` keeps working against the actual subclass instantiated.
    Object.setPrototypeOf(this, new.target.prototype);

    // Produce a clean stack trace on runtimes that support it (V8/Node).
    const { captureStackTrace } = Error as unknown as {
      captureStackTrace?: (target: object, ctor: new (...args: never[]) => unknown) => void;
    };
    if (typeof captureStackTrace === 'function') {
      captureStackTrace(this, new.target);
    }
  }

  /** Whether the request failed because its deadline expired. */
  isTimeout(): this is TimeoutError {
    return this.type === 'timeout';
  }

  /** Whether the request failed because of a network problem. */
  isNetwork(): this is NetworkError {
    return this.type === 'network';
  }

  /** Whether the request failed with an unsuccessful HTTP status. */
  isHttp(): this is HttpError {
    return this.type === 'http';
  }

  /** Whether the response body could not be parsed. */
  isParse(): this is ParseError {
    return this.type === 'parse';
  }
}

/**
 * Options for building a {@link TimeoutError}.
 */
export interface TimeoutErrorOptions {
  /** Configuration of the request that exceeded its deadline. */
  config?: RequestConfig;
  /** Original cause (typically the underlying `AbortError`). */
  cause?: unknown;
}

/**
 * Thrown when a request exceeds its maximum wait time and is aborted
 * automatically.
 */
export class TimeoutError extends SmartFetchError {
  /** Deadline, in milliseconds, that was exceeded. */
  readonly timeout: number;

  /**
   * @param timeout - Deadline, in milliseconds, that was exceeded.
   * @param options - Optional error metadata.
   */
  constructor(timeout: number, options: TimeoutErrorOptions = {}) {
    super(`The request exceeded its timeout of ${timeout} ms`, {
      type: 'timeout',
      config: options.config,
      cause: options.cause,
    });
    this.name = 'TimeoutError';
    this.timeout = timeout;
  }
}

/**
 * Options for building a {@link NetworkError}.
 */
export interface NetworkErrorOptions {
  /** Configuration of the request that failed at the transport level. */
  config?: RequestConfig;
  /** Original cause (for instance, the `TypeError` `fetch` throws on network failure). */
  cause?: unknown;
}

/**
 * Thrown when a request cannot complete because of a transport problem
 * (unreachable server, no connectivity, DNS failure, ...).
 */
export class NetworkError extends SmartFetchError {
  /**
   * @param message - Human-readable description of the network failure.
   * @param options - Optional error metadata.
   */
  constructor(
    message = 'Network error while performing the request',
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
 * Options for building an {@link HttpError}.
 */
export interface HttpErrorOptions {
  /** Configuration of the request that produced the error response. */
  config?: RequestConfig;
  /** Normalized response tied to the error, when available. */
  response?: SmartFetchResponse;
  /** Original cause, if any. */
  cause?: unknown;
}

/**
 * Thrown when the server responds with a status code outside the accepted range
 * (2xx by default) — 404 or 500, for example.
 */
export class HttpError extends SmartFetchError {
  /** HTTP status code returned by the server. */
  readonly status: number;

  /** Human-readable text of the HTTP status. */
  readonly statusText: string;

  /** Normalized response tied to the error, when available. */
  readonly response?: SmartFetchResponse;

  /**
   * @param status - HTTP status code returned by the server.
   * @param statusText - Human-readable text of the HTTP status.
   * @param options - Optional error metadata (configuration, response and cause).
   */
  constructor(status: number, statusText: string, options: HttpErrorOptions = {}) {
    super(`The request failed with HTTP status ${status} (${statusText})`, {
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

/**
 * Options for building a {@link ParseError}.
 */
export interface ParseErrorOptions {
  /** Configuration of the request whose response could not be parsed. */
  config?: RequestConfig;
  /** Format the body was read as. */
  responseType?: ResponseType;
  /** Raw body text that could not be interpreted (useful when debugging). */
  text?: string;
  /** Original cause (for instance, the `SyntaxError` from `JSON.parse`). */
  cause?: unknown;
}

/**
 * Thrown when the body of an accepted response cannot be read in the requested
 * format — typically malformed JSON.
 *
 * On error responses (outside the accepted range) {@link HttpError} takes
 * precedence and the raw body is attached as `data`, so this error is not raised
 * there: it only surfaces when the response counts as successful but its body is
 * unreadable.
 */
export class ParseError extends SmartFetchError {
  /** Format the body was read as. */
  readonly responseType: ResponseType;

  /** Raw body text that could not be interpreted, when available. */
  readonly text?: string;

  /**
   * @param message - Human-readable description of the parse failure.
   * @param options - Optional error metadata (configuration, format, raw text and cause).
   */
  constructor(message: string, options: ParseErrorOptions = {}) {
    super(message, {
      type: 'parse',
      config: options.config,
      cause: options.cause,
    });
    this.name = 'ParseError';
    this.responseType = options.responseType ?? 'json';
    this.text = options.text;
  }
}
