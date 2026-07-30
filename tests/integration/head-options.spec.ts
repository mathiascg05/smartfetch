import { SmartFetch } from '../../src/client.js';
import { startServer, type TestServer } from './server.js';

/**
 * `HEAD` y `OPTIONS` contra un servidor real.
 *
 * `HEAD` es el caso que obliga a mirar el método y no solo el código de estado:
 * el servidor responde `200` **con** `Content-Length`, pero sin cuerpo. Decidir
 * "sin cuerpo" por el estado (204/205/304) no lo cubre, y el camino normal
 * funcionaba por accidente solo en JSON — con `blob` habría devuelto un Blob
 * vacío y con `formData` un `ParseError`.
 */
describe('integración: HEAD y OPTIONS', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('HEAD', () => {
    it('devuelve las cabeceras y ningún cuerpo', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      const res = await client.head('/head');

      expect(res.status).toBe(200);
      expect(res.headers['x-recurso']).toBe('existe');
      expect(res.headers['content-length']).toBe('27');
      expect(res.data).toBeNull();
    });

    it.each(['json', 'text', 'blob', 'arrayBuffer', 'formData'] as const)(
      'normaliza data a null con responseType %s',
      async (responseType) => {
        const client = new SmartFetch({ baseURL: server.base });

        const res = await client.head('/head', { responseType });

        expect(res.data).toBeNull();
      },
    );

    it('no envía cuerpo aunque se pase por config', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      // El servidor devuelve lo que recibió; con HEAD no hay cuerpo de respuesta,
      // así que se comprueba que la petición llegó y el servidor no vio nada.
      await client.head('/echo-body', { body: { no: 'debe viajar' } });

      expect(server.state.hits['/echo-body']).toBe(1);
    });
  });

  describe('OPTIONS', () => {
    it('devuelve Allow y sí trae cuerpo', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      const res = await client.options<{ metodos: string[] }>('/options');

      expect(res.status).toBe(200);
      expect(res.headers['allow']).toBe('GET, HEAD, OPTIONS');
      expect(res.data).toEqual({ metodos: ['GET', 'HEAD', 'OPTIONS'] });
    });

    it('no envía cuerpo de petición', async () => {
      const client = new SmartFetch({ baseURL: server.base });

      const res = await client.options<{ method: string; body: string }>('/echo-body', {
        body: { no: 'debe viajar' },
      });

      expect(res.data.method).toBe('OPTIONS');
      expect(res.data.body).toBe('');
    });
  });
});
