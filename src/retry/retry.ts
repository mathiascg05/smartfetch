/**
 * SmartFetch retry engine.
 *
 * Exposes {@link withRetry}, a utility that runs an operation and, when it fails
 * transiently, retries it up to a maximum number of times, waiting between
 * attempts according to a {@link BackoffStrategy}. The decision to retry is
 * delegated to a predicate ({@link RetryPredicate}); by default only network
 * errors and HTTP 5xx responses are retried — never a timeout, never a client
 * (4xx) error — so a request performs a single attempt unless retries are
 * explicitly configured. This is an internal module: it is not part of the public
 * API, though the backoff strategies are.
 *
 * @module retry/retry
 */

import { CancelledError, HttpError, NetworkError } from '../errors.js';
import { retryAfterDelay } from './retry-after.js';
import type { RetryPredicate } from '../types.js';
import type { BackoffStrategy } from './backoff.js';

/**
 * Options governing {@link withRetry}.
 */
export interface RetryOptions {
  /** Maximum number of retries after the original attempt. */
  retries: number;

  /** Wait strategy between retries. When omitted, retries happen with no wait. */
  backoff?: BackoffStrategy;

  /** Predicate deciding, given an error, whether a retry is warranted. */
  shouldRetry: RetryPredicate;

  /** External abort signal: if it fires during the wait, the retry is cancelled. */
  signal?: AbortSignal;

  /**
   * Upper bound applied to a `Retry-After` delay requested by the server.
   * Defaults to {@link DEFAULT_MAX_RETRY_AFTER_MS}.
   */
  maxRetryAfterMs?: number;
}

/**
 * Default retry policy of the library.
 *
 * Retries only failures that are usually transient: network errors
 * ({@link NetworkError}), server responses with a 5xx status ({@link HttpError}
 * whose `status` falls between 500 and 599) and `429 Too Many Requests`, which is
 * a rate limit rather than a client mistake and clears on its own. It does not
 * retry timeouts, cancellations, other client (4xx) errors, request-construction
 * errors or unclassified failures.
 *
 * @param error - Error captured on the failed attempt.
 * @returns `true` when the error counts as transient and is worth retrying.
 */
export function defaultShouldRetry(error: unknown): boolean {
  // A cancellation is deliberate: retrying it would defeat the caller's intent.
  if (error instanceof CancelledError) {
    return false;
  }
  if (error instanceof HttpError) {
    // 429 is a rate limit, not a client mistake: it is worth waiting out, and the
    // server usually says how long through Retry-After.
    return error.status === 429 || (error.status >= 500 && error.status <= 599);
  }
  return error instanceof NetworkError;
}

/**
 * Waits for a given time, cancellable through an abort signal.
 *
 * Resolves once the delay elapses; if the signal aborts first, it rejects with the
 * abort reason (so {@link withRetry} propagates the cancellation without spending
 * another retry). The timer and the listener are always cleaned up.
 *
 * @param ms - Milliseconds to wait.
 * @param signal - Abort signal that may cut the wait short, if any.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  // Always reject with a CancelledError so that aborting mid-backoff stays inside
  // the library's error model. `AbortSignal.reason` is whatever the caller passed
  // to `abort()` — a `DOMException` when called with no argument, but it may be any
  // value, including `undefined` — so it is preserved as the `cause` rather than
  // being thrown raw.
  const cancelled = (): CancelledError =>
    new CancelledError('The request was cancelled while waiting to retry', {
      cause: signal?.reason,
    });

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs an operation, retrying it on transient failures.
 *
 * Performs the original attempt and, each time the operation rejects, consults
 * `shouldRetry`: if retries remain and the predicate allows it, waits the delay
 * given by `backoff` (when present) and retries; otherwise it propagates the last
 * error. The `operation` receives the attempt number (`0` for the original, `1`
 * for the first retry, and so on).
 *
 * @typeParam T - Type of the value the operation resolves with.
 * @param operation - Operation to run; receives the attempt number (0-based).
 * @param options - Retry configuration (maximum, backoff, predicate and signal).
 * @returns The value resolved by the first attempt that succeeds.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxRetries = Math.max(0, options.retries);

  for (let attempt = 0; ; attempt++) {
    // The signal is checked here, not only inside `sleep()`: with no backoff
    // configured the wait is 0 and `sleep()` is never reached, so this is the only
    // place a cancellation can stop the loop before spending another attempt. An
    // already-aborted signal therefore costs zero attempts.
    if (options.signal?.aborted) {
      throw new CancelledError(undefined, { cause: options.signal.reason });
    }

    try {
      return await operation(attempt);
    } catch (error) {
      const nextAttempt = attempt + 1;
      // Either the retry budget is exhausted or the error is not retryable: it is
      // propagated as-is, untransformed.
      if (nextAttempt > maxRetries || !options.shouldRetry(error, nextAttempt)) {
        throw error;
      }

      // A server that states how long to wait knows better than any client-side
      // guess, so Retry-After takes precedence over the configured backoff.
      const requested =
        error instanceof HttpError
          ? retryAfterDelay(
              error.status,
              error.response?.headers['retry-after'],
              options.maxRetryAfterMs,
            )
          : null;
      const wait = requested ?? options.backoff?.delay(nextAttempt) ?? 0;
      if (wait > 0) {
        await sleep(wait, options.signal);
      }
    }
  }
}
