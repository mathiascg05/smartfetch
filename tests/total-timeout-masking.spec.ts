import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { CancelledError, HttpError, NetworkError, TimeoutError } from '../src/errors.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * `totalTimeout` no debe reetiquetar errores ajenos.
 *
 * Cuando el temporizador global dispara, el `.catch` de `dispatch` convertía
 * **cualquier** error en `TimeoutError`. Un adaptador que ignora la señal de
 * aborto y resuelve tarde con un error real hacía que ese error acabara
 * enterrado en `cause`, con un plazo agotado ocupando su lugar.
 *
 * El plazo solo puede reclamar los errores que ha causado él.
 */
describe('totalTimeout: no enmascarar errores ajenos', () => {
  /** Adaptador que ignora la señal y responde tarde con el estado indicado. */
  function tardio(status: number, ms = 60): jest.Mock<FetchAdapter> {
    return jest.fn<FetchAdapter>(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(new Response('{}', { status })), ms),
        ),
    );
  }

  it('un 404 que llega tras el plazo sigue siendo HttpError', async () => {
    const client = new SmartFetch({ totalTimeout: 30, retries: 0 }, { fetch: tardio(404) });

    const error = await client.get('https://api.x.com/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect(error).not.toBeInstanceOf(TimeoutError);
  });

  it('un error de red que llega tras el plazo sigue siendo NetworkError', async () => {
    const client = new SmartFetch(
      { totalTimeout: 30, retries: 0 },
      {
        fetch: () =>
          new Promise<Response>((_resolve, reject) =>
            setTimeout(() => reject(new Error('caída de red')), 60),
          ),
      },
    );

    const error = await client.get('https://api.x.com/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(TimeoutError);
  });

  it('una respuesta correcta que llega tras el plazo se resuelve, no se rechaza', async () => {
    const client = new SmartFetch({ totalTimeout: 30, retries: 0 }, { fetch: tardio(200) });

    const res = await client.get('https://api.x.com/x');

    expect(res.status).toBe(200);
  });

  it('un aborto causado por el propio plazo sí es TimeoutError', async () => {
    // Adaptador que sí respeta la señal, que es lo que hace `fetch` real.
    const respetaSenal = jest.fn<FetchAdapter>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          // `fetch` rechaza con `signal.reason`, y el mock lo imita.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          const abortar = () => reject(init?.signal?.reason ?? new Error('abortado'));
          if (init?.signal?.aborted) {
            abortar();
            return;
          }
          init?.signal?.addEventListener('abort', abortar, { once: true });
        }),
    );
    const client = new SmartFetch({ totalTimeout: 40 }, { fetch: respetaSenal });

    const error = await client.get('https://api.x.com/lento').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).timeout).toBe(40);
  });

  it('una cancelación externa sigue siendo CancelledError, no TimeoutError', async () => {
    const controller = new AbortController();
    const respetaSenal = jest.fn<FetchAdapter>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          // `fetch` rechaza con `signal.reason`, y el mock lo imita.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          const abortar = () => reject(init?.signal?.reason ?? new Error('abortado'));
          if (init?.signal?.aborted) {
            abortar();
            return;
          }
          init?.signal?.addEventListener('abort', abortar, { once: true });
        }),
    );
    const client = new SmartFetch(
      { totalTimeout: 10_000, signal: controller.signal },
      { fetch: respetaSenal },
    );

    const promesa = client.get('https://api.x.com/lento');
    setTimeout(() => controller.abort(), 20);

    const error = await promesa.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CancelledError);
    expect(error).not.toBeInstanceOf(TimeoutError);
  });
});
