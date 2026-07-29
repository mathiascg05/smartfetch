import { SmartFetch } from '../../src/client.js';
import {
  CancelledError,
  HttpError,
  NetworkError,
  ParseError,
  SmartFetchError,
  TimeoutError,
} from '../../src/errors.js';
import { FixedBackoff } from '../../src/retry/backoff.js';
import { startServer, type TestServer } from './server.js';

/**
 * Pruebas de integración contra un servidor `node:http` real.
 *
 * Van **encima** de las unitarias con mock, que se quedan como están. La
 * diferencia importa: un `Response` fabricado a mano no concatena cabeceras
 * repetidas, no consume cuerpos y no rechaza ante una señal ya abortada. Ocho
 * bugs de comportamiento sobrevivieron a un 100% de cobertura por ese motivo, así
 * que cada bloque de aquí ejercita uno de esos caminos contra la pila real.
 */
describe('integración: SmartFetch contra un servidor real', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    server.state.hits = {};
    server.state.flakyFailures = 1;
    server.state.retryAfter = '0';
  });

  describe('cabeceras reales de ida y vuelta', () => {
    it('envía una sola cabecera cuando cliente y petición difieren en mayúsculas', async () => {
      const client = new SmartFetch({ baseURL: server.base, headers: { 'x-token': 'viejo' } }, {});

      const res = await client.get<{ headers: Record<string, string> }>('/echo', {
        headers: { 'X-Token': 'nuevo' },
      });

      // El servidor ve el valor de la petición, sin rastro del anterior ni una
      // concatenación "viejo, nuevo" —que es lo que hace fetch con duplicados—.
      expect(res.data.headers['x-token']).toBe('nuevo');
      expect(res.data.headers['x-token']).not.toContain('viejo');
      expect(res.data.headers['x-token']).not.toContain(',');
    });

    it('conserva las cabeceras del cliente que la petición no redefine', async () => {
      const client = new SmartFetch({
        baseURL: server.base,
        headers: { 'x-app': 'smartfetch', 'accept-language': 'es' },
      });

      const res = await client.get<{ headers: Record<string, string> }>('/echo', {
        headers: { 'Accept-Language': 'en' },
      });

      expect(res.data.headers['x-app']).toBe('smartfetch');
      expect(res.data.headers['accept-language']).toBe('en');
    });

    it('serializa un cuerpo plano como JSON con su Content-Type', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      const res = await client.post<{ headers: Record<string, string>; method: string }>('/echo', {
        a: 1,
      });

      expect(res.data.method).toBe('POST');
      expect(res.data.headers['content-type']).toContain('application/json');
    });

    it('expone las dos cabeceras Set-Cookie sin colapsarlas', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      const res = await client.get('/cookies');

      expect(res.setCookie).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    });
  });

  describe('params combinados entre cliente y petición', () => {
    it('el servidor recibe los params de ambos niveles', async () => {
      const client = new SmartFetch({
        baseURL: server.base,
        params: { api_key: 'SECRET' },
      });

      const res = await client.get<{ query: Record<string, string> }>('/echo', {
        params: { page: '2' },
      });

      expect(res.data.query).toEqual({ api_key: 'SECRET', page: '2' });
    });

    it('un array genera una entrada repetida en la query real', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      const res = await client.get<{ queryRaw: string }>('/echo', {
        params: { tag: ['a', 'b'] },
      });

      expect(res.data.queryRaw).toBe('?tag=a&tag=b');
    });
  });

  describe('estados sin cuerpo', () => {
    it.each([
      ['204', 204],
      ['205', 205],
    ])('normaliza %s a data null', async (ruta, status) => {
      const client = new SmartFetch({ baseURL: server.base });

      const res = await client.get(`/${ruta}`);

      expect(res.status).toBe(status);
      expect(res.data).toBeNull();
    });

    it('acepta un 304 cuando validateStatus lo permite', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      const res = await client.get('/304', {
        validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
      });

      expect(res.status).toBe(304);
      expect(res.data).toBeNull();
    });
  });

  describe('reintentos sobre 5xx real', () => {
    it('se recupera tras un 503 sin backoff configurado', async () => {
      const client = new SmartFetch({ baseURL: server.base, retries: 2 });

      const res = await client.get<{ recovered: boolean; attempts: number }>('/flaky');

      expect(res.data.recovered).toBe(true);
      expect(server.state.hits['/flaky']).toBe(2);
    });

    it('se recupera con backoff configurado', async () => {
      const client = new SmartFetch({
        baseURL: server.base,
        retries: 3,
        backoff: new FixedBackoff(20),
      });

      const res = await client.get<{ recovered: boolean }>('/flaky');

      expect(res.data.recovered).toBe(true);
    });

    it('propaga HttpError cuando se agotan los reintentos', async () => {
      server.state.flakyFailures = 99;
      const client = new SmartFetch({ baseURL: server.base, retries: 1 });

      const error = await client.get('/flaky').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(503);
      expect(server.state.hits['/flaky']).toBe(2);
    });
  });

  describe('Retry-After', () => {
    it('reintenta un 429 respetando la cabecera', async () => {
      const client = new SmartFetch({ baseURL: server.base, retries: 2 });

      const res = await client.get<{ ok: boolean }>('/rate-limited');

      expect(res.data.ok).toBe(true);
      expect(server.state.hits['/rate-limited']).toBe(2);
    });

    it('reintenta un 503 esperando lo que dice el servidor, no el backoff', async () => {
      server.state.retryAfter = '1';
      const client = new SmartFetch({
        baseURL: server.base,
        retries: 2,
        // Si se usara este backoff en vez de la cabecera, tardaría 30 s.
        backoff: new FixedBackoff(30_000),
      });

      const inicio = Date.now();
      const res = await client.get<{ ok: boolean }>('/unavailable');
      const transcurrido = Date.now() - inicio;

      expect(res.data.ok).toBe(true);
      expect(transcurrido).toBeGreaterThanOrEqual(900);
      expect(transcurrido).toBeLessThan(5000);
    });

    it('recorta la espera al tope configurado', async () => {
      server.state.retryAfter = '3600';
      const client = new SmartFetch({
        baseURL: server.base,
        retries: 1,
        maxRetryAfterMs: 50,
      });

      const inicio = Date.now();
      await client.get('/unavailable');

      expect(Date.now() - inicio).toBeLessThan(3000);
    });
  });

  describe('cancelación y plazos contra la red real', () => {
    it('cancelar a mitad de respuesta produce CancelledError y no reintenta', async () => {
      const controller = new AbortController();
      const client = new SmartFetch({
        baseURL: server.base,
        retries: 3,
        signal: controller.signal,
      });

      const promesa = client.get('/hang');
      setTimeout(() => controller.abort(), 50);

      const error = await promesa.catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CancelledError);
      // Un solo intento: cancelar no es un fallo transitorio.
      expect(server.state.hits['/hang']).toBe(1);
    });

    it('un timeout real contra un endpoint que no responde produce TimeoutError', async () => {
      const client = new SmartFetch({ baseURL: server.base, timeout: 80 });

      const error = await client.get('/hang').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).timeout).toBe(80);
    });

    it('totalTimeout acota la operación completa con reintentos reales', async () => {
      server.state.flakyFailures = 99;
      const client = new SmartFetch({
        baseURL: server.base,
        retries: 5,
        backoff: new FixedBackoff(500),
        totalTimeout: 250,
      });

      const inicio = Date.now();
      const error = await client.get('/flaky').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TimeoutError);
      expect(Date.now() - inicio).toBeLessThan(1500);
    });
  });

  describe('respuestas rotas', () => {
    it('un corte de conexión a mitad de cuerpo produce NetworkError, no un error crudo', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      const error = await client.get('/truncated').catch((e: unknown) => e);

      // El cuerpo se lee DESPUÉS del try/catch que envuelve la llamada, así que
      // un socket cortado a mitad escapaba del modelo de errores como un
      // `TypeError: terminated` crudo.
      expect(error).toBeInstanceOf(SmartFetchError);
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).type).toBe('network');
      // La causa original se conserva para poder diagnosticar.
      expect((error as NetworkError).cause).toBeDefined();
    });

    it('un corte de conexión es transitorio y se reintenta', async () => {
      const client = new SmartFetch({ baseURL: server.base, retries: 1 });

      await client.get('/truncated').catch(() => undefined);

      // Al ser NetworkError entra en la política por defecto: 1 intento + 1 reintento.
      expect(server.state.hits['/truncated']).toBe(2);
    });

    it('un 200 con JSON malformado produce ParseError con el texto crudo', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      const error = await client.get('/malformed').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).text).toBe('{no es json');
    });
  });
});
