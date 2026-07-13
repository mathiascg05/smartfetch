/**
 * Motor de reintentos de SmartFetch.
 *
 * Expone {@link withRetry}, una utilidad que ejecuta una operación y, si falla de
 * forma transitoria, la vuelve a intentar hasta un número máximo de veces,
 * esperando entre intentos según una {@link BackoffStrategy}. La decisión de
 * reintentar se delega en un predicado ({@link RetryPredicate}); por defecto se
 * reintenta solo ante errores de red y respuestas HTTP 5xx —nunca ante un timeout
 * ni ante errores de cliente (4xx)—, cumpliendo el requisito del proyecto de un
 * único intento salvo configuración explícita. Es un módulo interno: no forma
 * parte de la API pública (sí lo son las estrategias de backoff).
 *
 * @module retry/retry
 */

import { HttpError, NetworkError } from '../errors.js';
import type { RetryPredicate } from '../types.js';
import type { BackoffStrategy } from './backoff.js';

/**
 * Opciones que gobiernan el comportamiento de {@link withRetry}.
 */
export interface RetryOptions {
  /** Número máximo de reintentos adicionales tras el intento original. */
  retries: number;

  /** Estrategia de espera entre reintentos. Si se omite, se reintenta sin esperar. */
  backoff?: BackoffStrategy;

  /** Predicado que decide, ante un error, si procede reintentar. */
  shouldRetry: RetryPredicate;

  /** Señal de aborto externa: si se dispara durante la espera, se cancela el reintento. */
  signal?: AbortSignal;
}

/**
 * Política de reintento por defecto de la librería.
 *
 * Reintenta únicamente ante fallos que suelen ser transitorios: errores de red
 * ({@link NetworkError}) y respuestas del servidor con código 5xx
 * ({@link HttpError} con `status` entre 500 y 599). No reintenta ante timeouts,
 * errores de cliente (4xx), errores de construcción de la petición ni fallos sin
 * clasificar.
 *
 * @param error - Error capturado en el intento fallido.
 * @returns `true` si el error se considera transitorio y merece reintentarse.
 */
export function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status >= 500 && error.status <= 599;
  }
  return error instanceof NetworkError;
}

/**
 * Espera un tiempo determinado, cancelable mediante una señal de aborto.
 *
 * Resuelve al cumplirse el plazo; si la señal se aborta antes, rechaza con el
 * motivo del aborto (para que {@link withRetry} propague la cancelación sin
 * consumir más reintentos). El temporizador y el listener se limpian siempre.
 *
 * @param ms - Milisegundos a esperar.
 * @param signal - Señal de aborto que puede acortar la espera, si existe.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Ejecuta una operación reintentándola ante fallos transitorios.
 *
 * Realiza el intento original y, cada vez que la operación rechaza, consulta
 * `shouldRetry`: si aún quedan reintentos y el predicado lo autoriza, espera el
 * retardo indicado por `backoff` (si lo hay) y reintenta; en caso contrario,
 * propaga el último error. La `operation` recibe el número de intento (`0` para
 * el original, `1` para el primer reintento, etc.).
 *
 * @typeParam T - Tipo del valor que resuelve la operación.
 * @param operation - Operación a ejecutar; recibe el número de intento (0-based).
 * @param options - Configuración de reintentos (máximo, backoff, predicado y señal).
 * @returns El valor que resuelve la operación en cuanto uno de los intentos tiene éxito.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxRetries = Math.max(0, options.retries);

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      const nextAttempt = attempt + 1;
      // Se agota el presupuesto de reintentos o el error no es reintentable:
      // se propaga tal cual, sin transformarlo.
      if (nextAttempt > maxRetries || !options.shouldRetry(error, nextAttempt)) {
        throw error;
      }

      const wait = options.backoff?.delay(nextAttempt) ?? 0;
      if (wait > 0) {
        await sleep(wait, options.signal);
      }
    }
  }
}
