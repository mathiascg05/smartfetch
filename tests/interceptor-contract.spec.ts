import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { SmartFetchError } from '../src/errors.js';
import type { FetchAdapter, RequestConfig } from '../src/types.js';

/**
 * Contrato de los interceptores de petición.
 *
 * Un interceptor de request debe devolver la configuración. Olvidar el `return`
 * es el error más fácil de cometer, y producía un `TypeError` crudo desde las
 * tripas del cliente ("Cannot read properties of undefined"), fuera del modelo de
 * errores de la librería y sin pista de qué había que arreglar.
 */
describe('contrato de los interceptores de petición', () => {
  function okAdapter(): jest.Mock<FetchAdapter> {
    return jest.fn<FetchAdapter>(
      async () =>
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  }

  it('un interceptor que no devuelve nada produce SmartFetchError, no TypeError', async () => {
    const fetchMock = okAdapter();
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });
    // Interceptor mal escrito: transforma la config pero olvida devolverla.
    client.interceptors.request.use((config) => {
      config.headers = { ...config.headers, 'X-Demo': '1' };
      return undefined as unknown as RequestConfig;
    });

    const error = await client.get('/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartFetchError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as SmartFetchError).type).toBe('request');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('el mensaje explica el contrato que se incumplió', async () => {
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: okAdapter() });
    client.interceptors.request.use(() => undefined as unknown as RequestConfig);

    const error = await client.get('/x').catch((e: unknown) => e);

    expect((error as SmartFetchError).message).toMatch(/interceptor/i);
    expect((error as SmartFetchError).message).toMatch(/return/i);
  });

  it('rechaza null indicándolo en el mensaje', async () => {
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: okAdapter() });
    client.interceptors.request.use(() => null as unknown as RequestConfig);

    const error = await client.get('/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartFetchError);
    expect((error as SmartFetchError).type).toBe('request');
    expect((error as SmartFetchError).message).toContain('null');
  });

  it('rechaza un array, que es un objeto pero no una config', async () => {
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: okAdapter() });
    client.interceptors.request.use(() => [] as unknown as RequestConfig);

    const error = await client.get('/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartFetchError);
    expect((error as SmartFetchError).type).toBe('request');
  });

  it('rechaza también un valor que no es un objeto', async () => {
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: okAdapter() });
    client.interceptors.request.use(() => 'no soy una config' as unknown as RequestConfig);

    const error = await client.get('/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SmartFetchError);
    expect((error as SmartFetchError).type).toBe('request');
  });

  it('un interceptor correcto sigue funcionando con normalidad', async () => {
    const fetchMock = okAdapter();
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });
    client.interceptors.request.use((config) => {
      config.headers = { ...config.headers, 'X-Demo': '1' };
      return config;
    });

    const res = await client.get('/x');

    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)['X-Demo']).toBe('1');
  });
});
