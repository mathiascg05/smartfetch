import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { SmartFetchError } from '../src/errors.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * Reintentos y cuerpos consumibles.
 *
 * El `RequestInit` se construye una sola vez y se reutiliza en todos los intentos.
 * Para un cuerpo replayable (texto, JSON, `Blob`, `FormData`) eso es correcto y
 * barato. Para un `ReadableStream` no: el primer intento lo consume y el reintento
 * enviaría un cuerpo vacío o fallaría con un error incomprensible del runtime.
 *
 * Reconstruir el `init` en cada intento **no** lo arregla, porque volvería a leer
 * el mismo objeto stream de la config. La única solución correcta es detectar el
 * caso y negarse a reintentar, explicando por qué.
 */
describe('cuerpos no reutilizables y reintentos', () => {
  function textStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hola'));
        controller.close();
      },
    });
  }

  function okAdapter(): jest.Mock<FetchAdapter> {
    return jest.fn<FetchAdapter>(async () => new Response('{}', { status: 200 }));
  }

  it('rechaza antes de salir a la red si el cuerpo es un stream y hay reintentos', async () => {
    const fetchMock = okAdapter();
    const client = new SmartFetch({ retries: 2 }, { fetch: fetchMock });

    const error = await client.post('https://api.x.com/s', textStream()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartFetchError);
    expect((error as SmartFetchError).type).toBe('request');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('el mensaje explica el motivo y cómo salir del paso', async () => {
    const client = new SmartFetch({ retries: 2 }, { fetch: okAdapter() });

    const error = await client.post('https://api.x.com/s', textStream()).catch((e: unknown) => e);

    expect((error as SmartFetchError).message).toMatch(/stream/i);
    expect((error as SmartFetchError).message).toMatch(/retries/i);
  });

  it('permite el mismo cuerpo cuando no hay reintentos', async () => {
    const fetchMock = okAdapter();
    const client = new SmartFetch({ retries: 0 }, { fetch: fetchMock });

    const res = await client.post('https://api.x.com/s', textStream());

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['texto', 'hola'],
    ['objeto plano (JSON)', { a: 1 }],
    ['URLSearchParams', new URLSearchParams({ a: '1' })],
    ['Blob', new Blob(['x'])],
    ['Uint8Array', new Uint8Array([1, 2, 3])],
  ])('permite reintentar con un cuerpo replayable: %s', async (_nombre, body) => {
    let intentos = 0;
    const fetchMock = jest.fn<FetchAdapter>(async () => {
      intentos += 1;
      return intentos < 2
        ? new Response('boom', { status: 503, statusText: 'Service Unavailable' })
        : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = new SmartFetch({ retries: 2 }, { fetch: fetchMock });

    const res = await client.post('https://api.x.com/s', body);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un GET con retries no se ve afectado (no lleva cuerpo)', async () => {
    const fetchMock = okAdapter();
    const client = new SmartFetch({ retries: 3 }, { fetch: fetchMock });

    await expect(client.get('https://api.x.com/x')).resolves.toBeDefined();
  });
});
