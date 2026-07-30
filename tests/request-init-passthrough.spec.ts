import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * Propagación de las opciones nativas de `RequestInit`.
 *
 * Sin ellas no hay autenticación por cookie en navegador (`credentials`), ni
 * control de redirecciones, caché o integridad. Se propagan **solo cuando están
 * definidas**: fijar valores por defecto propios haría que la librería se
 * comportara distinto de `fetch` en cosas que el estándar ya decide.
 */
describe('passthrough de RequestInit', () => {
  function capturingAdapter() {
    const seen: { init?: RequestInit } = {};
    const fetchMock = jest.fn<FetchAdapter>(async (_url, init) => {
      seen.init = init;
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    return { seen, fetchMock };
  }

  const casos = [
    ['credentials', 'include'],
    ['mode', 'cors'],
    ['cache', 'no-store'],
    ['redirect', 'manual'],
    ['keepalive', true],
    ['referrerPolicy', 'no-referrer'],
    ['integrity', 'sha384-abc'],
  ] as const;

  it.each(casos)('propaga %s al adaptador cuando está definida', async (campo, valor) => {
    const { seen, fetchMock } = capturingAdapter();
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

    await client.get('/x', { [campo]: valor });

    expect(seen.init).toHaveProperty(campo, valor);
  });

  it('no añade ninguna de esas claves cuando no se configuran', async () => {
    const { seen, fetchMock } = capturingAdapter();
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

    await client.get('/x');

    for (const [campo] of casos) {
      expect(seen.init).not.toHaveProperty(campo);
    }
  });

  it('acepta las opciones como valores por defecto del cliente', async () => {
    const { seen, fetchMock } = capturingAdapter();
    const client = new SmartFetch(
      { baseURL: 'https://api.x.com', credentials: 'include', mode: 'cors' },
      { fetch: fetchMock },
    );

    await client.get('/x');

    expect(seen.init?.credentials).toBe('include');
    expect(seen.init?.mode).toBe('cors');
  });

  it('la petición reemplaza el valor del cliente (no hay fusión profunda)', async () => {
    const { seen, fetchMock } = capturingAdapter();
    const client = new SmartFetch(
      { baseURL: 'https://api.x.com', credentials: 'include', redirect: 'follow' },
      { fetch: fetchMock },
    );

    await client.get('/x', { credentials: 'omit' });

    expect(seen.init?.credentials).toBe('omit');
    // El resto de valores por defecto del cliente sobreviven.
    expect(seen.init?.redirect).toBe('follow');
  });

  it('convive con el cuerpo y las cabeceras que ya se construían', async () => {
    const { seen, fetchMock } = capturingAdapter();
    const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

    await client.post('/x', { a: 1 }, { credentials: 'include', keepalive: true });

    expect(seen.init?.credentials).toBe('include');
    expect(seen.init?.keepalive).toBe(true);
    expect(seen.init?.body).toBe('{"a":1}');
    expect((seen.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
