import { jest } from '@jest/globals';
import smartfetch, {
  SmartFetch,
  SmartFetchBuilder,
  CancelledError,
  ExponentialBackoff,
  FixedBackoff,
  HttpError,
  TimeoutError,
  VERSION,
} from '../../src/index.js';
import type { FetchAdapter } from '../../src/types.js';

/**
 * Compatibilidad con runtimes edge (Cloudflare Workers, Vercel Edge).
 *
 * `@edge-runtime/jest-environment` ejecuta estas pruebas en un sandbox con las
 * globales de la plataforma edge, marcado con `EdgeRuntime === 'edge-runtime'`.
 * Lo que se verifica aquí es que la librería **funciona** ahí: que se importa, que
 * resuelve el `fetch` de la plataforma y que verbos, interceptores, reintentos,
 * timeout y cancelación se comportan igual que en Node.
 *
 * Alcance real, para no exagerar lo que prueban: el arnés de Jest filtra `process`
 * y `Buffer` dentro del sandbox, así que su ausencia no es observable desde aquí.
 * La independencia de los internos de Node se comprueba de forma estática en
 * `tests/no-node-builtins.spec.ts`.
 *
 * Tampoco se levanta un servidor local: en este sandbox no existe `node:http`. La
 * red real se cubre en la suite de integración y en la de navegador. Aquí se
 * inyecta el adaptador, que es además lo que haría quien despliega en edge con un
 * `fetch` propio.
 */
describe('runtime edge', () => {
  function jsonAdapter(body: unknown, init: ResponseInit = { status: 200 }) {
    return jest.fn<FetchAdapter>(
      async () =>
        new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json' },
          ...init,
        }),
    );
  }

  it('la librería se importa y expone su superficie pública', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof SmartFetch).toBe('function');
    expect(typeof smartfetch.get).toBe('function');
  });

  it('se ejecuta dentro del sandbox edge, no en Node', () => {
    // Marcador que fijan los runtimes edge reales; si faltara, esta suite estaría
    // probando Node disfrazado y no demostraría nada.
    expect((globalThis as Record<string, unknown>).EdgeRuntime).toBe('edge-runtime');
  });

  it('el sandbox trae las globales web sobre las que se apoya la librería', () => {
    expect(typeof fetch).toBe('function');
    expect(typeof AbortController).toBe('function');
    expect(typeof Response).toBe('function');
    expect(typeof Headers).toBe('function');
    expect(typeof ReadableStream).toBe('function');
  });

  // Nota honesta sobre el alcance de esta suite: el arnés de Jest filtra `process`
  // y `Buffer` dentro del sandbox, así que su ausencia NO se puede comprobar aquí.
  // Que la librería no dependa de los internos de Node se verifica de forma
  // estática en `tests/no-node-builtins.spec.ts`, que sí puede leer las fuentes.

  it('resuelve el fetch global del runtime sin inyección', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('{"desde":"el fetch global"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    try {
      const res = await new SmartFetch().get<{ desde: string }>('https://api.x.com/x');
      expect(res.data).toEqual({ desde: 'el fetch global' });
    } finally {
      globalThis.fetch = original;
    }
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const)(
    'ejecuta el verbo %s',
    async (metodo) => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      await client.request({ method: metodo, url: '/x' });

      expect(fetchMock.mock.calls[0][1]?.method).toBe(metodo);
    },
  );

  it('aplica los interceptores', async () => {
    const fetchMock = jsonAdapter({});
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });
    client.interceptors.request.use((config) => {
      config.headers = { ...config.headers, 'X-Edge': '1' };
      return config;
    });

    await client.get('/x');

    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['X-Edge']).toBe('1');
  });

  it('reintenta un 503 y se recupera', async () => {
    let n = 0;
    const fetchMock = jest.fn<FetchAdapter>(async () => {
      n += 1;
      return n < 2
        ? new Response('boom', { status: 503 })
        : new Response('{"ok":true}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
    });
    const client = new SmartFetch(
      { retries: 2, backoff: new FixedBackoff(1) },
      { fetch: fetchMock },
    );

    const res = await client.get<{ ok: boolean }>('https://api.x.com/x');

    expect(res.data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propaga HttpError con el estado', async () => {
    const client = new SmartFetch({}, { fetch: jsonAdapter({}, { status: 404 }) });

    const error = await client.get('https://api.x.com/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
  });

  it('aplica el timeout con AbortController', async () => {
    const client = new SmartFetch(
      { timeout: 40 },
      {
        fetch: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                const e = new Error('aborted');
                e.name = 'AbortError';
                reject(e);
              },
              { once: true },
            );
          }),
      },
    );

    const error = await client.get('https://api.x.com/lento').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TimeoutError);
  });

  it('cancela con una señal externa', async () => {
    const controller = new AbortController();
    const client = new SmartFetch(
      { retries: 3, signal: controller.signal },
      {
        fetch: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const abortar = () => {
              const e = new Error('aborted');
              e.name = 'AbortError';
              reject(e);
            };
            if (init?.signal?.aborted) {
              abortar();
              return;
            }
            init?.signal?.addEventListener('abort', abortar, { once: true });
          }),
      },
    );

    const promesa = client.get('https://api.x.com/lento');
    setTimeout(() => controller.abort(), 10);

    await expect(promesa).rejects.toBeInstanceOf(CancelledError);
  });

  it('el builder y el jitter funcionan igual', async () => {
    const fetchMock = jsonAdapter({ ok: true });
    const client = new SmartFetchBuilder()
      .baseURL('https://api.x.com')
      .retries(1)
      .backoff(new ExponentialBackoff(10))
      .adapter(fetchMock)
      .build();

    const res = await client.get('/x');

    expect(res.status).toBe(200);
    const valores = new Set(Array.from({ length: 30 }, () => new ExponentialBackoff(100).delay(3)));
    expect(valores.size).toBeGreaterThan(1);
  });
});
