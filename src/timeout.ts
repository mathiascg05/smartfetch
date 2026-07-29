/**
 * SmartFetch timeout control.
 *
 * Exposes {@link withTimeout}, a utility that wraps a network operation and gives
 * it a deadline via `AbortController`: when the time runs out the operation is
 * cancelled and the failure is translated into a typed {@link TimeoutError}. It
 * also combines that deadline with a caller-provided abort signal, so both
 * cancellation paths coexist without stepping on each other. This is an internal
 * module: it is not part of the public API.
 *
 * @module timeout
 */

import { TimeoutError } from './errors.js';
import type { RequestConfig } from './types.js';

/**
 * Whether an error represents an `AbortController` cancellation.
 *
 * On abort, both `fetch` (which rejects with a `DOMException`) and every other
 * `AbortSignal`-based API use the name `"AbortError"`; this check is agnostic to
 * the concrete type and only looks at that name.
 *
 * Exported for {@link module:client}, which needs the same criterion to tell a
 * caller-driven cancellation apart from a genuine transport failure.
 *
 * @param error - Captured value to classify.
 * @returns `true` when the error represents an abort.
 */
export function isAbortError(error: unknown): boolean {
  // `instanceof Error` is deliberately avoided: in Node, `fetch` rejects with a
  // `DOMException`, which does not inherit from `Error`. The name is enough.
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

/**
 * Runs a network operation under a maximum wait time.
 *
 * When `timeout` is `0` or `undefined` there is no deadline: the operation runs
 * as-is, propagating the `externalSignal` it received without creating any timer.
 * With a positive timeout, a dedicated `AbortController` is created (combined with
 * the external signal, if any) along with a timer that cancels the operation on
 * expiry; in that case the abort rejection is translated into a
 * {@link TimeoutError}. Any other error — including an abort triggered by the
 * external signal — propagates unchanged. The timer and listeners are always
 * cleaned up.
 *
 * @typeParam T - Type of the value the operation resolves with.
 * @param timeout - Maximum time in milliseconds. `0`/`undefined` = no deadline.
 * @param externalSignal - External abort signal to combine with the timeout, if any.
 * @param operation - Operation to run; receives the (combined) signal it must honour.
 * @param config - Request configuration, attached to the {@link TimeoutError} for diagnostics.
 * @returns The value the operation resolves with.
 * @throws {TimeoutError} If the deadline expires and the operation is cancelled.
 */
export async function withTimeout<T>(
  timeout: number | undefined,
  externalSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal | undefined) => Promise<T>,
  config?: RequestConfig,
): Promise<T> {
  // No deadline: run the operation directly, honouring only the external signal
  // (if any). No AbortController and no timer are created.
  if (!timeout || timeout <= 0) {
    return operation(externalSignal);
  }

  const controller = new AbortController();
  let timedOut = false;

  // Combines the external signal with the timeout controller: if the consumer
  // aborts manually, our own controller aborts too.
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  try {
    return await operation(controller.signal);
  } catch (error) {
    // Only counts as a timeout when our own timer did the aborting; an abort from
    // the external signal (or any other error) propagates untransformed.
    if (timedOut && isAbortError(error)) {
      throw new TimeoutError(timeout, { config, cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
