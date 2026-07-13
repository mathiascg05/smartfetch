/**
 * Estrategias de espera entre reintentos (patrón Strategy).
 *
 * Cuando una petición falla de forma transitoria y va a reintentarse, conviene
 * esperar un tiempo antes del siguiente intento para no saturar al servidor. La
 * política concreta de espera se modela como una {@link BackoffStrategy}
 * intercambiable: el motor de reintentos solo conoce la interfaz, mientras que
 * las clases concretas ({@link FixedBackoff}, {@link ExponentialBackoff})
 * encapsulan el cálculo del retardo. Así se puede cambiar de política —o añadir
 * una propia— sin tocar el motor.
 *
 * @module retry/backoff
 */

/**
 * Estrategia de retardo entre reintentos (patrón Strategy).
 *
 * Implementaciones distintas calculan de forma distinta cuánto esperar antes de
 * cada reintento; quien consume la librería puede proveer la suya propia siempre
 * que cumpla este contrato.
 */
export interface BackoffStrategy {
  /**
   * Calcula el tiempo de espera, en milisegundos, previo a un reintento.
   *
   * @param attempt - Número de reintento que va a realizarse, empezando en `1`
   *   (el `1` corresponde al primer reintento tras el intento original).
   * @returns Milisegundos a esperar antes de ese reintento (`0` = sin espera).
   */
  delay(attempt: number): number;
}

/**
 * Estrategia de backoff con retardo constante: espera siempre el mismo tiempo
 * antes de cada reintento, independientemente del número de intento.
 *
 * @example
 * new FixedBackoff(200); // espera 200 ms antes de cada reintento
 */
export class FixedBackoff implements BackoffStrategy {
  /** Retardo fijo, en milisegundos, aplicado antes de cada reintento. */
  private readonly delayMs: number;

  /**
   * @param delayMs - Milisegundos a esperar antes de cada reintento. Por defecto `0`
   *   (reintento inmediato). Los valores negativos se tratan como `0`.
   */
  constructor(delayMs = 0) {
    this.delayMs = Math.max(0, delayMs);
  }

  /**
   * Devuelve siempre el mismo retardo, sin depender del número de intento.
   *
   * @returns El retardo fijo en milisegundos.
   */
  delay(): number {
    return this.delayMs;
  }
}

/**
 * Estrategia de backoff exponencial: el retardo se duplica en cada reintento
 * (`base`, `base·2`, `base·4`, …), opcionalmente acotado por un máximo. Es la
 * política habitual para no saturar un servidor que está sobrecargado.
 *
 * @example
 * new ExponentialBackoff(100);          // 100, 200, 400, 800 ms...
 * new ExponentialBackoff(100, 1000);    // 100, 200, 400, 800, 1000, 1000 ms...
 */
export class ExponentialBackoff implements BackoffStrategy {
  /** Retardo base (para el primer reintento), en milisegundos. */
  private readonly baseMs: number;

  /** Cota superior del retardo, en milisegundos. */
  private readonly maxMs: number;

  /**
   * @param baseMs - Retardo del primer reintento, en milisegundos. Por defecto `100`.
   * @param maxMs - Retardo máximo, en milisegundos, que nunca se supera. Por defecto `Infinity`.
   */
  constructor(baseMs = 100, maxMs = Infinity) {
    this.baseMs = Math.max(0, baseMs);
    this.maxMs = maxMs;
  }

  /**
   * Calcula el retardo exponencial para el reintento indicado, acotado por el máximo.
   *
   * @param attempt - Número de reintento (1-based).
   * @returns `min(baseMs · 2^(attempt-1), maxMs)` en milisegundos.
   */
  delay(attempt: number): number {
    const exponential = this.baseMs * 2 ** (attempt - 1);
    return Math.min(exponential, this.maxMs);
  }
}
