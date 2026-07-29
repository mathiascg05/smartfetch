import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * Fusión de la configuración por defecto del cliente con la de cada petición.
 *
 * `headers` y `params` se fusionan en profundidad; el resto de campos se
 * reemplazan. Para las cabeceras la fusión es además insensible a mayúsculas, de
 * modo que `content-type` y `Content-Type` son la misma cabecera y no se envían
 * duplicadas (lo que haría que `fetch` las concatenara).
 */
describe('mergeConfig', () => {
  /** Adaptador que captura la URL y las cabeceras con las que se llamó. */
  function capturingAdapter() {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const fetchMock = jest.fn<FetchAdapter>(async (url, init) => {
      seen.url = url;
      seen.headers = init?.headers as Record<string, string>;
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    return { seen, fetchMock };
  }

  describe('cabeceras', () => {
    it('no duplica una cabecera que difiere solo en mayúsculas', async () => {
      const { seen, fetchMock } = capturingAdapter();
      const client = new SmartFetch(
        { baseURL: 'https://api.x.com', headers: { 'content-type': 'application/xml' } },
        { fetch: fetchMock },
      );

      await client.post('/y', { a: 1 }, { headers: { 'Content-Type': 'application/json' } });

      const enviadas = Object.keys(seen.headers ?? {});
      const contentTypes = enviadas.filter((k) => k.toLowerCase() === 'content-type');
      expect(contentTypes).toHaveLength(1);
    });

    it('la cabecera de la petición gana sobre la del cliente', async () => {
      const { seen, fetchMock } = capturingAdapter();
      const client = new SmartFetch(
        { baseURL: 'https://api.x.com', headers: { 'content-type': 'application/xml' } },
        { fetch: fetchMock },
      );

      await client.post('/y', { a: 1 }, { headers: { 'Content-Type': 'application/json' } });

      const valores = Object.values(seen.headers ?? {});
      expect(valores).toContain('application/json');
      expect(valores).not.toContain('application/xml');
    });

    it('emite la cabecera con la capitalización que escribió quien llama', async () => {
      const { seen, fetchMock } = capturingAdapter();
      const client = new SmartFetch(
        { baseURL: 'https://api.x.com', headers: { 'x-api-key': 'viejo' } },
        { fetch: fetchMock },
      );

      await client.get('/y', { headers: { 'X-API-Key': 'nuevo' } });

      expect(seen.headers).toEqual(expect.objectContaining({ 'X-API-Key': 'nuevo' }));
      expect(seen.headers).not.toHaveProperty('x-api-key');
    });

    it('conserva las cabeceras del cliente que la petición no redefine', async () => {
      const { seen, fetchMock } = capturingAdapter();
      const client = new SmartFetch(
        {
          baseURL: 'https://api.x.com',
          headers: { Authorization: 'Bearer t', 'Accept-Language': 'es' },
        },
        { fetch: fetchMock },
      );

      await client.get('/y', { headers: { 'Accept-Language': 'en' } });

      expect(seen.headers?.['Authorization']).toBe('Bearer t');
      expect(seen.headers?.['Accept-Language']).toBe('en');
    });
  });

  describe('params', () => {
    it('conserva los params del cliente cuando la petición trae los suyos', async () => {
      const { seen, fetchMock } = capturingAdapter();
      const client = new SmartFetch(
        { baseURL: 'https://api.x.com', params: { api_key: 'SECRET' } },
        { fetch: fetchMock },
      );

      await client.get('/recurso', { params: { page: 1 } });

      expect(seen.url).toContain('api_key=SECRET');
      expect(seen.url).toContain('page=1');
    });

    it('el param de la petición gana sobre el del cliente con la misma clave', async () => {
      const { seen, fetchMock } = capturingAdapter();
      const client = new SmartFetch(
        { baseURL: 'https://api.x.com', params: { lang: 'es', v: '1' } },
        { fetch: fetchMock },
      );

      await client.get('/recurso', { params: { lang: 'en' } });

      expect(seen.url).toContain('lang=en');
      expect(seen.url).not.toContain('lang=es');
      expect(seen.url).toContain('v=1');
    });

    it('usa los params del cliente cuando la petición no trae ninguno', async () => {
      const { seen, fetchMock } = capturingAdapter();
      const client = new SmartFetch(
        { baseURL: 'https://api.x.com', params: { api_key: 'SECRET' } },
        { fetch: fetchMock },
      );

      await client.get('/recurso');

      expect(seen.url).toContain('api_key=SECRET');
    });

    it('permite anular un param del cliente pasándolo como null', async () => {
      const { seen, fetchMock } = capturingAdapter();
      const client = new SmartFetch(
        { baseURL: 'https://api.x.com', params: { trace: 'on' } },
        { fetch: fetchMock },
      );

      await client.get('/recurso', { params: { trace: null } });

      expect(seen.url).not.toContain('trace');
    });
  });

  describe('otros campos', () => {
    it('reemplaza (no fusiona) el resto de campos', async () => {
      const { seen, fetchMock } = capturingAdapter();
      const client = new SmartFetch(
        { baseURL: 'https://api.x.com', timeout: 1000 },
        { fetch: fetchMock },
      );

      await client.get('/recurso', { baseURL: 'https://otra.x.com' });

      expect(seen.url).toBe('https://otra.x.com/recurso');
    });
  });
});
