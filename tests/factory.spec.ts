import { jest } from '@jest/globals';
import { createClient, SmartFetchBuilder } from '../src/factory.js';
import defaultInstance, {
  smartfetch,
  createClient as createClientFromIndex,
  SmartFetchBuilder as BuilderFromIndex,
} from '../src/index.js';
import { SmartFetch } from '../src/client.js';
import type { FetchAdapter } from '../src/types.js';

/**
 * Pruebas unitarias de la capa de creación de clientes (Factory + Builder +
 * Singleton). Se inyecta un {@link FetchAdapter} de prueba para no tocar la red
 * y verificar que la configuración acumulada llega efectivamente a la petición.
 */
describe('factory: createClient + SmartFetchBuilder', () => {
  /** Adaptador mock que registra la URL/init recibidos y devuelve un JSON fijo. */
  function jsonAdapter(): jest.Mock<FetchAdapter> {
    return jest.fn<FetchAdapter>(async () =>
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
