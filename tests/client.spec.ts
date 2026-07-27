import { jest } from '@jest/globals';
import { SmartFetch } from '../src/client.js';
import { HttpError, NetworkError, ParseError, TimeoutError } from '../src/errors.js';
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

    it('devuelve un Blob con responseType "blob"', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () => new Response('abc', { status: 200 }));
      const client = new SmartFetch({}, { fetch: fetchMock });

      const res = await client.get<Blob>('https://api.x.com/archivo', { responseType: 'blob' });
      expect(res.data).toBeInstanceOf(Blob);
      expect(res.data.size).toBe(3);
    });

    it('devuelve un FormData con responseType "formData"', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () =>
        new Response('a=1&b=2', {
          status: 200,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );
      const client = new SmartFetch({}, { fetch: fetchMock });

      const res = await client.get<FormData>('https://api.x.com/form', { responseType: 'formData' });
      expect(res.data).toBeInstanceOf(FormData);
      expect(res.data.get('a')).toBe('1');
      expect(res.data.get('b')).toBe('2');
    });

    it('devuelve null cuando el cuerpo está vacío (p. ej. 204)', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () => new Response(null, { status: 204 }));
      const client = new SmartFetch({}, { fetch: fetchMock });

      const res = await client.get('https://api.x.com/nada');
      expect(res.status).toBe(204);
      expect(res.data).toBeNull();
    });

    it('normaliza a null un 204 para cualquier responseType (text, blob)', async () => {
      const textMock = jest.fn<FetchAdapter>(async () => new Response(null, { status: 204 }));
      const textClient = new SmartFetch({}, { fetch: textMock });
      const textRes = await textClient.get('https://api.x.com/nada', { responseType: 'text' });
      expect(textRes.data).toBeNull();

      const blobMock = jest.fn<FetchAdapter>(async () => new Response(null, { status: 204 }));
      const blobClient = new SmartFetch({}, { fetch: blobMock });
      const blobRes = await blobClient.get('https://api.x.com/nada', { responseType: 'blob' });
      expect(blobRes.data).toBeNull();
    });
  });

  describe('normalización de parseo y errores', () => {
    it('lanza ParseError ante un JSON malformado en una respuesta 2xx', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () =>
        new Response('{no-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const client = new SmartFetch({}, { fetch: fetchMock });

      expect.assertions(5);
      try {
        await client.get('https://api.x.com/roto');
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
        const parseError = error as ParseError;
        expect(parseError.isParse()).toBe(true);
        expect(parseError.responseType).toBe('json');
        expect(parseError.cause).toBeInstanceOf(SyntaxError);
        expect(parseError.text).toBe('{no-json');
      }
    });

    it('prioriza HttpError sobre el parseo cuando un 5xx trae un cuerpo malformado', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () =>
        new Response('<html>500</html>', {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const client = new SmartFetch({}, { fetch: fetchMock });

      expect.assertions(3);
      try {
        await client.get('https://api.x.com/error');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.status).toBe(500);
        expect(httpError.response?.data).toBe('<html>500</html>');
      }
    });

    it('adjunta el cuerpo crudo como data en un 404 con JSON malformado', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () =>
        new Response('oops', {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const client = new SmartFetch({}, { fetch: fetchMock });

      expect.assertions(2);
      try {
        await client.get('https://api.x.com/noexiste');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).response?.data).toBe('oops');
      }
    });
  });

  describe('validateStatus', () => {
    it('acepta un estado no-2xx cuando validateStatus lo aprueba', async () => {
      const fetchMock = jsonAdapter({ cacheado: true }, { status: 404 });
      const client = new SmartFetch({}, { fetch: fetchMock });

      const res = await client.get('https://api.x.com/x', { validateStatus: () => true });
      expect(res.status).toBe(404);
      expect(res.data).toEqual({ cacheado: true });
    });

    it('rechaza con HttpError un estado 2xx cuando validateStatus no lo aprueba', async () => {
      const fetchMock = jsonAdapter({ ok: true }, { status: 200 });
      const client = new SmartFetch({}, { fetch: fetchMock });

      expect.assertions(2);
      try {
        await client.get('https://api.x.com/x', { validateStatus: (status) => status === 201 });
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).status).toBe(200);
      }
    });
  });

  describe('estilos async/await y Promesas', () => {
    it('resuelve con el estilo de promesas (.then)', () => {
      const fetchMock = jsonAdapter({ id: 7 });
      const client = new SmartFetch({}, { fetch: fetchMock });

      return client.get<{ id: number }>('https://api.x.com/u/7').then((res) => {
        expect(res.data).toEqual({ id: 7 });
        expect(res.status).toBe(200);
      });
    });

    it('propaga el rechazo por el manejador de error del .then', () => {
      const fetchMock = jsonAdapter({ mensaje: 'no encontrado' }, { status: 404 });
      const client = new SmartFetch({}, { fetch: fetchMock });

      return client.get('https://api.x.com/u/999').then(
        () => {
          throw new Error('no debía resolver');
        },
        (error: unknown) => {
          expect(error).toBeInstanceOf(HttpError);
        },
      );
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

  describe('timeout', () => {
    /** Adaptador que se cuelga hasta que su señal se aborta (simula una respuesta lenta). */
    const hangingAdapter: FetchAdapter = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });

    it('lanza TimeoutError cuando la petición supera el tiempo configurado', async () => {
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: hangingAdapter });

      expect.assertions(2);
      try {
        await client.get('/lento', { timeout: 10 });
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        expect((error as TimeoutError).isTimeout()).toBe(true);
      }
    });

    it('no cancela una petición que responde dentro del plazo', async () => {
      const fetchMock = jsonAdapter({ ok: true });
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      const res = await client.get('/rapido', { timeout: 1000 });
      expect(res.data).toEqual({ ok: true });
      expect(res.status).toBe(200);
    });
  });

  describe('reintentos', () => {
    /** Adaptador que responde con los estados indicados, uno por llamada consecutiva. */
    function sequenceAdapter(statuses: number[]): jest.Mock<FetchAdapter> {
      let i = 0;
      return jest.fn<FetchAdapter>(async () => {
        const status = statuses[Math.min(i, statuses.length - 1)];
        i += 1;
        return new Response(JSON.stringify({ ok: status < 400 }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      });
    }

    it('reintenta ante 5xx y resuelve cuando un intento devuelve 2xx', async () => {
      const fetchMock = sequenceAdapter([500, 500, 200]);
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      const res = await client.get('/inestable', { retries: 2 });

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('no reintenta ante un 4xx (un solo intento) y lanza HttpError', async () => {
      const fetchMock = sequenceAdapter([400]);
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      await expect(client.get('/malo', { retries: 3 })).rejects.toBeInstanceOf(HttpError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('por defecto (retries omitido) realiza un único intento', async () => {
      const fetchMock = sequenceAdapter([500]);
      const client = new SmartFetch({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      await expect(client.get('/error')).rejects.toBeInstanceOf(HttpError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reintenta ante un fallo de red transitorio', async () => {
      let intentos = 0;
      const fetchMock = jest.fn<FetchAdapter>(async () => {
        intentos += 1;
        if (intentos < 2) {
          throw new TypeError('Failed to fetch');
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      const client = new SmartFetch({}, { fetch: fetchMock });

      const res = await client.get('https://api.x.com/x', { retries: 1 });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('no reintenta ante un timeout aunque haya reintentos disponibles', async () => {
      const hangingAdapter = jest.fn<FetchAdapter>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      );
      const client = new SmartFetch({}, { fetch: hangingAdapter });

      await expect(
        client.get('https://api.x.com/lento', { timeout: 10, retries: 3 }),
      ).rejects.toBeInstanceOf(TimeoutError);
      expect(hangingAdapter).toHaveBeenCalledTimes(1);
    });
  });

  describe('cuerpos que fetch ya sabe manejar', () => {
    /** Adaptador que captura el init recibido y responde 200 vacío. */
    function capturaInit(): jest.Mock<FetchAdapter> {
      return jest.fn<FetchAdapter>(async () => new Response(null, { status: 204 }));
    }

    it('no serializa ni toca un URLSearchParams', async () => {
      const fetchMock = capturaInit();
      const client = new SmartFetch({}, { fetch: fetchMock });
      const body = new URLSearchParams({ a: '1' });

      await client.post('https://api.x.com/x', body);

      const init = fetchMock.mock.calls[0][1];
      expect(init?.body).toBe(body);
      // No debe inventarse un Content-Type: fetch lo deduce del tipo de cuerpo.
      expect(new Headers(init?.headers).get('Content-Type')).toBeNull();
    });

    it('no serializa un Blob ni un vista de ArrayBuffer', async () => {
      const fetchMock = capturaInit();
      const client = new SmartFetch({}, { fetch: fetchMock });

      const blob = new Blob(['hola']);
      await client.post('https://api.x.com/x', blob);
      expect(fetchMock.mock.calls[0][1]?.body).toBe(blob);

      const bytes = new Uint8Array([1, 2, 3]);
      await client.put('https://api.x.com/x', bytes);
      expect(fetchMock.mock.calls[1][1]?.body).toBe(bytes);
    });

    it('serializa como JSON un objeto sin prototipo', async () => {
      const fetchMock = capturaInit();
      const client = new SmartFetch({}, { fetch: fetchMock });

      // Object.create(null) no hereda de Object.prototype, pero sigue siendo un
      // objeto plano serializable.
      const sinPrototipo = Object.create(null) as Record<string, unknown>;
      sinPrototipo.nombre = 'Ada';

      await client.post('https://api.x.com/x', sinPrototipo);

      const init = fetchMock.mock.calls[0][1];
      expect(init?.body).toBe('{"nombre":"Ada"}');
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    });

    it('no serializa un FormData', async () => {
      const fetchMock = capturaInit();
      const client = new SmartFetch({}, { fetch: fetchMock });
      const form = new FormData();
      form.append('campo', 'valor');

      await client.post('https://api.x.com/x', form);

      expect(fetchMock.mock.calls[0][1]?.body).toBe(form);
    });
  });

  describe('cuerpos vacíos y parseo de formData', () => {
    it('devuelve null cuando el cuerpo está vacío en una respuesta 200', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () => new Response('', { status: 200 }));
      const client = new SmartFetch({}, { fetch: fetchMock });

      const res = await client.get('https://api.x.com/x');

      expect(res.data).toBeNull();
      expect(res.status).toBe(200);
    });

    it('lanza ParseError si el cuerpo de una respuesta aceptada no es formData', async () => {
      const fetchMock = jest.fn<FetchAdapter>(
        async () =>
          new Response('{"no":"es form data"}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
      const client = new SmartFetch({}, { fetch: fetchMock });

      await expect(
        client.get('https://api.x.com/x', { responseType: 'formData' }),
      ).rejects.toBeInstanceOf(ParseError);
    });

    it('tolera un formData ilegible en una respuesta de error y deja ganar al HttpError', async () => {
      const fetchMock = jest.fn<FetchAdapter>(
        async () =>
          new Response('{"error":"roto"}', {
            status: 500,
            statusText: 'Server Error',
            headers: { 'Content-Type': 'application/json' },
          }),
      );
      const client = new SmartFetch({}, { fetch: fetchMock });

      const error = await client
        .get('https://api.x.com/x', { responseType: 'formData' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(500);
      expect((error as HttpError).response?.data).toBeNull();
    });
  });

  describe('fusión de configuración', () => {
    it('usa el método por defecto del cliente cuando la petición no indica ninguno', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () => new Response(null, { status: 204 }));
      const client = new SmartFetch({ method: 'DELETE' }, { fetch: fetchMock });

      await client.request({ url: 'https://api.x.com/x' });

      expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
    });

    it('cae en GET cuando no hay método ni en la petición ni en los defaults', async () => {
      const fetchMock = jest.fn<FetchAdapter>(async () => new Response(null, { status: 204 }));
      const client = new SmartFetch({}, { fetch: fetchMock });

      await client.request({ url: 'https://api.x.com/x' });

      expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
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
