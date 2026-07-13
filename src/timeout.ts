/**
 * Control de tiempo de espera (timeout) de SmartFetch.
 *
 * Expone {@link withTimeout}, una utilidad que envuelve una operación de red y le
 * impone un plazo máximo mediante `AbortController`: si el tiempo se agota, la
 * operación se cancela y el fallo se traduce a un {@link TimeoutError} controlado.
 * La utilidad también combina el timeout con una posible señal de aborto externa
 * provista por quien consume la librería, de modo que ambas vías de cancelación
 * conviven sin pisarse. Es un módulo interno: no forma parte de la API pública.
 *
 * @module timeout
 */

import { TimeoutError } from './errors.js';
import type { RequestConfig } from './types.js';

/**
 * Indica si un error corresponde a una cancelación por `AbortController`.
 *
 * Al abortar, tanto `fetch` (que rechaza con un `DOMException`) como el resto de
 * APIs basadas en `AbortSignal` usan el nombre `"AbortError"`; esta comprobación
 * es agnóstica al tipo concreto y solo mira dicho nombre.
 *
 * @param error - Valor capturado que se desea clasificar.
 * @returns `true` si el error representa un aborto.
 */
function isAbortError(error: unknown): boolean {
  // No se usa `instanceof Error`: en Node `fetch` rechaza con un `DOMException`,
  // que no hereda de `Error`. Basta con inspeccionar el nombre del error.
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

/**
 * Ejecuta una operación de red imponiéndole un tiempo máximo de espera.
 *
 * Si `timeout` es `0` o `undefined`, no hay límite: la operación se ejecuta tal
 * cual, propagando la `externalSignal` recibida sin crear temporizadores. Con un
 * timeout positivo, se crea un `AbortController` propio (combinado con la señal
 * externa, si la hay) y un temporizador que, al expirar, cancela la operación; en
 * ese caso el rechazo por aborto se traduce a un {@link TimeoutError}. Cualquier
 * otro error —incluido un aborto provocado por la señal externa— se propaga sin
 * modificarse. El temporizador y los listeners se limpian siempre.
 *
 * @typeParam T - Tipo del valor que resuelve la operación.
 * @param timeout - Tiempo máximo en milisegundos. `0`/`undefined` = sin límite.
 * @param externalSignal - Señal de aborto externa a combinar con el timeout, si existe.
 * @param operation - Operación a ejecutar; recibe la señal (combinada) que debe respetar.
 * @param config - Configuración de la petición, adjuntada al {@link TimeoutError} para diagnóstico.
 * @returns El valor que resuelve la operación.
 * @throws {TimeoutError} Si se agota el tiempo de espera y la operación es cancelada.
 */
export async function withTimeout<T>(
  timeout: number | undefined,
  externalSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal | undefined) => Promise<T>,
  config?: RequestConfig,
): Promise<T> {
  // Sin límite de tiempo: se ejecuta la operación directamente, respetando solo
  // la señal externa (si la hay). No se crean AbortController ni temporizadores.
  if (!timeout || timeout <= 0) {
    return operation(externalSignal);
  }

  const controller = new AbortController();
  let timedOut = false;

  // Combina la señal externa con el controlador del timeout: si el consumidor
  // aborta manualmente, el controlador propio también se aborta.
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
    // Solo se considera timeout si fue nuestro temporizador el que abortó; un
    // aborto de la señal externa (u otro error) se propaga sin transformarse.
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
