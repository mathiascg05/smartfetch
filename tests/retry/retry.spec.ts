import { jest } from '@jest/globals';
import { defaultShouldRetry, withRetry } from '../../src/retry/retry.js';
import { FixedBackoff } from '../../src/retry/backoff.js';
import {
  CancelledError,
  HttpError,
  NetworkError,
  ParseError,
  TimeoutError,
} from '../../src/errors.js';

/**
 * Pruebas unitarias del motor de reintentos {@link withRetry} y de la política
 * por defecto {@link defaultShouldRetry}.
 *
 * Las operaciones son funciones simuladas (`jest.fn`) que cuentan sus llamadas,
 * lo que permite comprobar cuántos intentos se realizan. Salvo un caso concreto,
 * se omite el backoff (o se usa `FixedBackoff(0)`) para no introducir esperas
 * reales y mantener las pruebas rápidas y deterministas.
 */
describe('withRetry', () => {
  /** Predicado que siempre autoriza el reintento. */
  const always = () => true;

  it('devuelve el valor sin reintentar cuando la operación tiene éxito', async () => {
    const operation = jest.fn(async () => 'ok');
    const valor = await withRetry(operation, { retries: 3, shouldRetry: always });

    expect(valor).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('reintenta hasta agotar el presupuesto y luego propaga el último error', async () => {
    const operation = jest.fn(async () => {
      throw new Error('fallo persistente');
    });

    await expect(withRetry(operation, { retries: 2, shouldRetry: always })).rejects.toThrow(
      'fallo persistente',
    );
    // 1 intento original + 2 reintentos = 3 llamadas.
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('resuelve en cuanto un reintento tiene éxito tras fallos transitorios', async () => {
    let intentos = 0;
    const operation = jest.fn(async () => {
      intentos += 1;
      if (intentos < 3) {
        throw new Error('transitorio');
      }
      return 'recuperado';
    });

    const valor = await withRetry(operation, { retries: 5, shouldRetry: always });
    expect(valor).toBe('recuperado');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('no reintenta si el predicado devuelve false', async () => {
    const operation = jest.fn(async () => {
      throw new Error('no reintentable');
    });

    await expect(withRetry(operation, { retries: 3, shouldRetry: () => false })).rejects.toThrow(
      'no reintentable',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('pasa el número de intento (0-based) a la operación', async () => {
    const vistos: number[] = [];
    const operation = jest.fn(async (attempt: number) => {
      vistos.push(attempt);
      if (attempt < 2) {
        throw new Error('sigue');
      }
      return 'listo';
    });

    await withRetry(operation, { retries: 5, shouldRetry: always });
    expect(vistos).toEqual([0, 1, 2]);
  });

  it('espera según la estrategia de backoff entre reintentos', async () => {
    const backoff = new FixedBackoff(20);
    const delaySpy = jest.spyOn(backoff, 'delay');
    let intentos = 0;
    const operation = jest.fn(async () => {
      intentos += 1;
      if (intentos < 2) {
        throw new Error('transitorio');
      }
      return 'ok';
    });

    const valor = await withRetry(operation, { retries: 3, backoff, shouldRetry: always });
    expect(valor).toBe('ok');
    // Se consultó el backoff para el primer (y único) reintento.
    expect(delaySpy).toHaveBeenCalledWith(1);
  });

  it('cancela la espera si la señal externa se aborta durante el backoff', async () => {
    const controller = new AbortController();
    const operation = jest.fn(async () => {
      throw new Error('transitorio');
    });

    const promesa = withRetry(operation, {
      retries: 3,
      backoff: new FixedBackoff(10_000),
      shouldRetry: always,
      signal: controller.signal,
    });
    const motivo = new Error('cancelado por el usuario');
    controller.abort(motivo);

    // El motivo del aborto se conserva como `cause`, pero el error que sale de la
    // librería es siempre un CancelledError: cancelar no es un fallo transitorio.
    const error = await promesa.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CancelledError);
    expect((error as CancelledError).cause).toBe(motivo);
    // Solo el intento original: la espera se cortó antes del reintento.
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('defaultShouldRetry', () => {
  it('reintenta ante respuestas HTTP 5xx', () => {
    expect(defaultShouldRetry(new HttpError(500, 'Internal Server Error'))).toBe(true);
    expect(defaultShouldRetry(new HttpError(503, 'Service Unavailable'))).toBe(true);
  });

  it('no reintenta ante errores de cliente 4xx', () => {
    expect(defaultShouldRetry(new HttpError(400, 'Bad Request'))).toBe(false);
    expect(defaultShouldRetry(new HttpError(404, 'Not Found'))).toBe(false);
  });

  it('reintenta ante errores de red', () => {
    expect(defaultShouldRetry(new NetworkError())).toBe(true);
  });

  it('no reintenta ante timeouts', () => {
    expect(defaultShouldRetry(new TimeoutError(1000))).toBe(false);
  });

  it('no reintenta ante errores de parseo', () => {
    expect(defaultShouldRetry(new ParseError('JSON inválido'))).toBe(false);
  });

  it('no reintenta ante errores desconocidos', () => {
    expect(defaultShouldRetry(new Error('cualquier cosa'))).toBe(false);
  });
});

describe('withRetry: cancelación durante la espera del backoff', () => {
  const always = () => true;

  it('aborta la espera y propaga el motivo sin consumir otro intento', async () => {
    const controller = new AbortController();
    const operation = jest.fn(async () => {
      throw new NetworkError('caída de red');
    });

    // Backoff largo: la espera solo puede terminar por el aborto, no por el plazo.
    const promesa = withRetry(operation, {
      retries: 3,
      backoff: new FixedBackoff(10_000),
      shouldRetry: always,
      signal: controller.signal,
    });

    // Deja que el primer intento falle y que el motor entre en la espera.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const motivo = new Error('cancelado por quien llama');
    controller.abort(motivo);

    const error = await promesa.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CancelledError);
    expect((error as CancelledError).cause).toBe(motivo);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('una señal ya abortada no consume ningún intento', async () => {
    const motivo = new Error('abortado de antemano');
    const operation = jest.fn(async () => {
      throw new NetworkError('caída de red');
    });

    const promesa = withRetry(operation, {
      retries: 2,
      backoff: new FixedBackoff(10_000),
      shouldRetry: always,
      signal: AbortSignal.abort(motivo),
    });

    const error = await promesa.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CancelledError);
    expect((error as CancelledError).cause).toBe(motivo);
    // El chequeo al inicio del bucle corta antes de ejecutar la operación.
    expect(operation).not.toHaveBeenCalled();
  });
});
