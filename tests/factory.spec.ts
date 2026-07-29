import { jest } from '@jest/globals';
import { createClient, SmartFetchBuilder } from '../src/factory.js';
import defaultInstance, {
  smartfetch,
  createClient as createClientFromIndex,
  SmartFetchBuilder as BuilderFromIndex,
} from '../src/index.js';
import { SmartFetch } from '../src/client.js';
import { FixedBackoff } from '../src/retry/backoff.js';
import { HttpError, TimeoutError } from '../src/errors.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * Pruebas unitarias de la capa de creación de clientes (Factory + Builder +
 * Singleton). Se inyecta un {@link FetchAdapter} de prueba para no tocar la red
 * y verificar que la configuración acumulada llega efectivamente a la petición.
 */
describe('factory: createClient + SmartFetchBuilder', () => {
  /** Adaptador mock que registra la URL/init recibidos y devuelve un JSON fijo. */
  function jsonAdapter(): jest.Mock<FetchAdapter> {
    return jest.fn<FetchAdapter>(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
    );
  }

  describe('createClient', () => {
    it('devuelve una instancia de SmartFetch', () => {
      expect(createClient()).toBeInstanceOf(SmartFetch);
    });

    it('aplica la configuración por defecto (baseURL) a las peticiones', async () => {
      const fetchMock = jsonAdapter();
      const api = createClient({ baseURL: 'https://api.x.com' }, { fetch: fetchMock });

      await api.get('/usuarios');

      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe('https://api.x.com/usuarios');
    });
  });

  describe('SmartFetchBuilder', () => {
    it('build() produce una instancia de SmartFetch', () => {
      expect(new SmartFetchBuilder().build()).toBeInstanceOf(SmartFetch);
    });

    it('encadena setters y aplica baseURL, cabecera y adaptador configurados', async () => {
      const fetchMock = jsonAdapter();

      const api = new SmartFetchBuilder()
        .baseURL('https://api.x.com')
        .header('Authorization', 'Bearer tok')
        .adapter(fetchMock)
        .build();

      await api.get('/perfil');

      const [calledUrl, init] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe('https://api.x.com/perfil');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer tok');
    });

    it('headers() fusiona un conjunto de cabeceras', async () => {
      const fetchMock = jsonAdapter();

      const api = new SmartFetchBuilder()
        .headers({ 'X-A': '1' })
        .headers({ 'X-B': '2' })
        .adapter(fetchMock)
        .build();

      await api.get('https://api.x.com/x');

      const init = fetchMock.mock.calls[0][1];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-A')).toBe('1');
      expect(headers.get('X-B')).toBe('2');
    });

    it('timeout() fija el plazo que acaba cancelando la petición', async () => {
      // Adaptador que nunca responde: solo la cancelación por timeout lo resuelve.
      const colgado: FetchAdapter = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('abortado'), { name: 'AbortError' }));
          });
        });

      const api = new SmartFetchBuilder().timeout(10).adapter(colgado).build();

      await expect(api.get('https://api.x.com/lento')).rejects.toBeInstanceOf(TimeoutError);
    });

    it('retries() y backoff() configuran los reintentos del cliente construido', async () => {
      let intentos = 0;
      const inestable = jest.fn<FetchAdapter>(async () => {
        intentos += 1;
        return intentos < 3
          ? new Response('{}', { status: 503 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const api = new SmartFetchBuilder()
        .retries(3)
        .backoff(new FixedBackoff(0))
        .adapter(inestable)
        .build();

      const res = await api.get<{ ok: boolean }>('https://api.x.com/inestable');

      expect(res.data).toEqual({ ok: true });
      expect(inestable).toHaveBeenCalledTimes(3);
    });

    it('retryOn() sustituye la política de reintento por defecto', async () => {
      const siempre503 = jest.fn<FetchAdapter>(async () => new Response('{}', { status: 503 }));

      // Un 503 se reintentaría por defecto; este predicado lo prohíbe.
      const api = new SmartFetchBuilder()
        .retries(3)
        .retryOn(() => false)
        .adapter(siempre503)
        .build();

      await expect(api.get('https://api.x.com/x')).rejects.toBeInstanceOf(HttpError);
      expect(siempre503).toHaveBeenCalledTimes(1);
    });

    it('responseType() cambia el formato en que se interpreta el cuerpo', async () => {
      const adapter = jest.fn<FetchAdapter>(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const api = new SmartFetchBuilder().responseType('text').adapter(adapter).build();

      const res = await api.get<string>('https://api.x.com/x');

      expect(typeof res.data).toBe('string');
      expect(res.data).toBe('{"ok":true}');
    });

    it('validateStatus() redefine qué códigos se consideran satisfactorios', async () => {
      const adapter = jest.fn<FetchAdapter>(
        async () => new Response(JSON.stringify({ error: 'no existe' }), { status: 404 }),
      );

      const api = new SmartFetchBuilder()
        .validateStatus((status) => status < 500)
        .adapter(adapter)
        .build();

      const res = await api.get<{ error: string }>('https://api.x.com/x');

      expect(res.status).toBe(404);
      expect(res.data).toEqual({ error: 'no existe' });
    });

    it('encadena todos los setters devolviendo siempre el mismo builder', () => {
      const builder = new SmartFetchBuilder();
      const encadenado = builder
        .baseURL('https://api.x.com')
        .header('X-A', '1')
        .headers({ 'X-B': '2' })
        .timeout(1000)
        .retries(2)
        .backoff(new FixedBackoff(0))
        .retryOn(() => true)
        .responseType('json')
        .validateStatus(() => true)
        .adapter(jsonAdapter());

      expect(encadenado).toBe(builder);
      expect(encadenado.build()).toBeInstanceOf(SmartFetch);
    });
  });

  describe('instancia por defecto (Singleton)', () => {
    it('smartfetch es una instancia de SmartFetch', () => {
      expect(smartfetch).toBeInstanceOf(SmartFetch);
    });

    it('el barrel reexporta las mismas referencias y el default export es el Singleton', () => {
      expect(defaultInstance).toBe(smartfetch);
      expect(createClientFromIndex).toBe(createClient);
      expect(BuilderFromIndex).toBe(SmartFetchBuilder);
    });
  });
});
