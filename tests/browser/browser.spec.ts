import { describe, expect, it } from 'vitest';
import { SmartFetch } from '../../src/client.js';
import { CancelledError, HttpError, TimeoutError } from '../../src/errors.js';
import { FixedBackoff } from '../../src/retry/backoff.js';

/**
 * Suite de navegador: Chromium headless vía Playwright.
 *
 * Corre contra endpoints reales servidos por el propio servidor de Vitest, así
 * que usa el `fetch` real del navegador. Un adaptador simulado aquí solo
 * demostraría que el módulo carga; lo que hay que respaldar es que la librería se
 * comporta bien sobre la pila de red del navegador.
 *
 * Lo que deliberadamente **no** se prueba aquí: `Set-Cookie`, porque el navegador
 * no expone esa cabecera a JavaScript por diseño. Se cubre en la suite de
 * integración contra Node.
 */
describe('navegador (Chromium)', () => {
  const base = '/__test';
  /** Id único por prueba, para que el endpoint inestable sea determinista. */
  const id = () => Math.random().toString(36).slice(2);

  it('se ejecuta en un navegador de verdad', () => {
    expect(typeof window).toBe('object');
    expect(navigator.userAgent).toContain('Chrome');
  });

  describe('verbos', () => {
    // `OPTIONS` no aparece aquí: el servidor de desarrollo de Vite responde 204 a
    // toda petición OPTIONS como preflight de CORS, antes de llegar a los
    // endpoints de prueba. Es una limitación del fixture, no de la librería, y el
    // verbo queda cubierto en la suite de integración contra Node.
    it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)(
      'ejecuta %s contra el servidor',
      async (metodo) => {
        const client = new SmartFetch({ baseURL: base });

        const res = await client.request<{ method: string }>({ method: metodo, url: '/echo' });

        expect(res.status).toBe(200);
        expect(res.data.method).toBe(metodo);
      },
    );

    it('HEAD devuelve cabeceras sin cuerpo', async () => {
      const client = new SmartFetch({ baseURL: base });

      const res = await client.head('/echo');

      expect(res.status).toBe(200);
      expect(res.data).toBeNull();
    });

    it('serializa un cuerpo JSON y el servidor lo recibe', async () => {
      const client = new SmartFetch({ baseURL: base });

      const res = await client.post<{ body: string }>('/echo', { hola: 'navegador' });

      expect(JSON.parse(res.data.body)).toEqual({ hola: 'navegador' });
    });

    it('fusiona params del cliente y de la petición', async () => {
      const client = new SmartFetch({ baseURL: base, params: { api_key: 'SECRET' } });

      const res = await client.get<{ query: Record<string, string> }>('/echo', {
        params: { page: '2' },
      });

      expect(res.data.query).toEqual({ api_key: 'SECRET', page: '2' });
    });

    it('normaliza un 204 a data null', async () => {
      const client = new SmartFetch({ baseURL: base });

      const res = await client.get('/204');

      expect(res.status).toBe(204);
      expect(res.data).toBeNull();
    });
  });

  describe('errores', () => {
    it('un 404 produce HttpError con el estado', async () => {
      const client = new SmartFetch({ baseURL: base });

      const error = await client.get('/status?code=404').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
    });
  });

  describe('reintentos', () => {
    it('se recupera de un 503 real', async () => {
      const client = new SmartFetch({ baseURL: base, retries: 2 });

      const res = await client.get<{ recovered: boolean; attempts: number }>(
        `/flaky?id=${id()}&fail=1`,
      );

      expect(res.data.recovered).toBe(true);
      expect(res.data.attempts).toBe(2);
    });

    it('respeta el backoff configurado', async () => {
      const client = new SmartFetch({
        baseURL: base,
        retries: 2,
        backoff: new FixedBackoff(20),
      });

      const res = await client.get<{ recovered: boolean }>(`/flaky?id=${id()}&fail=1`);

      expect(res.data.recovered).toBe(true);
    });

    it('reintenta un 429 respetando Retry-After', async () => {
      const client = new SmartFetch({ baseURL: base, retries: 2 });

      const res = await client.get<{ ok: boolean }>(`/rate-limited?id=${id()}`);

      expect(res.data.ok).toBe(true);
    });

    it('propaga HttpError cuando se agotan los reintentos', async () => {
      const client = new SmartFetch({ baseURL: base, retries: 1 });

      const error = await client.get(`/flaky?id=${id()}&fail=99`).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(503);
    });
  });

  describe('timeout y cancelación con el AbortController del navegador', () => {
    it('un endpoint que no responde produce TimeoutError', async () => {
      const client = new SmartFetch({ baseURL: base, timeout: 150 });

      const error = await client.get('/hang').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).timeout).toBe(150);
    });

    it('cancelar produce CancelledError y no reintenta', async () => {
      const controller = new AbortController();
      const client = new SmartFetch({ baseURL: base, retries: 3, signal: controller.signal });

      const promesa = client.get('/hang');
      setTimeout(() => controller.abort(), 100);

      const error = await promesa.catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CancelledError);
      expect(error).not.toBeInstanceOf(TimeoutError);
    });

    it('totalTimeout acota la operación completa', async () => {
      const client = new SmartFetch({
        baseURL: base,
        retries: 5,
        backoff: new FixedBackoff(500),
        totalTimeout: 250,
      });

      const error = await client.get(`/flaky?id=${id()}&fail=99`).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TimeoutError);
    });
  });

  describe('interceptores', () => {
    it('el interceptor de petición añade una cabecera que el servidor ve', async () => {
      const client = new SmartFetch({ baseURL: base });
      client.interceptors.request.use((config) => {
        config.headers = { ...config.headers, 'x-desde': 'navegador' };
        return config;
      });

      const res = await client.get<{ headers: Record<string, string> }>('/echo');

      expect(res.data.headers['x-desde']).toBe('navegador');
    });

    it('el interceptor de respuesta puede transformarla', async () => {
      const client = new SmartFetch({ baseURL: base });
      client.interceptors.response.use((response) => ({
        ...response,
        data: { envuelto: response.data },
      }));

      const res = await client.get<{ envuelto: { method: string } }>('/echo');

      expect(res.data.envuelto.method).toBe('GET');
    });

    it('el manejador de error puede recuperarse', async () => {
      const client = new SmartFetch({ baseURL: base });
      client.interceptors.response.use(undefined, (error) => {
        if (error instanceof HttpError && error.status === 404) {
          return { ...error.response, data: { recuperado: true } };
        }
        throw error;
      });

      const res = await client.get<{ recuperado: boolean }>('/status?code=404');

      expect(res.data).toEqual({ recuperado: true });
    });
  });

  describe('cabeceras en sus tres formas', () => {
    it('acepta el Headers nativo del navegador', async () => {
      const client = new SmartFetch({ baseURL: base });
      const headers = new Headers({ 'X-Desde': 'headers-nativo' });

      const res = await client.get<{ headers: Record<string, string> }>('/echo', { headers });

      expect(res.data.headers['x-desde']).toBe('headers-nativo');
    });

    it('acepta un array de pares y fusiona con los del cliente', async () => {
      const client = new SmartFetch({ baseURL: base, headers: { 'X-Cliente': 'si' } });

      const res = await client.get<{ headers: Record<string, string> }>('/echo', {
        headers: [['X-Peticion', 'si']],
      });

      expect(res.data.headers['x-cliente']).toBe('si');
      expect(res.data.headers['x-peticion']).toBe('si');
    });

    it('los valores de la petición reemplazan los del cliente', async () => {
      const client = new SmartFetch({
        baseURL: base,
        headers: new Headers({ 'X-Token': 'viejo' }),
      });

      const res = await client.get<{ headers: Record<string, string> }>('/echo', {
        headers: { 'x-token': 'nuevo' },
      });

      expect(res.data.headers['x-token']).toBe('nuevo');
    });
  });

  describe('credentials', () => {
    it('propaga credentials al fetch del navegador sin romper la petición', async () => {
      const client = new SmartFetch({ baseURL: base, credentials: 'include' });

      const res = await client.get<{ method: string }>('/echo');

      // Mismo origen, así que 'include' es válido y la petición debe completarse.
      expect(res.data.method).toBe('GET');
    });
  });
});
