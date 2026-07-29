import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { CancelledError, NetworkError, SmartFetchError } from '../src/errors.js';
import { defaultShouldRetry } from '../src/retry/retry.js';
import { FixedBackoff } from '../src/retry/backoff.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * Semántica de cancelación mediante una `AbortSignal` externa.
 *
 * Cancelar no es un fallo transitorio: no debe reintentarse ni confundirse con un
 * error de red. Estas pruebas fijan ese contrato, que se rompía en tres puntos a
 * la vez: `withTimeout` no distinguía el aborto externo, `performAttempt` lo
 * envolvía en `NetworkError` y `withRetry` solo miraba la señal dentro de
 * `sleep()`, al que nunca se llegaba sin backoff configurado.
 */
describe('cancelación con AbortSignal externa', () => {
  /** Error de aborto equivalente al que produce `fetch` (un `DOMException`). */
  function abortError(): Error {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }

  /**
   * Adaptador que imita a `fetch` real: si la señal ya viene abortada rechaza de
   * inmediato, y si no, espera a que se aborte. Nunca resuelve por su cuenta.
   */
  function abortAwareAdapter(): jest.Mock<FetchAdapter> {
    return jest.fn<FetchAdapter>((_url, init) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        return Promise.reject(abortError());
      }
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    });
  }

  it('cancelar una petición con reintentos hace exactamente 1 llamada al adaptador', async () => {
    const fetchMock = abortAwareAdapter();
    const controller = new AbortController();
    const client = new SmartFetch(
      { retries: 3, timeout: 5000, signal: controller.signal },
      { fetch: fetchMock },
    );

    const promesa = client.get('https://api.x.com/lento');
    setTimeout(() => controller.abort(), 10);

    await expect(promesa).rejects.toBeInstanceOf(SmartFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('no traduce la cancelación a NetworkError', async () => {
    const controller = new AbortController();
    const client = new SmartFetch(
      { retries: 2, signal: controller.signal },
      { fetch: abortAwareAdapter() },
    );

    const promesa = client.get('https://api.x.com/lento');
    setTimeout(() => controller.abort(), 10);

    const error = await promesa.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmartFetchError);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as SmartFetchError).type).toBe('cancelled');
  });

  it('una señal ya abortada corta sin colgarse y sin reintentar', async () => {
    const fetchMock = abortAwareAdapter();
    const controller = new AbortController();
    controller.abort();

    const client = new SmartFetch({ retries: 3, signal: controller.signal }, { fetch: fetchMock });

    const error = await client.get('https://api.x.com/x').catch((e: unknown) => e);
    expect((error as SmartFetchError).type).toBe('cancelled');
    // El chequeo al inicio del bucle corta antes de tocar el adaptador.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('abortar durante la espera de backoff no consume más intentos', async () => {
    const fetchMock = jest.fn<FetchAdapter>(
      async () => new Response('boom', { status: 503, statusText: 'Service Unavailable' }),
    );
    const controller = new AbortController();
    const client = new SmartFetch(
      { retries: 5, backoff: new FixedBackoff(1000), signal: controller.signal },
      { fetch: fetchMock },
    );

    const promesa = client.get('https://api.x.com/inestable');
    setTimeout(() => controller.abort(), 20);

    const error = await promesa.catch((e: unknown) => e);
    expect((error as SmartFetchError).type).toBe('cancelled');
    // Un intento real; el aborto llega durante la primera espera de backoff.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('conserva el motivo del aborto como cause al cancelar durante el backoff', async () => {
    const motivo = new Error('el usuario cerró la pestaña');
    const controller = new AbortController();
    const client = new SmartFetch(
      { retries: 3, backoff: new FixedBackoff(1000), signal: controller.signal },
      {
        fetch: jest.fn<FetchAdapter>(async () => new Response('boom', { status: 503 })),
      },
    );

    const promesa = client.get('https://api.x.com/inestable');
    setTimeout(() => controller.abort(motivo), 20);

    const error = await promesa.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CancelledError);
    expect((error as CancelledError).cause).toBe(motivo);
  });

  it('defaultShouldRetry nunca reintenta una cancelación', () => {
    expect(defaultShouldRetry(new CancelledError())).toBe(false);
  });

  it('CancelledError expone la categoría y los guards correctos', () => {
    const error = new CancelledError();
    expect(error).toBeInstanceOf(SmartFetchError);
    expect(error.name).toBe('CancelledError');
    expect(error.type).toBe('cancelled');
    expect(error.isCancelled()).toBe(true);
    expect(error.isNetwork()).toBe(false);
    expect(error.isTimeout()).toBe(false);
    expect(error.isHttp()).toBe(false);
    expect(error.isParse()).toBe(false);
  });
});
