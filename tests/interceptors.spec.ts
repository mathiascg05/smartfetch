import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { HttpError } from '../src/errors.js';
import type { FetchAdapter, SmartFetchResponse } from '../src/types.js';

/**
 * Pruebas unitarias de los interceptores (Programación Orientada a Aspectos).
 *
 * Se inyecta un {@link FetchAdapter} de prueba y se registran interceptores de
 * petición y respuesta para verificar que envuelven correctamente el núcleo:
 * transforman la config y la respuesta, respetan el orden de ejecución, pueden
 * eliminarse y son capaces de recuperarse de un error.
 */
describe('Interceptores (AOP)', () => {
  /** Crea un adaptador mock que devuelve una respuesta JSON dada. */
  function jsonAdapter(
    body: unknown,
    init: ResponseInit = { status: 200 },
  ): jest.Mock<FetchAdapter> {
    return jest.fn<FetchAdapter>(
      async () =>
        new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json' },
          ...init,
        }),
    );
  }

  describe('interceptores de request', () => {
    it('transforma la configuración antes de enviar la petición', async () => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      client.interceptors.request.use((config) => {
        config.headers = { ...config.headers, Authorization: 'Bearer secreto' };
        return config;
      });

      await client.get('/protegido');

      const [, init] = fetchMock.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer secreto');
    });

    it('se ejecutan en orden inverso al de registro (LIFO)', async () => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });
      const orden: string[] = [];

      client.interceptors.request.use((config) => {
        orden.push('primero');
        return config;
      });
      client.interceptors.request.use((config) => {
        orden.push('segundo');
        return config;
      });

      await client.get('/x');

      expect(orden).toEqual(['segundo', 'primero']);
    });

    it('un interceptor de request que lanza propaga el error sin llamar al adaptador', async () => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      client.interceptors.request.use(() => {
        throw new Error('config inválida');
      });

      await expect(client.get('/x')).rejects.toThrow('config inválida');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('interceptores de response', () => {
    it('transforma la respuesta recibida', async () => {
      const fetchMock = jsonAdapter({ valor: 21 });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      client.interceptors.response.use((response) => {
        const original = response.data as { valor: number };
        return { ...response, data: { valor: original.valor * 2 } };
      });

      const res = await client.get<{ valor: number }>('/dato');
      expect(res.data).toEqual({ valor: 42 });
    });

    it('se ejecutan en orden de registro (FIFO)', async () => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });
      const orden: string[] = [];

      client.interceptors.response.use((response) => {
        orden.push('primero');
        return response;
      });
      client.interceptors.response.use((response) => {
        orden.push('segundo');
        return response;
      });

      await client.get('/x');

      expect(orden).toEqual(['primero', 'segundo']);
    });

    it('un manejador de error puede recuperarse de un fallo (devuelve un fallback)', async () => {
      const fetchMock = jsonAdapter({ mensaje: 'boom' }, { status: 500 });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      client.interceptors.response.use(undefined, (error) => {
        if (error instanceof HttpError && error.status >= 500) {
          return { ...(error.response as SmartFetchResponse), data: { recuperado: true } };
        }
        throw error;
      });

      const res = await client.get<{ recuperado: boolean }>('/inestable');
      expect(res.data).toEqual({ recuperado: true });
    });

    it('un manejador de error que relanza propaga el error original', async () => {
      const fetchMock = jsonAdapter({}, { status: 404 });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      client.interceptors.response.use(undefined, (error) => {
        throw error;
      });

      await expect(client.get('/faltante')).rejects.toBeInstanceOf(HttpError);
    });
  });

  describe('gestión de la cadena', () => {
    it('eject deja de aplicar un interceptor sin afectar a los demás', async () => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });
      const trazas: string[] = [];

      const id = client.interceptors.request.use((config) => {
        trazas.push('efímero');
        return config;
      });
      client.interceptors.request.use((config) => {
        trazas.push('permanente');
        return config;
      });

      client.interceptors.request.eject(id);
      await client.get('/x');

      expect(trazas).toEqual(['permanente']);
    });

    it('clear elimina todos los interceptores registrados', async () => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });
      const trazas: string[] = [];

      client.interceptors.request.use((config) => {
        trazas.push('a');
        return config;
      });
      client.interceptors.request.use((config) => {
        trazas.push('b');
        return config;
      });

      client.interceptors.request.clear();
      await client.get('/x');

      expect(trazas).toEqual([]);
    });
  });
});
