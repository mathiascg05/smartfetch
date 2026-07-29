/**
 * Wait strategies between retries (Strategy pattern).
 *
 * When a request fails transiently and is about to be retried, waiting before the
 * next attempt keeps the server from being hammered. The concrete wait policy is
 * modelled as an interchangeable {@link BackoffStrategy}: the retry engine only
 * knows the interface, while the concrete classes ({@link FixedBackoff},
 * {@link ExponentialBackoff}) encapsulate the delay computation. Swapping the
 * policy — or adding your own — never touches the engine.
 *
 * @module retry/backoff
 */

/**
 * Delay strategy between retries (Strategy pattern).
 *
 * Different implementations compute the wait before each retry differently;
 * consumers may supply their own as long as it honours this contract.
 */
export interface BackoffStrategy {
  /**
   * Computes the wait, in milliseconds, preceding a retry.
   *
   * @param attempt - Retry number about to be performed, starting at `1` (where
   *   `1` is the first retry after the original attempt).
   * @returns Milliseconds to wait before that retry (`0` = no wait).
   */
  delay(attempt: number): number;
}

/**
 * Constant-delay backoff: always waits the same amount before each retry,
 * regardless of the attempt number.
 *
 * @example
 * new FixedBackoff(200); // waits 200 ms before every retry
 */
export class FixedBackoff implements BackoffStrategy {
  /** Fixed delay, in milliseconds, applied before each retry. */
  private readonly delayMs: number;

  /**
   * @param delayMs - Milliseconds to wait before each retry. Defaults to `0`
   *   (immediate retry). Negative values are treated as `0`.
   */
  constructor(delayMs = 0) {
    this.delayMs = Math.max(0, delayMs);
  }

  /**
   * Always returns the same delay, independent of the attempt number.
   *
   * @returns The fixed delay in milliseconds.
   */
  delay(): number {
    return this.delayMs;
  }
}

/**
 * Options for {@link ExponentialBackoff}.
 */
export interface ExponentialBackoffOptions {
  /**
   * Whether to randomize the delay so concurrent clients do not retry in
   * lockstep. Enabled by default.
   */
  jitter?: boolean;
}

/**
 * Exponential backoff: the delay doubles on each retry (`base`, `base·2`,
 * `base·4`, ...), capped by an optional maximum. This is the usual policy for
 * backing off from an overloaded server.
 *
 * **Jitter is applied by default.** Without it, every client that failed at the
 * same moment retries at the same moment, and the load spike that knocked the
 * server over repeats on each round. The strategy used is *equal jitter*: the
 * delay lands anywhere in `[exponential / 2, exponential]`. Compared with *full
 * jitter* (`[0, exponential]`) it keeps a floor, so a struggling server never
 * gets an almost-immediate retry.
 *
 * Pass `{ jitter: false }` when a deterministic delay is needed — in tests, for
 * instance.
 *
 * @example
 * new ExponentialBackoff(100);                            // ~50-100, ~100-200, ~200-400 ms...
 * new ExponentialBackoff(100, 1000);                      // same, never above 1000 ms
 * new ExponentialBackoff(100, Infinity, { jitter: false }); // exactly 100, 200, 400, 800 ms...
 */
export class ExponentialBackoff implements BackoffStrategy {
  /** Base delay (for the first retry), in milliseconds. */
  private readonly baseMs: number;

  /** Upper bound on the delay, in milliseconds. */
  private readonly maxMs: number;

  /** Whether the computed delay is randomized. */
  private readonly jitter: boolean;

  /**
   * @param baseMs - Delay of the first retry, in milliseconds. Defaults to `100`.
   * @param maxMs - Maximum delay, in milliseconds, never exceeded. Defaults to `Infinity`.
   * @param options - Extra options; `jitter` defaults to `true`.
   */
  constructor(baseMs = 100, maxMs = Infinity, options: ExponentialBackoffOptions = {}) {
    this.baseMs = Math.max(0, baseMs);
    this.maxMs = maxMs;
    this.jitter = options.jitter ?? true;
  }

  /**
   * Computes the delay for the given retry, capped by the maximum.
   *
   * @param attempt - Retry number (1-based).
   * @returns With jitter, a value in `[capped / 2, capped]`; without it, exactly
   *   `min(baseMs · 2^(attempt-1), maxMs)`, in milliseconds.
   */
  delay(attempt: number): number {
    const exponential = this.baseMs * 2 ** (attempt - 1);
    const capped = Math.min(exponential, this.maxMs);

    if (!this.jitter) {
      return capped;
    }
    // Equal jitter: half the delay is fixed, half is random.
    const half = capped / 2;
    return half + Math.random() * half;
  }
}
