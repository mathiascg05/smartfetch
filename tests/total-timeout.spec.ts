import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { TimeoutError } from '../src/errors.js';
import { FixedBackoff } from '../src/retry/backoff.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * Presupuesto de tiempo global de una operación.
 *
 * `timeout` acota cada intento por separado, así que con reintentos el tiempo
 * total no tiene techo: `retries:5` con un backoff de 1 s puede tardar minutos
 * aunque cada intento respete su plazo. `totalTimeout` pone un límite a la
 * operación completa, esperas de backoff incluidas.
 */
describe('totalTimeout', () => {
  /** Adaptador que nunca responde por su cuenta; solo reacciona al aborto. */
  function nuncaResponde(): jest.Mock<FetchAdapter> {
    return jest.fn<FetchAdapter>((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        const abortar = () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal?.aborted) {
          abortar();
          return;
        }
        signal?.addEventListener('abort', abortar, { once: true });
      });
    });
  }

  it('aborta la operación completa aunque cada intento respete su plazo', async () => {
    const fetchMock = jest.fn<FetchAdapter>(
      async () => new Response('boom', { status: 503, statusText: 'Service Unavailable' }),
    );
    const client = new SmartFetch(
      { retries: 5, backoff: new FixedBackoff(1000), totalTimeout: 200 },
      { fetch: fetchMock },
    );

    const inicio = Date.now();
    const error = await client.get('https://api.x.com/inestable').catch((e: unknown) => e);
    const transcurrido = Date.now() - inicio;

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).timeout).toBe(200);
    // Corta durante la primera espera de backoff, no tras los 5 intentos.
    expect(transcurrido).toBeLessThan(900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('corta un único intento que se eterniza', async () => {
    const client = new SmartFetch({ totalTimeout: 100 }, { fetch: nuncaResponde() });

    const error = await client.get('https://api.x.com/lento').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).timeout).toBe(100);
  });

  it('no interfiere cuando la petición termina a tiempo', async () => {
    const fetchMock = jest.fn<FetchAdapter>(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = new SmartFetch({ totalTimeout: 5000 }, { fetch: fetchMock });

    const res = await client.get<{ ok: boolean }>('https://api.x.com/rapido');

    expect(res.data).toEqual({ ok: true });
  });

  it('convive con el timeout por intento: gana el que venza antes', async () => {
    // El plazo global (80 ms) es más corto que el del intento (5 s).
    const client = new SmartFetch({ timeout: 5000, totalTimeout: 80 }, { fetch: nuncaResponde() });

    const error = await client.get('https://api.x.com/lento').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).timeout).toBe(80);
  });

  it('respeta la señal externa además del plazo global', async () => {
    const controller = new AbortController();
    const client = new SmartFetch(
      { totalTimeout: 10_000, signal: controller.signal },
      { fetch: nuncaResponde() },
    );

    const promesa = client.get('https://api.x.com/lento');
    setTimeout(() => controller.abort(), 20);

    const error = await promesa.catch((e: unknown) => e);
    // Cancelar es del usuario; no debe disfrazarse de timeout.
    expect(error).not.toBeInstanceOf(TimeoutError);
    expect((error as { type?: string }).type).toBe('cancelled');
  });

  it('una señal ya abortada corta de inmediato sin esperar al plazo global', async () => {
    const fetchMock = nuncaResponde();
    const client = new SmartFetch(
      { totalTimeout: 10_000, signal: AbortSignal.abort(new Error('ya cancelado')) },
      { fetch: fetchMock },
    );

    const error = await client.get('https://api.x.com/lento').catch((e: unknown) => e);

    expect((error as { type?: string }).type).toBe('cancelled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin totalTimeout no hay techo global (comportamiento previo)', async () => {
    const fetchMock = jest.fn<FetchAdapter>(
      async () => new Response('boom', { status: 503, statusText: 'Service Unavailable' }),
    );
    const client = new SmartFetch(
      { retries: 2, backoff: new FixedBackoff(10) },
      { fetch: fetchMock },
    );

    await client.get('https://api.x.com/inestable').catch(() => undefined);

    // Los 3 intentos se agotan; nada los corta antes.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
