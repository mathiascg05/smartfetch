import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { HttpError, NetworkError } from '../src/errors.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * Pruebas unitarias del cliente con `fetch` mockeado (patrón Adapter).
 *
 * Se inyecta un {@link FetchAdapter} de prueba mediante `options.fetch`, de modo
 * que no se toca la red real ni el `fetch` global: cada test controla la
 * respuesta nativa que recibe el cliente y verifica cómo la normaliza.
 */
describe('SmartFetch (núcleo + GET)', () => {
  /** Crea un adaptador mock que devuelve una respuesta JSON dada. */
  function jsonAdapter(body: unknown, init: ResponseInit = { status: 200 }): jest.Mock<FetchAdapter> {
    return jest.fn<FetchAdapter>(async () =>
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      }),
    );
  }

  describe('get()', () => {
    it('devuelve la respuesta normalizada en el caso feliz', async () => {
      const fetchMock = jsonAdapter({ id: 1, nombre: 'Ada' });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      const res = await client.get<{ id: number; nombre: string }>('/usuarios/1');

      expect(res.data).toEqual({ id: 1, nombre: 'Ada' });
      expect(res.status).toBe(200);
      expect(res.statusText).toBe('');
      expect(res.ok).toBe(true);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.url).toBe('https://api.x.com/usuarios/1');
      expect(res.raw).toBeInstanceOf(Response);
      expect(res.config.method).toBe('GET');
    });

    it('invoca al adaptador con la URL (baseURL + ruta + params) y método GET', async () => {
      const fetchMock = jsonAdapter([{ id: 1 }]);
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      await client.get('/items', { params: { page: 2, tags: ['a', 'b'] } });

      const [calledUrl, init] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe('https://api.x.com/items?page=2&tags=a&tags=b');
      expect(init?.method).toBe('GET');
    });

    it('propaga la señal de aborto al init del fetch', async () => {
      const fetchMock = jsonAdapter({});
      const controller = new AbortController();
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.get('https://api.x.com/x', { signal: controller.signal });

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.signal).toBe(controller.signal);
    });
  });

  describe('parseo según responseType', () => {
    it('devuelve texto plano con responseType "text"', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () => new Response('hola mundo', { status: 200 }));
      const client = new SmartFetch({}, { fetch: fetchMock });

      const res = await client.get<string>('https://api.x.com/saludo', { responseType: 'text' });
      expect(res.data).toBe('hola mundo');
    });

    it('devuelve un ArrayBuffer con responseType "arrayBuffer"', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () => new Response('abc', { status: 200 }));
      const client = new SmartFetch({}, { fetch: fetchMock });

      const res = await client.get<ArrayBuffer>('https://api.x.com/bin', {
        responseType: 'arrayBuffer',
      });
      expect(res.data).toBeInstanceOf(ArrayBuffer);
      expect(res.data.byteLength).toBe(3);
    });

    it('devuelve null cuando el cuerpo está vacío (p. ej. 204)', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () => new Response(null, { status: 204 }));
      const client = new SmartFetch({}, { fetch: fetchMock });

      const res = await client.get('https://api.x.com/nada');
      expect(res.status).toBe(204);
      expect(res.data).toBeNull();
    });
  });

  describe('manejo de errores', () => {
    it('lanza HttpError con la respuesta adjunta ante un estado no-2xx', async () => {
      const fetchMock = jsonAdapter({ mensaje: 'no encontrado' }, { status: 404 });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      expect.assertions(4);
      try {
        await client.get('/usuarios/999');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.status).toBe(404);
        expect(httpError.isHttp()).toBe(true);
        expect(httpError.response?.data).toEqual({ mensaje: 'no encontrado' });
      }
    });

    it('envuelve un fallo de red en NetworkError encadenando la causa', async () => {
      const causa = new TypeError('Failed to fetch');
      const fetchMock = jest.fn<FetchAdapter>(async () => {
        throw causa;
      });
      const client = new SmartFetch({}, { fetch: fetchMock });

      expect.assertions(3);
      try {
        await client.get('https://api.x.com/x');
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError);
        expect((error as NetworkError).isNetwork()).toBe(true);
        expect((error as NetworkError).cause).toBe(causa);
      }
    });
  });

  describe('métodos con cuerpo (POST/PUT/PATCH/DELETE)', () => {
    it('POST serializa un objeto plano a JSON y añade Content-Type', async () => {
      const fetchMock = jsonAdapter({ id: 1 }, { status: 201 });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      const res = await client.post('/usuarios', { nombre: 'Ada' });

      const [calledUrl, init] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe('https://api.x.com/usuarios');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ nombre: 'Ada' }));
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(res.status).toBe(201);
    });

    it('POST respeta el Content-Type provisto por el usuario', async () => {
      const fetchMock = jsonAdapter({});
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.post('https://api.x.com/u', { a: 1 }, { headers: { 'Content-Type': 'application/vnd.api+json' } });

      const [, init] = fetchMock.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/vnd.api+json');
    });

    it('PUT envía el método y el cuerpo serializado', async () => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.put('https://api.x.com/u/1', { nombre: 'Grace' });

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.method).toBe('PUT');
      expect(init?.body).toBe(JSON.stringify({ nombre: 'Grace' }));
    });

    it('PATCH envía el método y el cuerpo serializado', async () => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.patch('https://api.x.com/u/1', { activo: false });

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.method).toBe('PATCH');
      expect(init?.body).toBe(JSON.stringify({ activo: false }));
    });

    it('DELETE usa el método correcto sin cuerpo y normaliza un 204', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () => new Response(null, { status: 204 }));
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      const res = await client.delete('/usuarios/1');

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.method).toBe('DELETE');
      expect(init?.body).toBeUndefined();
      expect(res.status).toBe(204);
      expect(res.data).toBeNull();
    });

    it('no vuelve a serializar un cuerpo que ya es string', async () => {
      const fetchMock = jsonAdapter({});
      const client = new SmartFetch({}, { fetch: fetchMock });
      const crudo = 'campo=valor&otro=2';

      await client.post('https://api.x.com/form', crudo, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.body).toBe(crudo);
    });
  });

  describe('configuración del cliente', () => {
    it('lanza SmartFetchError si no hay fetch disponible ni inyectado', () => {
      const original = globalThis.fetch;
      // @ts-expect-error: se elimina temporalmente para simular un entorno sin fetch.
      delete globalThis.fetch;
      try {
        expect(() => new SmartFetch()).toThrow(/fetch/i);
      } finally {
        globalThis.fetch = original;
      }
    });
  });
});
