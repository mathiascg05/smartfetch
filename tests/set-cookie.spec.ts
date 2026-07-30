import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SmartFetch } from '../src/client.js';

/**
 * Cabeceras de respuesta con valores múltiples.
 *
 * `buildResponse` vuelca `raw.headers` en un objeto plano, así que una cabecera
 * repetida —`Set-Cookie` es el caso real— se colapsaba y se perdían todas menos
 * una, en silencio. `Headers.getSetCookie()` sí las conserva.
 *
 * Estas pruebas usan un servidor HTTP de verdad porque un `Response` construido a
 * mano no reproduce el comportamiento: hay que pasar por la pila real de `fetch`.
 */
describe('cabeceras de respuesta con valores múltiples', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/dos-cookies') {
        res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      if (req.url === '/una-cookie') {
        res.setHeader('Set-Cookie', 'solo=1; Path=/');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('`headers` no expone set-cookie en absoluto', async () => {
    const client = new SmartFetch();
    const res = await client.get(`${base}/dos-cookies`);

    // El dato SÍ llega: está en la respuesta nativa.
    expect(res.raw.headers.getSetCookie()).toHaveLength(2);
    // Un Record plano no puede representar una cabecera repetida, así que la
    // clave se omite por completo. Es preferible que no exista a que exista
    // devolviendo solo la última cookie sin avisar.
    expect(res.headers).not.toHaveProperty('set-cookie');
    expect(Object.keys(res.headers)).not.toContain('set-cookie');
  });

  it('omite set-cookie incluso cuando solo hay una', async () => {
    const client = new SmartFetch();
    const res = await client.get(`${base}/una-cookie`);

    // Sin excepciones: si el número de cookies decidiera si la clave existe, el
    // consumidor tendría que comprobar ambos sitios.
    expect(res.headers).not.toHaveProperty('set-cookie');
    expect(res.setCookie).toEqual(['solo=1; Path=/']);
  });

  it('el resto de cabeceras siguen intactas', async () => {
    const client = new SmartFetch();
    const res = await client.get(`${base}/dos-cookies`);

    expect(res.headers['content-type']).toContain('application/json');
  });

  it('expone las dos cookies sin perder ninguna', async () => {
    const client = new SmartFetch();
    const res = await client.get(`${base}/dos-cookies`);

    expect(res.setCookie).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });

  it('expone una sola cookie como array de un elemento', async () => {
    const client = new SmartFetch();
    const res = await client.get(`${base}/una-cookie`);

    expect(res.setCookie).toEqual(['solo=1; Path=/']);
  });

  it('devuelve un array vacío cuando no hay Set-Cookie', async () => {
    const client = new SmartFetch();
    const res = await client.get(`${base}/sin-cookies`);

    expect(res.setCookie).toEqual([]);
  });

  describe('runtime sin Headers.getSetCookie()', () => {
    /**
     * Simula una respuesta de un runtime antiguo: unas `Headers` que solo exponen
     * `get`/`forEach`, sin el getter multivalor.
     */
    function respuestaSinGetter(cookie: string | null): Response {
      const reales = new Headers(
        cookie === null
          ? { 'content-type': 'application/json' }
          : { 'content-type': 'application/json', 'set-cookie': cookie },
      );
      const headers = {
        forEach: reales.forEach.bind(reales),
        get: reales.get.bind(reales),
      } as unknown as Headers;

      return {
        status: 200,
        statusText: 'OK',
        ok: true,
        url: '',
        headers,
        text: async () => '{}',
      } as unknown as Response;
    }

    it('cae al getter simple y devuelve la cookie disponible', async () => {
      const client = new SmartFetch({}, { fetch: async () => respuestaSinGetter('x=1; Path=/') });
      const res = await client.get('https://api.x.com/x');

      expect(res.setCookie).toEqual(['x=1; Path=/']);
    });

    it('devuelve un array vacío si tampoco hay cookie', async () => {
      const client = new SmartFetch({}, { fetch: async () => respuestaSinGetter(null) });
      const res = await client.get('https://api.x.com/x');

      expect(res.setCookie).toEqual([]);
    });
  });

  it('mantiene `headers` como Record por compatibilidad', async () => {
    const client = new SmartFetch();
    const res = await client.get(`${base}/dos-cookies`);

    expect(typeof res.headers).toBe('object');
    expect(res.headers['content-type']).toContain('application/json');
  });
});
